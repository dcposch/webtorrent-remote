module.exports = WebTorrentRemoteClient

var EventEmitter = require('events')

/**
* Provides the WebTorrent API.
* Talks to a WebTorrentRemoteServer instance in another process or even another machine.
* Contains:
* - a subset of the methods and props of the WebTorrent client object
* - clientKey, the UUID that's included in all IPC messages to and from this client
* - torrents, a map from torrent key (also a UUID) to torrent handle
*
* Constructor creates the client and introduces it to the server.
* - send should be a function (message) {...} that passes the message to WebTorrentRemoteServer
* - opts optionally specifies {heartbeat}, the heartbeat interval in milliseconds
*/

function WebTorrentRemoteClient (send, opts) {
  EventEmitter.call(this)
  if (!opts) opts = {}

  this._send = send

  this.clientKey = generateUniqueKey()
  this.torrents = {}

  this._destroyed = false

  var heartbeat = opts.heartbeat != null ? opts.heartbeat : 5000
  if (heartbeat > 0) {
    this._interval = setInterval(sendHeartbeat.bind(null, this), heartbeat)
  }
}

WebTorrentRemoteClient.prototype = Object.create(EventEmitter.prototype)

// Receives a message from the WebTorrentRemoteServer
WebTorrentRemoteClient.prototype.receive = function (message) {
  if (message.clientKey !== this.clientKey) {
    return console.error('ignoring message, expected clientKey ' + this.clientKey +
      ': ' + JSON.stringify(message))
  }
  if (this._destroyed) {
    return console.error('ignoring message, client is destroyed: ' + this.clientKey)
  }
  switch (message.type) {
    // Public events. These are part of the WebTorrent API
    case 'infohash':
      return handleInfo(this, message)
    case 'metadata':
      return handleInfo(this, message)
    case 'download':
      return handleInfo(this, message)
    case 'upload':
      return handleInfo(this, message)
    case 'update':
      return handleInfo(this, message)
    case 'done':
      return handleInfo(this, message)
    case 'error':
      return handleError(this, message)
    case 'warning':
      return handleError(this, message)

    // Internal events. Used to trigger callbacks, not part of the public event API
    case 'server-ready':
      return handleServerReady(this, message)
    case 'torrent-subscribed':
      return handleSubscribed(this, message)
    default:
      console.error('ignoring message, unknown type: ' + JSON.stringify(message))
  }
}

// Gets an existing torrent. Returns a torrent handle.
// Emits either the `torrent-present` or `torrent-absent` event on that handle.
WebTorrentRemoteClient.prototype.get = function (torrentId, callback) {
  var torrentKey = generateUniqueKey()
  this._send({
    type: 'subscribe',
    clientKey: this.clientKey,
    torrentKey: torrentKey,
    torrentId: torrentId
  })
  subscribeTorrentKey(this, torrentKey, callback)
}

// Adds a new torrent. See [client.add](https://webtorrent.io/docs)
// - torrentId is a magnet link, etc
// - opts can contain {announce, path, ...}
// All parameters should be JSON serializable.
// Returns a torrent handle.
WebTorrentRemoteClient.prototype.add = function (torrentId, callback, opts) {
  if (!opts) opts = {}
  var torrentKey = opts.torrentKey || generateUniqueKey()
  this._send({
    type: 'add-torrent',
    clientKey: this.clientKey,
    torrentKey: torrentKey,
    torrentId: torrentId,
    opts: opts
  })
  subscribeTorrentKey(this, torrentKey, callback)
}

// Destroys the client
// If this was the last client for a given torrent, destroys that torrent too
WebTorrentRemoteClient.prototype.destroy = function (opts) {
  if (this._destroyed) return
  this._destroyed = true

  this._send({
    type: 'destroy',
    clientKey: this.clientKey,
    opts: opts
  })

  clearInterval(this._interval)
  this._interval = null
  this._send = null
}

// Refers to a WebTorrent torrent object that lives in a different process.
// Contains:
// - the same API (for now, just a subset)
// - client, the underlying WebTorrentRemoteClient
// - key, the UUID that uniquely identifies this torrent
function RemoteTorrent (client, key) {
  EventEmitter.call(this)

  // New props unique to webtorrent-remote, not in webtorrent
  this.client = client
  this.key = key
  this.serverURL = null

  // WebTorrent API, props updated once:
  this.infoHash = null
  this.name = null
  this.length = null
  this.files = []

  // WebTorrent API, props updated with every `progress` event:
  this.progress = 0
  this.downloaded = 0
  this.uploaded = 0
  this.downloadSpeed = 0
  this.uploadSpeed = 0
  this.numPeers = 0
  this.progress = 0
  this.timeRemaining = Infinity
}

RemoteTorrent.prototype = Object.create(EventEmitter.prototype)

// Creates a streaming torrent-to-HTTP server
// - opts can contain {headers, ...}
// All parameters should be JSON serializable.
RemoteTorrent.prototype.createServer = function (opts, callback) {
  this._serverReadyCallback = callback
  this.client._send({
    type: 'create-server',
    clientKey: this.client.clientKey,
    torrentKey: this.key,
    opts: opts
  })
}

function subscribeTorrentKey (client, torrentKey, callback) {
  var torrent = new RemoteTorrent(client, torrentKey)
  torrent._subscribedCallback = callback
  client.torrents[torrentKey] = torrent
}

function sendHeartbeat (client) {
  client._send({
    type: 'heartbeat',
    clientKey: client.clientKey
  })
}

function handleInfo (client, message) {
  var torrent = getTorrentByKey(client, message.torrentKey)
  Object.assign(torrent, message.torrent)
  torrent.emit(message.type)
}

function handleError (client, message) {
  var type = message.type // 'error' or 'warning'
  if (message.torrentKey) {
    var torrent = getTorrentByKey(client, message.torrentKey)
    if (torrent.listeners(type).length > 0) torrent.emit(type, message.error)
    else client.emit(type, message.error)
  } else {
    client.emit(type, message.error)
  }
}

function handleServerReady (client, message) {
  var torrent = getTorrentByKey(client, message.torrentKey)
  torrent.serverURL = message.serverURL
  var cb = torrent._serverReadyCallback
  if (cb) cb(null, torrent)
}

function handleSubscribed (client, message) {
  var torrent = getTorrentByKey(client, message.torrentKey)
  var cb = torrent._subscribedCallback
  if (message.torrent) {
    Object.assign(torrent, message.torrent) // Fill in infohash, etc
    cb(null, torrent)
  } else {
    var err = new Error('TorrentId not found: ' + message.torrentId)
    err.name = 'TorrentMissingError'
    delete client.torrents[message.torrentKey]
    cb(err)
  }
}

function getTorrentByKey (client, torrentKey) {
  var torrent = client.torrents[torrentKey]
  if (torrent) return torrent
  throw new Error('Unrecognized torrentKey: ' + torrentKey)
}

function generateUniqueKey () {
  return Math.random().toString(16).slice(2)
}

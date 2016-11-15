const EventEmitter = require('events')
const crypto = require('crypto')

// Provides the WebTorrent API.
// Talks to a WebTorrentRemoteServer instance in another process or even another machine.
// Contains:
// - a subset of the methods and props of the WebTorrent client object
// - clientKey, the UUID that's included in all IPC messages to and from this client
// - torrents, a map from torrent key (also a UUID) to torrent handle
module.exports = class WebTorrentRemoteClient extends EventEmitter {
  // Creates the client and introduces it to the server.
  // - send should be a function (message) {...} that passes the message to WebTorrentRemoteServer
  constructor (send, options) {
    super()
    this.clientKey = generateUniqueKey()
    this.torrents = {}
    this._send = send
    this._options = options = options || {}
    if (options.heartbeat > 0) setInterval(() => sendHeartbeat(this), options.heartbeat)
  }

  // Receives a message from the WebTorrentRemoteServer
  receive (message) {
    if (message.clientKey !== this.clientKey) {
      return console.error('ignoring message, expected clientKey ' + this.clientKey +
        ': ' + JSON.stringify(message))
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
  get (torrentID, callback) {
    const torrentKey = generateUniqueKey()
    this._send({
      type: 'subscribe',
      clientKey: this.clientKey,
      torrentKey,
      torrentID
    })

    var torrent = new RemoteTorrent(this, torrentKey)
    torrent._subscribedCallback = callback
    this.torrents[torrentKey] = torrent
  }

  // Adds a new torrent. See [client.add](https://webtorrent.io/docs)
  // - torrentID is a magnet link, etc
  // - options can contain {announce, path, ...}
  // All parameters should be JSON serializable.
  // Returns a torrent handle.
  add (torrentID, options) {
    options = options || {}
    const torrentKey = options.torrentKey || generateUniqueKey()
    this._send({
      type: 'add-torrent',
      clientKey: this.clientKey,
      torrentKey: torrentKey,
      torrentID: torrentID,
      options: options
    })
    var torrent = new RemoteTorrent(this, torrentKey)
    this.torrents[torrentKey] = torrent
    return torrent
  }
}

// Refers to a WebTorrent torrent object that lives in a different process.
// Contains:
// - the same API (for now, just a subset)
// - client, the underlying WebTorrentRemoteClient
// - key, the UUID that uniquely identifies this torrent
class RemoteTorrent extends EventEmitter {
  constructor (client, key) {
    super()

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

  // Creates a streaming torrent-to-HTTP server
  // - options can contain {headers, ...}
  // All parameters should be JSON serializable.
  createServer (options) {
    this.client._send({
      type: 'create-server',
      clientKey: this.client.clientKey,
      torrentKey: this.key,
      options: options
    })
  }
}

function sendHeartbeat (client) {
  client._send({
    type: 'heartbeat',
    clientKey: client.clientKey
  })
}

function handleInfo (client, message) {
  var torrent = client.torrents[message.torrentKey]
  Object.assign(torrent, message.torrent)
}

function handleError (client, message) {
  var type = message.type // 'error' or 'warning'
  if (message.torrentKey) {
    var torrent = getTorrentByKey(client, message.torrentKey)
    torrent.emit(type, message.error)
  } else {
    client.emit(type, message.error)
  }
}

function handleServerReady (client, message) {
  const torrent = getTorrentByKey(client, message.torrentKey)
  torrent.serverURL = message.serverURL
}

function handleSubscribed (client, message) {
  const torrent = getTorrentByKey(client, message.torrentKey)
  var cb = torrent._subscribedCallback
  if (message.torrent) {
    Object.assign(torrent, message.torrent) // Fill in infohash, etc
    cb(null, torrent)
  } else {
    cb(new Error('TorrentID not found: ' + message.torrentID))
  }
}

function getTorrentByKey (client, torrentKey) {
  const torrent = client.torrents[torrentKey]
  if (torrent) return torrent
  throw new Error('Unrecognized torrentKey: ' + torrentKey)
}

function generateUniqueKey () {
  return crypto.randomBytes(16).toString('hex')
}

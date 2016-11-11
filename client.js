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
  constructor (send) {
    super()
    this.clientKey = generateUniqueKey()
    this.torrents = {}
    this._send = send
  }

  // Receives a message from the WebTorrentRemoteServer
  receive (message) {
    if (message.clientKey !== this.clientKey) {
      throw new Error('Wrong clientKey, expected ' + this.clientKey + ': ' + JSON.stringify(message))
    }
    switch (message.type) {
      case 'infohash':
        return handleInfo(this, message)
      case 'metadata':
        return handleInfo(this, message)
      case 'download':
        return handleInfo(this, message)
      case 'upload':
        return handleInfo(this, message)
      case 'done':
        return handleInfo(this, message)
      case 'server-ready':
        return handleServerReady(this, message)
      case 'error':
        return handleError(this, message)
      case 'warning':
        return handleError(this, message)
      default:
        console.error('Ignoring unknown message type: ' + JSON.stringify(message))
    }
  }

  // Adds a new torrent. See [client.add](https://webtorrent.io/docs)
  // - torrentID is a magnet link, etc
  // - options can contain {announce, path, ...}
  // All parameters should be JSON serializable.
  // Returns a torrent handle.
  add (torrentID, options) {
    const torrentKey = generateUniqueKey()
    this._send({
      clientKey: this.clientKey,
      type: 'add-torrent',
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
      clientKey: this.client.clientKey,
      type: 'create-server',
      torrentKey: this.key,
      options: options
    })
  }
}

function handleInfo (client, message) {
  var torrent = client.torrents[message.torrentKey]
  Object.assign(torrent, message.torrent)
}

function handleServerReady (client, message) {
  const torrent = getTorrentByKey(client, message.torrentKey)
  torrent.serverURL = message.serverURL
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

function getTorrentByKey (client, torrentKey) {
  const torrent = client.torrents[torrentKey]
  if (torrent) return torrent
  throw new Error('Unrecognized torrentKey: ' + torrentKey)
}

function generateUniqueKey () {
  return crypto.randomBytes(16).toString('hex')
}

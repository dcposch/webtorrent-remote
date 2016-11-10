const EventEmitter = require('events')
const crypto = require('crypto')
const messages = require('./messages')

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
      case messages.INFOHASH:
        return handleInfo(this, message)
      case messages.METADATA:
        return handleInfo(this, message)
      case messages.PROGRESS:
        return handleProgress(this, message)
      case messages.DONE:
        return handleProgress(this, message)
      case messages.SERVER_READY:
        return handleServerReady(this, message)
      case messages.ERROR:
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
      clientKey: this._clientKey,
      type: messages.ADD_TORRENT,
      torrentKey: torrentKey,
      torrentID: torrentID,
      options: options
    })
    return new RemoteTorrent(this, torrentKey)
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
    this.client = client
    this.key = key
  }

  // Creates a streaming torrent-to-HTTP server
  // - options can contain {headers, ...}
  // All parameters should be JSON serializable.
  createServer (options) {
    this.client._send({
      clientKey: this.client._clientKey,
      type: messages.CREATE_SERVER,
      torrentKey: this.key,
      options: options
    })
  }
}

function handleInfo (client, message) {
  client.torrents[message.torrentKey] = message.torrent
}

function handleProgress (client, message) {
  const torrent = getTorrentByKey(client, message)
  torrent.progress = message.progress
}

function handleServerReady (client, message) {
  const torrent = getTorrentByKey(client, message)
  torrent.server = message.server
}

function handleError (client, message) {
  client.emit('error', message.error)
}

function getTorrentByKey (client, message) {
  const torrent = client.torrents[message.torrentKey]
  if (torrent) return torrent
  throw new Error('Unrecognized torrentKey: ' + JSON.stringify(message))
}

function generateUniqueKey () {
  return crypto.randomBytes(16).toString('hex')
}

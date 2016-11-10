const messages = require('./messages')
const WebTorrent = require('webtorrent')

// Runs WebTorrent.
// Connects to trackers, the DHT, BitTorrent peers, and WebTorrent peers.
// Controlled by one or more WebTorrentRemoteClients.
// - send is a function (message) { ... }
//   Must deliver them message to the WebTorrentRemoteClient
//   If there is more than one client, you must check message.clientKey
// - options is passed to the WebTorrent constructor
module.exports = class WebTorrentRemoteServer {
  constructor (send, options) {
    this._send = send
    this._options = options || {}
    this._webtorrent = null
    this._clients = {}
  }

  // Returns the underlying WebTorrent object, lazily creating it if needed
  webtorrent () {
    if (!this._webtorrent) {
      this._webtorrent = new WebTorrent(this._options)
      addWebTorrentEvents(this)
    }
    return this._webtorrent
  }

  // Receives a message from the WebTorrentRemoteClient
  // Message contains {clientKey, type, ...}
  receive (message) {
    this.clients[message.clientKey] = message.clientKey
    switch (message.type) {
      case messages.ADD_TORRENT:
        return handleAddTorrent(this)
      case messages.CREATE_SERVER:
        return handleCreateServer(this)
      default:
        console.error('Ignoring unknown message type: ' + JSON.stringify(message))
    }
  }
}

// Event handlers for the whole WebTorrent instance
function addWebTorrentEvents (server) {
  server._webtorrent.on('error', function (err) {
    sendToAllClients(server, {
      type: messages.ERROR,
      error: err
    })
  })
}

// Event handlers for individual torrents
function addTorrentEvents (server, torrent) {
  torrent.on('infohash', () => sendInfo(server, torrent, messages.INFOHASH))
  torrent.on('metadata', () => sendInfo(server, torrent, messages.METADATA))
  torrent.on('progress', () => sendProgress(server, torrent, messages.PROGRESS))
  torrent.on('done', () => sendProgress(server, torrent, messages.DONE))
}

function handleAddTorrent (server, message) {
  var torrent = server.client().add(message.torrentID, message.options)
  // TODO: handle the case where two different clients both open the same infohash
  if (torrent.clientKey) throw new Error('torrent already has a clientKey')
  torrent.clientKey = message.clientKey
  torrent.torrentKey = message.torrentKey
  addTorrentEvents(server, torrent)
}

function handleCreateServer (server) {
  // TODO
  console.log('handleCreateServer UNIMP')
}

function sendInfo (server, torrent, type) {
  server._send({
    type: type,
    clientKey: torrent.clientKey,
    torrent: {
      name: torrent.name,
      infohash: torrent.infohash,
      progress: torrent.progress,
      files: (torrent.files || []).map((file) => ({
        name: file.name
      }))
    }
  })
}

function sendProgress (server, torrent, type) {
  server._send({
    type: type,
    clientKey: torrent.clientKey,
    progress: torrent.progress
  })
}

function sendToAllClients (server, message) {
  for (var clientKey in server._clients) {
    var clientMessage = Object.assign({}, message, {clientKey})
    server._send(clientMessage)
  }
}

const WebTorrent = require('webtorrent')
const parseTorrent = require('parse-torrent')

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
    this._torrents = []
    var updateInterval = this._options.updateInterval
    if (updateInterval === undefined) updateInterval = 1000
    if (updateInterval) setInterval(() => sendUpdates(this), updateInterval)
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
    this._clients[message.clientKey] = message.clientKey
    switch (message.type) {
      case 'add-torrent':
        return handleAddTorrent(this, message)
      case 'create-server':
        return handleCreateServer(this, message)
      default:
        console.error('Ignoring unknown message type: ' + JSON.stringify(message))
    }
  }
}

// Event handlers for the whole WebTorrent instance
function addWebTorrentEvents (server) {
  server._webtorrent.on('warning', (e) => sendError(server, null, e, 'warning'))
  server._webtorrent.on('error', (e) => sendError(server, null, e, 'error'))
}

// Event handlers for individual torrents
function addTorrentEvents (server, torrent) {
  torrent.on('infohash', () => sendInfo(server, torrent, 'infohash'))
  torrent.on('metadata', () => sendInfo(server, torrent, 'metadata'))
  torrent.on('download', () => sendProgress(server, torrent, 'download'))
  torrent.on('upload', () => sendProgress(server, torrent, 'upload'))
  torrent.on('done', () => sendProgress(server, torrent, 'done'))
  torrent.on('warning', (e) => sendError(server, torrent, e, 'warning'))
  torrent.on('error', (e) => sendError(server, torrent, e, 'error'))
}

function handleAddTorrent (server, message) {
  const wt = server.webtorrent()
  const {clientKey, torrentKey} = message

  // First, see if we've already joined this swarm
  const infohash = parseTorrent(message.torrentID).infoHash
  let torrent = wt.torrents.find((t) => t.infoHash === infohash)

  if (torrent) {
    // If so, send the `infohash` and `metadata` events and a progress update right away
    const keys = {clientKey, torrentKey}
    server._send(Object.assign(getInfoMessage(server, torrent, 'infohash'), keys))
    server._send(Object.assign(getInfoMessage(server, torrent, 'metadata'), keys))
    const progressType = torrent.downloaded === torrent.length ? 'done' : 'update'
    server._send(Object.assign(getProgressMessage(server, torrent, progressType), keys))
  } else {
    // Otherwise, join the swarm
    torrent = wt.add(message.torrentID, message.options)
    torrent._clients = []
    server._torrents.push(torrent)
    addTorrentEvents(server, torrent)
  }

  // Either way, subscribe this client to future updates for this swarm
  torrent._clients.push({clientKey, torrentKey})
}

function handleCreateServer (server, message) {
  const {clientKey, torrentKey} = message
  const torrent = getTorrentByKey(server, torrentKey)
  let {serverURL} = torrent
  if (serverURL) {
    // Server already exists. Notify the caller right away
    server._send({clientKey, torrentKey, serverURL, type: 'server-ready'})
  } else if (torrent.pendingHttpClients) {
    // Server pending
    // listen() has already been called, but the 'listening' event hasn't fired yet
    torrent.pendingHttpClients.push({clientKey, torrentKey})
  } else {
    // Server does not yet exist. Create it, then notify everyone who asked for it
    torrent.pendingHttpClients = [{clientKey, torrentKey}]
    torrent.server = torrent.createServer(message.options)
    torrent.server.listen(function () {
      const addr = torrent.server.address()
      serverURL = torrent.serverURL = 'http://localhost:' + addr.port
      torrent.pendingHttpClients.forEach(function ({clientKey, torrentKey}) {
        server._send({clientKey, torrentKey, serverURL, type: 'server-ready'})
      })
      delete torrent.pendingHttpClients
    })
  }
}

function sendInfo (server, torrent, type) {
  var message = getInfoMessage(server, torrent, type)
  sendToTorrentClients(server, torrent, message)
}

function sendProgress (server, torrent, type) {
  var message = getProgressMessage(server, torrent, type)
  sendToTorrentClients(server, torrent, message)
}

function getInfoMessage (server, torrent, type) {
  return {
    type: type,
    torrent: {
      key: torrent.key,
      name: torrent.name,
      infohash: torrent.infoHash,
      length: torrent.length,
      files: (torrent.files || []).map((file) => ({
        name: file.name,
        length: file.length
      }))
    }
  }
}

function getProgressMessage (server, torrent, type) {
  return {
    type: type,
    torrent: {
      progress: torrent.progress,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      length: torrent.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      ratio: torrent.ratio,
      numPeers: torrent.numPeers,
      timeRemaining: torrent.timeRemaining
    }
  }
}

function sendError (server, torrent, e, type) {
  var message = {
    type: type, // 'warning' or 'error'
    error: {message: e.message, stack: e.stack}
  }
  if (torrent) sendToTorrentClients(server, torrent, message)
  else sendToAllClients(server, message)
}

function sendUpdates (server) {
  server._torrents.forEach(function (torrent) {
    sendProgress(server, torrent, 'update')
  })
}

function sendToTorrentClients (server, torrent, message) {
  torrent._clients.forEach(function (client) {
    var clientMessage = Object.assign({}, message, client)
    server._send(clientMessage)
  })
}

function sendToAllClients (server, message) {
  for (var clientKey in server._clients) {
    var clientMessage = Object.assign({}, message, {clientKey})
    server._send(clientMessage)
  }
}

function getTorrentByKey (server, torrentKey) {
  var torrent = server.webtorrent().torrents.find((t) => hasTorrentKey(t, torrentKey))
  if (!torrent) throw new Error('Missing torrentKey: ' + torrentKey)
  return torrent
}

// Each torrent corresponds to *one or more* torrentKeys
// That's because clients generate torrentKeys independently, and we might have two clients that
// both added a torrent with the same infohash. (In that case, two RemoteTorrent objects correspond
// to the same WebTorrent torrent object.)
function hasTorrentKey (torrent, torrentKey) {
  return torrent._clients.some((c) => c.torrentKey === torrentKey)
}

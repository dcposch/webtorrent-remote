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

    let updateInterval = this._options.updateInterval
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
    const {clientKey} = message
    if (!this._clients[clientKey]) {
      if (this._options.trace) console.log('adding  client, clientKey: ' + clientKey)
      this._clients[clientKey] = {
        clientKey,
        heartbeat: new Date().getTime()
      }
    }
    switch (message.type) {
      case 'subscribe':
        return handleSubscribe(this, message)
      case 'add-torrent':
        return handleAddTorrent(this, message)
      case 'create-server':
        return handleCreateServer(this, message)
      case 'heartbeat':
        return handleHeartbeat(this, message)
      default:
        console.error('ignoring unknown message type: ' + JSON.stringify(message))
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

// Subscribe does NOT create a new torrent or join a new swarm
// If message.torrentID is missing, it emits 'torrent-subscribed' with {torrent: null}
// If the webtorrent instance hasn't been created at all yet, subscribe won't create it
function handleSubscribe (server, message) {
  const wt = server._webtorrent // Don't create the webtorrent instance

  // See if we've already joined this swarm
  const infohash = parseTorrent(message.torrentID).infoHash
  let torrent = wt && wt.torrents.find((t) => t.infoHash === infohash)

  // If so, listen for updates
  if (torrent) torrent.clients.push({clientKey, torrentKey})

  // Either way, respond
  const {clientKey, torrentKey} = message
  sendSubscribed(server, torrent, clientKey, torrentKey)
}

// Emits the 'torrent-subscribed' event
function sendSubscribed (server, torrent, clientKey, torrentKey) {
  const response = {
    type: 'torrent-subscribed',
    torrent: null,
    clientKey,
    torrentKey
  }

  if (torrent) {
    const infoMessage = getInfoMessage(server, torrent, '')
    const progressMessage = getProgressMessage(server, torrent, '')
    response.torrent = Object.assign(infoMessage.torrent, progressMessage.torrent)
  }

  server._send(response)
}

function handleAddTorrent (server, message) {
  const wt = server.webtorrent()

  // First, see if we've already joined this swarm
  const parsed = parseTorrent(message.torrentID)
  const infohash = parsed.infoHash
  let torrent = wt.torrents.find((t) => t.infoHash === infohash)

  // If not, join the swarm
  if (!torrent) {
    if (server._options.trace) console.log('joining swarm: ' + infohash + ' ' + (parsed.name || ''))
    torrent = wt.add(message.torrentID, message.options)
    torrent.clients = []
    server._torrents.push(torrent)
    addTorrentEvents(server, torrent)
  }

  // Either way, subscribe this client to future updates for this swarm
  const {clientKey, torrentKey} = message
  torrent.clients.push({clientKey, torrentKey})

  // If we want a server, create a server and wait for it to start listening
  const respond = () => sendSubscribed(server, torrent, clientKey, torrentKey)
  if (message.options.server) createServer(torrent, message.server, respond)
  else respond()
}

function handleCreateServer (server, message) {
  const {clientKey, torrentKey} = message
  const torrent = getTorrentByKey(server, torrentKey)
  if (!torrent) return
  createServer(torrent, message.options, function () {
    const {serverURL} = torrent
    server._send({clientKey, torrentKey, serverURL, type: 'server-ready'})
  })
}

function createServer (torrent, options, callback) {
  if (torrent.serverURL) {
    // Server already exists. Call back right away
    callback()
  } else if (torrent.pendingServerCallbacks) {
    // Server pending
    // listen() has already been called, but the 'listening' event hasn't fired yet
    torrent.pendingServerCallbacks.push(callback)
  } else {
    // Server does not yet exist. Create it, then notify everyone who asked for it
    torrent.pendingServerCallbacks = [callback]
    console.log('DBG SERVER')
    torrent.server = torrent.createServer(options)
    torrent.server.listen(function () {
      console.log('DBG DONE')
      const addr = torrent.server.address()
      torrent.serverURL = 'http://localhost:' + addr.port
      torrent.pendingServerCallbacks.forEach(cb => cb())
      delete torrent.pendingServerCallbacks
    })
  }
}

function handleHeartbeat (server, message) {
  const client = server._clients[message.clientKey]
  if (!client) return console.error('skipping heartbeat for unknown clientKey ' + message.clientKey)
  client.heartbeat = new Date().getTime()
}

function sendInfo (server, torrent, type) {
  const message = getInfoMessage(server, torrent, type)
  sendToTorrentClients(server, torrent, message)
}

function sendProgress (server, torrent, type) {
  const message = getProgressMessage(server, torrent, type)
  sendToTorrentClients(server, torrent, message)
}

function getInfoMessage (server, torrent, type) {
  return {
    type: type,
    torrent: {
      name: torrent.name,
      infohash: torrent.infoHash,
      length: torrent.length,
      serverURL: torrent.serverURL,
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
  const message = {
    type: type, // 'warning' or 'error'
    error: {message: e.message, stack: e.stack}
  }
  if (torrent) sendToTorrentClients(server, torrent, message)
  else sendToAllClients(server, message)
}

function sendUpdates (server) {
  let heartbeatTimeout = server._options.heartbeatTimeout
  if (heartbeatTimeout == null) heartbeatTimeout = 30000
  if (heartbeatTimeout > 0) removeDeadClients(server, heartbeatTimeout)
  server._torrents.forEach(function (torrent) {
    sendProgress(server, torrent, 'update')
  })
}

function removeDeadClients (server, heartbeatTimeout) {
  const now = new Date().getTime()
  const isDead = (client) => now - client.heartbeat > heartbeatTimeout
  const deadClientKeys = {}
  const trace = server._options.trace
  for (const clientKey in server._clients) {
    const client = server._clients[clientKey]
    if (!isDead(client)) continue
    if (trace) console.log('torrent client died, clientKey: ' + clientKey)
    deadClientKeys[clientKey] = true
    delete server._clients[clientKey]
  }
  if (Object.keys(deadClientKeys).length === 0) return

  // Remove listeners from torrents
  // If a torrent has no listeners left, kill the torrent
  server._torrents.forEach((torrent) => {
    torrent.clients = torrent.clients.filter((c) => !deadClientKeys[c.clientKey])
    if (torrent.clients.length > 0) return
    torrent.destroy()
    if (trace) console.log('torrent destroyed, all clients died: ' + torrent.name)
  })

  // Remove torrents. If the last torrent is gone, kill the client
  server._torrents = server._torrents.filter((t) => !t.destroyed)
  if (server._torrents.length > 0 || !server._webtorrent) return
  server._webtorrent.destroy()
  server._webtorrent = null
  if (trace) console.log('torrent instance destroyed, all torrents gone')
}

function sendToTorrentClients (server, torrent, message) {
  torrent.clients.forEach(function (client) {
    const clientMessage = Object.assign({}, message, client)
    server._send(clientMessage)
  })
}

function sendToAllClients (server, message) {
  for (const clientKey in server._clients) {
    const clientMessage = Object.assign({}, message, {clientKey})
    server._send(clientMessage)
  }
}

function getTorrentByKey (server, torrentKey) {
  const torrent = server.webtorrent().torrents.find((t) => hasTorrentKey(t, torrentKey))
  if (!torrent) {
    const message = 'missing torrentKey: ' + torrentKey
    sendError(server, null, {message}, 'warning')
  }
  return torrent
}

// Each torrent corresponds to *one or more* torrentKeys
// That's because clients generate torrentKeys independently, and we might have two clients that
// both added a torrent with the same infohash. (In that case, two RemoteTorrent objects correspond
// to the same WebTorrent torrent object.)
function hasTorrentKey (torrent, torrentKey) {
  return torrent.clients.some((c) => c.torrentKey === torrentKey)
}

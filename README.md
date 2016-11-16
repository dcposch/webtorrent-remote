# webtorrent-remote

Run WebTorrent in one process, control it from another process or even another machine.

## server process
```js
var WebTorrentRemoteServer = require('webtorrent-remote/server')

var options = null
var server = new WebTorrentRemoteServer(send, options)

function send (message) {
  // Send `message` to the correct client. It's JSON serializable.
  // Use TCP, some kind of IPC, whatever.
  // If there are multiple clients, look at message.clientID
}

// When messages come back from the IPC channel, call:
server.receive(message)
```

### server options
- `trace`: enable log output. default false. useful for debugging and for visibility.

  example log output:

  ```
  adding  client, clientKey: e63820e1409b7ccd53106aa164d18e74
  joining swarm: a88fda5954e89178c372716a6a78b8180ed4dad3 The WIRED CD - Rip. Sample. Mash. Share
  adding  client, clientKey: 0b634c3fb8f64a88906fa6f4b24c7af0
  joining swarm: 6a9759bffd5c0af65319979fb7832189f4f3c35d sintel.mp4
  adding  client, clientKey: 129e327bb95520546b7b93b1cdf5c07e
  joining swarm: 02767050e0be2fd4db9a2ad6c12416ac806ed6ed tears_of_steel_1080p.webm
  torrent client died, clientKey: 0b634c3fb8f64a88906fa6f4b24c7af0
  torrent destroyed, all clients died: sintel.mp4
  ```

- `heartbeatTimeout`: remove clients if we don't hear a heartbeat for this many milliseconds.
  default 30000 (30 seconds). set to 0 to disable the heartbeat check. once a torrent has no
  remaining clients, it will be removed. once there are no remaining torrents, the whole webtorrent
  instance will be destroyed. the webtorrent instance is created lazily the first time a client
  calls `add()`.

- `updateInterval`: send progress updates every x milliseconds to all clients of all torrents.
  default 1000 (1 second). set to 0 to disable progress updates.

- all WebTorrent options. the options object is passed to the constructor for the underlying
  WebTorrent instance.

client process(es)
---
```js
var WebTorrentRemoteClient = require('webtorrent-remote/client')

var options = null
var client = new WebTorrentRemoteClient(send, options)

function send (message) {
  // Same as above, except send the message to the server process
}

// When messages come back from the server, call:
client.receive(message)


// Now `client` is a drop-in replacement for the normal WebTorrent object!
var torrent = client.add('magnet:?xt=urn:btih:6a9759bffd5c0af65319979fb7832189f4f3c35d')

torrent.on('metadata', function () {
  console.log(JSON.stringify(torrent.files))
  // Prints [{name:'sintel.mp4'}]
})

torrent.createServer()

torrent.on('server-ready', function () {
  console.log(torrent.serverURL)
  // Paste that into your browser to stream Sintel!
})

```

### client options
- `heartbeat`: send a heartbeat once every x milliseconds. default 5000 (5 seconds). set to 0 to
  disable heartbeats.

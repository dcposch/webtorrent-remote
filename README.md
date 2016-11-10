webtorrent-remote
===

Run WebTorrent in one process, control it from another process or even another machine.

server process
---
```js
var WebTorrentRemoteServer = require('webtorrent-remote/server')

var server = new WebTorrentRemoteServer(send)

function send (message) {
  // Send `message` to the correct client. It's JSON serializable.
  // Use TCP, some kind of ICP, whatever.
  // If there are multiple clients, look at message.clientID
}

// When messages come back from the IPC channel, call:
server.receive(message)
```

client process(es)
---
```js
var WebTorrentRemoteClient = require('webtorrent-remote/client')

var client = new WebTorrentRemoteClient(send)

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

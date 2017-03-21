# webtorrent-remote [![npm][npm-image]][npm-url] [![downloads][downloads-image]][downloads-url] [![javascript style guide][standard-image]][standard-url]

[npm-image]: https://img.shields.io/npm/v/webtorrent-remote.svg
[npm-url]: https://npmjs.org/package/webtorrent-remote
[downloads-image]: https://img.shields.io/npm/dm/webtorrent-remote.svg
[downloads-url]: https://npmjs.org/package/webtorrent-remote
[standard-image]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com

run WebTorrent in one process, control it from another process or even another machine.

plain Javascript, no es6

## server process

```js
var WebTorrentRemoteServer = require('webtorrent-remote/server')

var opts = null
var server = new WebTorrentRemoteServer(send, opts)

function send (message) {
  // Send `message` to the correct client. It's JSON serializable.
  // Use TCP, some kind of IPC, whatever.
  // If there are multiple clients, look at message.clientKey
}

// When messages come back from the IPC channel, call:
server.receive(message)
```

### server options

#### `opts.heartbeatTimeout`

remove clients if we don't hear a heartbeat for this many milliseconds. default
30000 (30 seconds). set to 0 to disable the heartbeat check. once a torrent has no
remaining clients, it will be removed. once there are no remaining torrents, the
whole webtorrent   instance will be destroyed. the webtorrent instance is created
lazily the first time a client   calls `add()`.

#### `opts.updateInterval`

send progress updates every x milliseconds to all clients of all torrents. default
1000 (1 second). set to 0 to disable progress updates.

#### other options

all WebTorrent options. the options object is passed to the constructor for the
underlying WebTorrent instance.

#### debugging

This package uses [`debug`](https://www.npmjs.com/package/debug) for debug logging. Set the environment variable `DEBUG=webtorrent-remote` for detailed debug logs.

## client process(es)

```js
var WebTorrentRemoteClient = require('webtorrent-remote/client')

var opts = null
var client = new WebTorrentRemoteClient(send, opts)

function send (message) {
  // Same as above, except send the message to the server process
}

// When messages come back from the server, call:
client.receive(message)

// Now `client` is a drop-in replacement for the normal WebTorrent object!
var torrentId = 'magnet:?xt=urn:btih:6a9759bffd5c0af65319979fb7832189f4f3c35d'
client.add(torrentId, function (err, torrent) {
  torrent.on('metadata', function () {
    console.log(JSON.stringify(torrent.files))
    // Prints [{name:'sintel.mp4'}]
  })

  var server = torrent.createServer()
  server.listen(function () {
    console.log('http://localhost:' + server.address().port)
    // Paste that into your browser to stream Sintel!
  })
})
```

### client options

#### `opts.heartbeat`

send a heartbeat once every x milliseconds. default 5000 (5 seconds). set to 0 to
disable heartbeats.

### client methods

#### `client.add(torrentID, [options], callback)`

like `WebTorrent.add`, but only async. calls back with `(err, torrent)`. The
`torrent` is a torrent object (see below for methods).

#### `client.get(torrentID, callback)`

like `WebTorrent.get`, but async. calls back with `(err, torrent)`. if the
torrentId is not yet in the client, `err.name` will be `'TorrentMissingError'`.

#### `client.destroy()`

like `WebTorrent.destroy`, but destroys only this client. if a given torrent has
no clients left, it will be destroyed too. if all torrents are gone, the whole
WebTorrent instance will be destroyed on the server side.

### client events, from webtorrent

- `client.on('error', () => {...})`
- `client.on('warning', () => {...})`

### torrent methods

the client gives you a torrent object in the callback to `get` or `add`. this
supports a subset of the WebTorrent API, forwarding commands to the
WebTorrentRemoteServer and emitting events:

#### `torrent.createServer()`

create a local torrent-to-HTTP streaming server.

### torrent events, unique to webtorrent-remote, not in webtorrent

- `torrent.on('update', () => {...})`: fires periodically, see `updateInterval`

### torrent events, from webtorrent

- `torrent.on('infohash', () => {...})`
- `torrent.on('metadata', () => {...})`
- `torrent.on('download', () => {...})`
- `torrent.on('upload', () => {...})`
- `torrent.on('done', () => {...})`
- `torrent.on('error', () => {...})`
- `torrent.on('warning', () => {...})`

### torrent props unique to webtorrent-remote, not in webtorrent

- `torrent.client`: the WebTorrentRemoteClient
- `torrent.key`: the clientKey used for messaging

### torrent props, from webtorrent (updated once on `infohash` or `metadata`)

- `torrent.infoHash`
- `torrent.name`
- `torrent.length`
- `torrent.files`

### torrent props, from webtorrent (updated on every `progress` event)

- `torrent.progress`
- `torrent.downloaded`
- `torrent.uploaded`
- `torrent.downloadSpeed`
- `torrent.uploadSpeed`
- `torrent.numPeers`
- `torrent.progress`
- `torrent.timeRemaining`

### server methods

#### `server.address()`

gets an address object like `{ address: '::', family: 'IPv6', port: 52505 }` that
shows what host and port the server is listening on.

#### `server.listen(onlistening)`

tells the server to start listening. the `onlistening` function is called when the server starts listening.

### server events

- `server.on('listening', () => {...})`

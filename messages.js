const _ = null

// Message type constants.
// Use messages.ADD_TORRENT to get 'add-torrent', and so on.
module.exports = map({
  // Client to server
  ADD_TORRENT: _,
  CREATE_SERVER: _,

  // Server to client
  INFOHASH: _,
  METADATA: _,
  PROGRESS: _,
  DONE: _,
  SERVER_READY: _,
  ERROR: _
})

function map (dict) {
  for (var key in dict) {
    dict[key] = key.toLowerCase().replace(/_/g, '-')
  }
  return dict
}

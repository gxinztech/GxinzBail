# gxinztech-baileys

**Modded Baileys: buttons, albums, formatted replies and channel helpers**
*Modification by gxinztech | Based on WhiskeySockets/Baileys*

---

gxinztech-baileys is a modified build of [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys). Everything upstream does still works. This fork adds a few helpers for buttons, albums, formatted replies and WhatsApp channels.

> Not affiliated with, endorsed by, or connected to WhatsApp or Meta. WhatsApp can restrict or ban numbers that use unofficial clients, so try things on a spare number first and use this at your own risk.

---

## Features

| Feature | Description | Status |
|---------|-------------|--------|
| Pairing code | `requestPairingCode(number)` returns a random 8-character code, or the one you pass | ✅ |
| Auto-follow channel | Opt-in: follows a channel of your choice on connect | ✅ |
| Send rate limiter | Paces outgoing messages, retries on `rate-overlimit` | ✅ |
| Auto-reconnect | `makeAutoReconnect` with backoff, stops on logout/ban | ✅ |
| Hardened auth state | Atomic writes, `creds.json` backup, safe file names | ✅ |
| Interactive buttons | `sendInteractive` with reply, url, copy and call buttons | ✅ |
| Formatted replies | `sendTable`, `sendList`, `sendCodeBlock` as formatted text | ✅ |
| Channel lookup | `cekIDSaluran` resolves a channel link to its metadata | ✅ |
| Album messages | `sendAlbum` sends several images or videos as one album | ✅ |
| Native rich cards | `rich: true` on the helpers above | ✅ |
| Dual build | ESM (`import`) and CommonJS (`require`) | ✅ |

✅ confirmed working.

---

## Requirements

- Node.js 20 or newer
- Works with `import` and `require`

---

## Installation

```bash
npm install gxinztech-baileys
```

If your code already imports `@whiskeysockets/baileys`, alias it and keep your imports as they are:

```json
"dependencies": {
  "@whiskeysockets/baileys": "npm:gxinztech-baileys@latest"
}
```

---

## Quick start

### Import

ESM:

```js
import makeWASocket, { useMultiFileAuthState } from 'gxinztech-baileys'
```

CommonJS:

```js
const { default: makeWASocket, useMultiFileAuthState } = require('gxinztech-baileys')
```

### Connect with a pairing code

```js
const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({ auth: state })

sock.ev.on('creds.update', saveCreds)

let asked = false
sock.ev.on('connection.update', async ({ qr, connection }) => {
  if (qr && !asked && !sock.authState.creds.registered) {
    asked = true
    const code = await sock.requestPairingCode('628xxxxxxxxxx')
    console.log('Pairing code:', code) // random, e.g. 7K2M9QXD
  }
  if (connection === 'open') console.log('connected')
})
```

A random code is generated for every request. To use your own, pass 8 characters as the second argument (for example `'GXINTECH'`):

```js
await sock.requestPairingCode('628xxxxxxxxxx', 'ABCD1234')
```

Events, media, groups and auth state work the way they do upstream. Their [wiki](https://baileys.wiki) covers all of that.

---

## Sending messages

### Text

```js
await sock.sendMessage(jid, { text: 'Hello!' })
```

### Buttons

Button types: `reply`, `url`, `copy`, `call`.

```js
await sock.sendInteractive(jid, {
  title: 'Menu',
  text: 'Pick one',
  footer: 'gxinztech',
  buttons: [
    { type: 'reply', text: 'Menu', id: '.menu' },
    { type: 'url', text: 'Website', url: 'https://example.com' },
    { type: 'copy', text: 'Copy code', code: 'GXINTECH' },
    { type: 'call', text: 'Call', phone: '628xxxxxxxxxx' }
  ]
})
```

A `reply` button sends its `id` back to your bot as a normal text message. Handling it is up to your own message listener.

### Album

Needs at least two items.

```js
await sock.sendAlbum(jid, [
  { image: { url: './one.jpg' }, caption: 'First' },
  { image: { url: './two.jpg' } },
  { video: { url: './clip.mp4' }, caption: 'Clip' }
])
```

### Table

```js
await sock.sendTable(jid, 'Java vs JavaScript', ['Feature', 'Java', 'JS'], [
  ['Typing', 'Static', 'Dynamic'],
  ['Runs on', 'JVM', 'Everywhere']
])
```

### List

```js
await sock.sendList(jid, 'Bot info', [
  ['Name', 'Gxinz'],
  ['Version', '1.0.0']
])
```

### Code block

```js
await sock.sendCodeBlock(jid, 'console.log("hi")', { language: 'javascript' })
```

Options shared by the three helpers above: `atas` (text above), `bawah` (text below), `quoted` (message to reply to).

They send plain formatted text by default so they show up on any account. Pass `rich: true` to send WhatsApp's native rich response card instead. It is confirmed working.

---

## Channels

```js
// Look up a channel from its link (or just the code at the end)
const info = await sock.cekIDSaluran('https://whatsapp.com/channel/CODE')
console.log(info.id, info.name)

// Follow a channel
await sock.newsletterFollow('120363xxxxxxxxxx@newsletter')
```

### Auto-follow

Off by default. Following a channel changes the user's account, so it only happens when you ask for it:

```js
const sock = makeWASocket({
  auth: state,
  autoFollowChannel: '120363xxxxxxxxxx@newsletter'
})
```

Each channel is followed once per process, not on every reconnect.

---

## Stability and safety

### Rate limiting

Outgoing `sendMessage` / `relayMessage` calls (and the helpers built on them) go through a queue. One reply to an idle chat is sent immediately; bursts are spread out, order inside a chat is kept, and a WhatsApp `rate-overlimit` answer pauses sending for the whole account and retries with backoff.

```js
const sock = makeWASocket({
  auth: state,
  sendRateLimit: {            // every field is optional, these are the defaults
    globalMinDelayMs: 300,    // gap between any two sends
    perChatMinDelayMs: 1000,  // gap between two sends to the same chat
    jitterMs: 250,            // random extra delay
    maxPerWindow: 40,         // at most 40 sends ...
    windowMs: 30000,          // ... per 30 seconds
    maxQueueSize: 500,        // beyond this, sends are rejected instead of piling up
    maxRetries: 3
  }
})

await sock.sendMessage(jid, { text: 'urgent' }, { skipRateLimit: true }) // bypass once
sock.getSendQueueStats()   // { pending, activeChats, pausedForMs }
sock.pauseSending(60_000)  // stop all sending for a minute
```

Pass `sendRateLimit: false` to disable it. Group member lists are cached for 5 minutes (and dropped when the group changes), so sending to a group no longer asks the server for the member list every time. Pass your own `cachedGroupMetadata` to replace that cache.

### Staying logged in

`useMultiFileAuthState` writes through a temp file and renames it, keeps `creds.json.bak`, and restores from it if `creds.json` is ever missing or unreadable. Session files are `0600` and the folder `0700`.

`makeAutoReconnect` rebuilds the socket when the connection drops, and knows when not to:

```js
import makeWASocket, { makeAutoReconnect, useMultiFileAuthState } from 'gxinztech-baileys'
import { rm } from 'node:fs/promises'

const bot = makeAutoReconnect(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('messages.upsert', handleMessages)
  return sock                                   // attach all your listeners here
}, {
  onLoggedOut: async () => {                    // 401: session is gone
    await rm('auth', { recursive: true, force: true })
    return true                                 // true = start again and pair a new session
  },
  onGiveUp: ({ reason }) => console.log('stopped:', reason) // banned, replaced, or too many failures
})
```

| Close reason | What happens |
|--------------|--------------|
| connection lost / timed out / 503 | reconnect with exponential backoff (1s up to 60s) |
| restart required (515, after pairing) | reconnect immediately |
| logged out (401) | no reconnect, `onLoggedOut` decides |
| forbidden (403), replaced (440), multi-device mismatch | no reconnect, `onGiveUp` |
| 10 failures in a row | `onGiveUp` |

Run one process per session folder. Two processes on the same session replace each other (440) and that is a common cause of being logged out.

### Other hardening

- Video thumbnails call `ffmpeg` without a shell, so a file name can no longer inject commands.
- Remote media and link-preview thumbnail images refuse localhost, private networks and cloud metadata addresses, also after redirects. (The link-preview page itself is fetched by `link-preview-js`, which this does not cover.) If you serve media from your own network, pass `options: { allowPrivateNetwork: true }` in the socket config.
- `syncFullHistory` and `markOnlineOnConnect` now default to `false`.
- If you pass user input as `{ image: { url } }`, validate it first: a path that is not `http(s)://` is read from the local disk.

---

## Notes

- Buttons and rich messages depend on the WhatsApp version and can stop working whenever WhatsApp changes things.
- The package ships prebuilt, `lib` for ESM and `cjs` for CommonJS, so there is no build step on install.

---

## Credits

- [WhiskeySockets](https://github.com/WhiskeySockets/Baileys): original Baileys
- gxinztech: modification and maintenance

Released under the MIT license. The original copyright notice is kept in `LICENSE`.

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
| Default pairing code | `requestPairingCode(number)` returns `GXINTECH` unless you pass your own | ✅ |
| Auto-follow channel | Follows a channel on connect, can be disabled | ✅ |
| Interactive buttons | `sendInteractive` with reply, url, copy and call buttons | ✅ |
| Formatted replies | `sendTable`, `sendList`, `sendCodeBlock` as formatted text | ✅ |
| Channel lookup | `cekIDSaluran` resolves a channel link to its metadata | ✅ |
| Album messages | `sendAlbum` sends several images or videos as one album | 🧪 |
| Native rich cards | `rich: true` on the helpers above | ⚠️ |
| Dual build | ESM (`import`) and CommonJS (`require`) | ✅ |

✅ confirmed working, 🧪 implemented but not tested yet, ⚠️ experimental. Not every WhatsApp client renders the experimental ones.

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
    console.log('Pairing code:', code) // GXINTECH
  }
  if (connection === 'open') console.log('connected')
})
```

To use your own code, pass 8 characters as the second argument:

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

They send plain formatted text by default so they show up on any account. Pass `rich: true` to send WhatsApp's native rich response card instead. It's experimental, and on a regular account the card did not show up for the receiver in testing.

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

On connect, the socket follows the gxinztech channel. That is the default, and you should know about it before you ship this to other people. Turn it off with:

```js
const sock = makeWASocket({ auth: state, autoFollowChannel: false })
```

Or point it at a channel of your own:

```js
const sock = makeWASocket({
  auth: state,
  autoFollowChannel: '120363xxxxxxxxxx@newsletter'
})
```

---

## Notes

- Buttons and rich messages depend on the WhatsApp version and can stop working whenever WhatsApp changes things.
- The package ships prebuilt, `lib` for ESM and `cjs` for CommonJS, so there is no build step on install.

---

## Credits

- [WhiskeySockets](https://github.com/WhiskeySockets/Baileys): original Baileys
- gxinztech: modification and maintenance

Released under the MIT license. The original copyright notice is kept in `LICENSE`.

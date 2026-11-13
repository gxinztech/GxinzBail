import { LRUCache } from 'lru-cache';
import { proto } from '../../WAProto/index.js';
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { generateWAMessageFromContent } from '../Utils/messages.js';
import { makeSendLimiter } from '../Utils/send-limiter.js';
import { makeCommunitiesSocket } from './communities.js';
import { bikinRich } from './rich.js';
const bikinTombol = (b) => {
    switch (b.type) {
        case 'reply':
            return {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id })
            };
        case 'url':
            return {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({ display_text: b.text, url: b.url, merchant_url: b.url })
            };
        case 'copy':
            return {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({ display_text: b.text, copy_code: b.code })
            };
        case 'call':
            return {
                name: 'cta_call',
                buttonParamsJson: JSON.stringify({ display_text: b.text, phone_number: b.phone })
            };
        default:
            throw new Error('Tipe tombol tidak dikenal');
    }
};
// channels already followed by this process, so a reconnect does not repeat the follow request
const sudahDifollow = new Set();
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const logger = newConfig.logger;
    // Every send to a group needs the member list. Without a cache that is one extra network query per message,
    // which is a common reason for rate-overlimit. Cache it (5 min) and drop it when the group changes.
    // A cachedGroupMetadata passed by the caller always wins.
    let baseSock;
    const groupCache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });
    const groupInflight = new Map();
    if (!config?.cachedGroupMetadata) {
        newConfig.cachedGroupMetadata = async (jid) => {
            const hit = groupCache.get(jid);
            if (hit) {
                return hit;
            }
            let pending = groupInflight.get(jid);
            if (!pending) {
                pending = baseSock
                    .groupMetadata(jid)
                    .then(meta => {
                    groupCache.set(jid, meta);
                    return meta;
                })
                    .finally(() => groupInflight.delete(jid));
                groupInflight.set(jid, pending);
            }
            return pending;
        };
    }
    const sock = makeCommunitiesSocket(newConfig);
    baseSock = sock;
    const dropGroup = (id) => {
        if (id) {
            groupCache.delete(id);
        }
    };
    sock.ev.on('groups.update', updates => updates.forEach(u => dropGroup(u.id)));
    sock.ev.on('groups.upsert', groups => groups.forEach(g => dropGroup(g.id)));
    sock.ev.on('group-participants.update', ({ id }) => dropGroup(id));
    // Outgoing message pacing. `sendRateLimit: false` turns it off, `skipRateLimit: true` in the send options bypasses it once.
    const limiter = newConfig.sendRateLimit === false ? undefined : makeSendLimiter(newConfig.sendRateLimit, logger);
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'close') {
            limiter?.destroy();
        }
    });
    const sendMessage = (jid, content, options = {}) => {
        const { skipRateLimit, ...rest } = options ?? {};
        const run = () => sock.sendMessage(jid, content, { ...rest, useCachedGroupMetadata: rest.useCachedGroupMetadata ?? true });
        return limiter && !skipRateLimit ? limiter.schedule(jid, run) : run();
    };
    const relayMessage = (jid, message, opts = {}) => {
        const { skipRateLimit, ...rest } = opts ?? {};
        const run = () => sock.relayMessage(jid, message, { ...rest, useCachedGroupMetadata: rest.useCachedGroupMetadata ?? true });
        return limiter && !skipRateLimit ? limiter.schedule(jid, run) : run();
    };
    // the helpers below send through the paced versions
    const paced = { ...sock, sendMessage, relayMessage };
    // opt-in only: following a channel on someone else's account should never happen without them choosing it
    const channel = config?.autoFollowChannel;
    if (channel) {
        sock.ev.on('connection.update', async ({ connection }) => {
            const key = `${sock.user?.id ?? ''}|${channel}`;
            if (connection === 'open' && !sudahDifollow.has(key)) {
                sudahDifollow.add(key);
                try {
                    await sock.newsletterFollow(channel);
                    logger.info({ channel }, 'auto-follow: followed channel');
                }
                catch (e) {
                    sudahDifollow.delete(key);
                    logger.warn({ channel, err: e?.message }, 'auto-follow failed');
                }
            }
        });
    }
    const cekIDSaluran = async (link) => {
        const kode = link.match(/channel\/([A-Za-z0-9_-]+)/)?.[1] ?? link.trim();
        return sock.newsletterMetadata('invite', kode);
    };
    const sendAlbum = async (jid, items, options) => {
        if (!items || items.length < 2) {
            throw new Error('Album minimal 2 media');
        }
        const expectedImageCount = items.filter(i => i.image).length;
        const expectedVideoCount = items.filter(i => i.video).length;
        const parent = await sendMessage(jid, { album: { expectedImageCount, expectedVideoCount } }, options);
        const hasil = [parent];
        for (const item of items) {
            const msg = await sendMessage(jid, { ...item, albumParentKey: parent.key }, options);
            hasil.push(msg);
            if (!limiter) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        return hasil;
    };
    const sendInteractive = async (jid, opsi, options) => {
        if (!opsi?.buttons?.length) {
            throw new Error('Minimal 1 tombol');
        }
        const interactiveMessage = proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({ text: opsi.text }),
            footer: proto.Message.InteractiveMessage.Footer.create({ text: opsi.footer ?? '' }),
            header: proto.Message.InteractiveMessage.Header.create({
                title: opsi.title ?? '',
                subtitle: '',
                hasMediaAttachment: false
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: opsi.buttons.map(bikinTombol),
                messageParamsJson: ''
            })
        });
        const quoted = options?.quoted;
        if (quoted?.message) {
            interactiveMessage.contextInfo = {
                stanzaId: quoted.key.id,
                participant: quoted.key.participant || quoted.key.remoteJid,
                quotedMessage: quoted.message
            };
        }
        const msg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage
                }
            }
        }, { userJid: sock.user?.id ?? '' });
        const nodes = [
            {
                tag: 'biz',
                attrs: {},
                content: [
                    {
                        tag: 'interactive',
                        attrs: { type: 'native_flow', v: '1' },
                        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                    }
                ]
            }
        ];
        if (!jid.endsWith('@g.us')) {
            nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
        }
        await relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: nodes
        });
        return msg;
    };
    // Kirim poll. Dipakai lewat antrean rate limit seperti pesan lain.
    const sendPoll = (jid, name, values, opsi = {}) => {
        const judul = typeof name === 'string' ? name.trim() : '';
        if (!judul) {
            throw new Error('Judul poll tidak boleh kosong');
        }
        const pilihan = Array.isArray(values) ? values.map(v => String(v).trim()).filter(Boolean) : [];
        if (pilihan.length < 2 || pilihan.length > 12) {
            throw new Error('Poll butuh 2 sampai 12 pilihan');
        }
        if (new Set(pilihan).size !== pilihan.length) {
            throw new Error('Pilihan poll tidak boleh kembar');
        }
        const { selectableCount = 1, quoted, ...lainnya } = opsi;
        if (!Number.isInteger(selectableCount) || selectableCount < 0 || selectableCount > pilihan.length) {
            throw new Error('selectableCount harus 0 sampai jumlah pilihan (0 = boleh pilih semua)');
        }
        return sendMessage(jid, { poll: { name: judul, values: pilihan, selectableCount } }, { quoted, ...lainnya });
    };
    // Kirim link dengan preview (kartu judul, gambar, deskripsi). Preview butuh paket link-preview-js di bot.
    // Teks boleh memakai {{IE_0}}label{{/IE_0}}: diganti jadi "label URL ke-0".
    const sendLink = (jid, teks, url, opsi = {}) => {
        const daftar = (Array.isArray(url) ? url : [url]).map(u => String(u ?? '').trim()).filter(Boolean);
        if (!daftar.length || daftar.some(u => !/^https?:\/\/\S+$/i.test(u))) {
            throw new Error('sendLink butuh URL http(s) yang valid');
        }
        let isi = String(teks ?? '').replace(/\{\{IE_(\d+)\}\}([\s\S]*?)\{\{\/IE_\1\}\}/g, (semua, n, label) => {
            const u = daftar[Number(n)];
            return u ? label + ' ' + u : label;
        });
        for (const u of daftar) {
            if (!isi.includes(u)) {
                isi += (isi ? '\n' : '') + u;
            }
        }
        // citations tidak didukung protokol, jadi sengaja diabaikan
        const { headerText, footer, quoted, citations, ...lainnya } = opsi;
        const bagian = [headerText ? '*' + headerText + '*' : '', isi, footer ? '_' + footer + '_' : ''].filter(Boolean).join('\n\n');
        return sendMessage(jid, { text: bagian }, { quoted, ...lainnya });
    };
    // Kirim permintaan pembayaran. Tampil penuh hanya di negara yang punya WhatsApp Pay.
    const sendPaymentRequest = async (jid, data = {}, opsi = {}) => {
        const { amount, currency = 'IDR', note, expiresInSec, from } = data;
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('amount harus angka lebih dari 0');
        }
        const mata = String(currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(mata)) {
            throw new Error('currency harus kode 3 huruf, contoh IDR');
        }
        const minta = from ?? (jid.endsWith('@g.us') ? undefined : jid);
        if (!minta) {
            throw new Error('Di grup, isi "from" dengan JID orang yang diminta membayar');
        }
        const nilai = Math.round(amount * 1000);
        const permintaan = {
            currencyCodeIso4217: mata,
            amount1000: nilai,
            requestFrom: minta,
            amount: { value: nilai, offset: 1000, currencyCode: mata }
        };
        if (note) {
            permintaan.noteMessage = { extendedTextMessage: { text: String(note) } };
        }
        if (expiresInSec > 0) {
            permintaan.expiryTimestamp = Math.floor(Date.now() / 1000) + Math.floor(expiresInSec);
        }
        const msg = generateWAMessageFromContent(jid, { requestPaymentMessage: permintaan }, { userJid: sock.user?.id ?? '', quoted: opsi.quoted });
        await relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    };
    // Kirim pesan produk katalog. Gambar wajib (url atau Buffer). Tombol tidak ada di protokol ProductMessage.
    const sendProduct = (jid, data = {}, opsi = {}) => {
        const { id, title, description, price, salePrice, currency = 'IDR', retailerId, url, image, thumbnail, businessOwnerJid, body, footer } = data;
        const gambar = image ?? thumbnail;
        if (!id || !title) {
            throw new Error('sendProduct butuh id dan title');
        }
        if (!Number.isFinite(price) || price < 0) {
            throw new Error('price harus angka 0 atau lebih');
        }
        if (!gambar) {
            throw new Error('sendProduct butuh image (contoh: { url: "https://..." } atau Buffer)');
        }
        const mata = String(currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(mata)) {
            throw new Error('currency harus kode 3 huruf, contoh IDR');
        }
        const pemilik = businessOwnerJid ?? (sock.user?.id ?? '').replace(/:\d+@/, '@');
        const product = {
            productId: String(id),
            title,
            description,
            currencyCode: mata,
            priceAmount1000: Math.round(price * 1000),
            retailerId,
            url,
            productImage: gambar
        };
        if (Number.isFinite(salePrice)) {
            product.salePriceAmount1000 = Math.round(salePrice * 1000);
        }
        const { quoted, ...lainnya } = opsi;
        return sendMessage(jid, { product, businessOwnerJid: pemilik, body, footer }, { quoted, ...lainnya });
    };
    // Kirim pesan order. status: INQUIRY, ACCEPTED atau DECLINED.
    const sendOrder = async (jid, data = {}, opsi = {}) => {
        const { orderId, itemCount = 1, status = 'INQUIRY', message, orderTitle, sellerJid, total, currency = 'IDR', token } = data;
        if (!orderId) {
            throw new Error('sendOrder butuh orderId');
        }
        if (!Number.isInteger(itemCount) || itemCount < 1) {
            throw new Error('itemCount harus bilangan bulat 1 atau lebih');
        }
        if (!Number.isFinite(total) || total < 0) {
            throw new Error('total harus angka 0 atau lebih');
        }
        const kodeStatus = proto.Message.OrderMessage.OrderStatus[String(status).toUpperCase()];
        if (!kodeStatus) {
            throw new Error('status harus INQUIRY, ACCEPTED atau DECLINED');
        }
        const mata = String(currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(mata)) {
            throw new Error('currency harus kode 3 huruf, contoh IDR');
        }
        const penjual = sellerJid ?? (sock.user?.id ?? '').replace(/:\d+@/, '@');
        const orderMessage = {
            orderId: String(orderId),
            itemCount,
            status: kodeStatus,
            surface: proto.Message.OrderMessage.OrderSurface.CATALOG,
            message,
            orderTitle,
            sellerJid: penjual,
            totalAmount1000: Math.round(total * 1000),
            totalCurrencyCode: mata
        };
        if (token) {
            orderMessage.token = String(token);
        }
        const msg = generateWAMessageFromContent(jid, { orderMessage }, { userJid: sock.user?.id ?? '', quoted: opsi.quoted });
        await relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    };
    return {
        ...sock,
        sendMessage,
        relayMessage,
        cekIDSaluran,
        sendAlbum,
        sendInteractive,
        sendPoll,
        sendLink,
        sendPaymentRequest,
        sendProduct,
        sendOrder,
        ...bikinRich(paced),
        /** pending sends, active chats and how long sending is paused */
        getSendQueueStats: () => limiter?.stats() ?? { pending: 0, activeChats: 0, pausedForMs: 0 },
        /** pause all outgoing messages for `ms` milliseconds */
        pauseSending: (ms) => limiter?.pause(ms)
    };
};
export default makeWASocket;
//# sourceMappingURL=index.js.map
import { LRUCache } from 'lru-cache';
import { proto } from '../../WAProto/index.js';
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { generateWAMessageFromContent } from '../Utils/messages.js';
import { makeSendLimiter } from '../Utils/send-limiter.js';
import { makeCommunitiesSocket } from './communities.js';
import { bikinRich } from './rich.js';
import * as fsPoll from 'node:fs';
import { decryptPollVote } from '../Utils/process-message.js';
import { getAggregateVotesInPollMessage } from '../Utils/messages.js';
import { getKeyAuthor } from '../Utils/generics.js';
import { jidNormalizedUser } from '../WABinary/index.js';
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
// Pesan terima kasih, tampil sekali per proses. Matikan dengan makeWASocket({ banner: false }) atau env GXINZ_BANNER=off
let bannerSudahTampil = false;
const tampilBanner = (config) => {
    if (bannerSudahTampil) {
        return;
    }
    bannerSudahTampil = true;
    if (config?.banner === false || /^(0|off|false|no)$/i.test(process.env.GXINZ_BANNER ?? '')) {
        return;
    }
    console.log('\n✨ Thank you for choosing and using Baileys by GxinzTech!\n\nWe truly appreciate your support and trust. We hope you enjoy every feature and have a smooth experience with our service. 🚀\n');
};
const makeWASocket = (config) => {
    tampilBanner(config);
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
            ...(opsi.footer ? { footer: proto.Message.InteractiveMessage.Footer.create({ text: opsi.footer }) } : {}),
            ...(opsi.title ? { header: proto.Message.InteractiveMessage.Header.create({ title: opsi.title, hasMediaAttachment: false }) } : {}),
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
        // opt-in: bentuk node <biz> yang lebih baru (actual_actors, host_storage, quality_control). Belum pasti berhasil di semua versi WhatsApp
        if (opsi.bizV2) {
            nodes[0].attrs = { actual_actors: '2', host_storage: '2', privacy_mode_ts: String(Math.floor(Date.now() / 1000)) };
            nodes.splice(1, 0, {
                tag: 'quality_control',
                attrs: { decision_id: Array.from({ length: 20 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''), source_type: 'third_party' },
                content: [{ tag: 'decision_source', attrs: { value: 'df' } }]
            });
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
        return sendMessage(jid, { poll: { name: judul, values: pilihan, selectableCount } }, { quoted, ...lainnya }).then(m => {
            simpanPoll(m);
            return m;
        });
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
    // ---- onPollVote: pustaka bawaan tidak membuka suara poll, jadi dibuka di sini.
    // Poll yang dikirim lewat sendPoll disimpan di memori (maks 500). Poll lama / dari proses lain dicari lewat getMessage milikmu.
    const daftarPoll = new Map();
    const pendengarVote = new Set();
    // Penyimpanan poll ke file (opsi pollStorePath). Yang disimpan hanya poll (judul, pilihan, kunci), bukan isi suara.
    const berkasPoll = typeof newConfig.pollStorePath === 'string' && newConfig.pollStorePath ? newConfig.pollStorePath : undefined;
    let timerTulisPoll;
    const tulisPoll = () => {
        if (!berkasPoll) {
            return;
        }
        clearTimeout(timerTulisPoll);
        timerTulisPoll = setTimeout(() => {
            try {
                const data = [...daftarPoll.entries()].map(([id, p]) => {
                    const tipe = p.message.pollCreationMessageV3 ? 'pollCreationMessageV3' : p.message.pollCreationMessageV2 ? 'pollCreationMessageV2' : 'pollCreationMessage';
                    const isi = p.message[tipe] ?? {};
                    return {
                        id,
                        key: { remoteJid: p.key.remoteJid, fromMe: !!p.key.fromMe, id, participant: p.key.participant },
                        tipe,
                        name: isi.name,
                        count: isi.selectableOptionsCount,
                        options: (isi.options ?? []).map(o => o.optionName),
                        correct: isi.correctAnswer?.optionName,
                        secret: Buffer.from(p.secret).toString('base64')
                    };
                });
                const sementara = berkasPoll + '.tmp';
                fsPoll.writeFileSync(sementara, JSON.stringify(data));
                fsPoll.renameSync(sementara, berkasPoll);
            }
            catch (err) {
                logger?.warn({ err }, 'gagal menyimpan daftar poll');
            }
        }, 500);
        timerTulisPoll.unref?.();
    };
    if (berkasPoll) {
        try {
            for (const p of JSON.parse(fsPoll.readFileSync(berkasPoll, 'utf8'))) {
                const isi = { name: p.name, selectableOptionsCount: p.count, options: (p.options ?? []).map(optionName => ({ optionName })) };
                if (p.correct) {
                    isi.correctAnswer = { optionName: p.correct };
                }
                daftarPoll.set(p.id, { key: p.key, message: { [p.tipe]: isi }, secret: Buffer.from(p.secret, 'base64'), suara: new Map() });
            }
        }
        catch {
            // belum ada file atau rusak: mulai dari kosong
        }
    }
    const simpanPoll = (msg) => {
        const id = msg?.key?.id;
        const isi = msg?.message;
        if (!id || !isi) {
            return;
        }
        const secret = isi.messageContextInfo?.messageSecret;
        if (!secret) {
            return;
        }
        daftarPoll.delete(id);
        daftarPoll.set(id, { key: msg.key, message: isi, secret, suara: new Map() });
        tulisPoll();
        if (daftarPoll.size > 500) {
            daftarPoll.delete(daftarPoll.keys().next().value);
        }
    };
    const bukaVote = async (msg) => {
        const upd = msg.message?.pollUpdateMessage;
        if (!upd || !pendengarVote.size) {
            return;
        }
        const kunci = upd.pollCreationMessageKey;
        if (!kunci?.id) {
            return;
        }
        let poll = daftarPoll.get(kunci.id);
        if (!poll && newConfig.getMessage) {
            const asal = await newConfig.getMessage(kunci).catch(() => undefined);
            const secret = asal?.messageContextInfo?.messageSecret;
            if (asal && secret) {
                poll = { key: kunci, message: asal, secret, suara: new Map() };
                daftarPoll.set(kunci.id, poll);
            }
        }
        if (!poll) {
            logger?.warn({ pollId: kunci.id }, 'poll tidak ditemukan, suara tidak bisa dibuka (poll harus dikirim lewat sendPoll di proses ini, atau getMessage mengembalikannya)');
            return;
        }
        const aku = [sock.user?.id, sock.user?.lid].filter(Boolean).map(j => jidNormalizedUser(j));
        const pembuat = poll.key.fromMe ? aku : [getKeyAuthor(kunci, aku[0])];
        const k = msg.key;
        const pemilih = k.fromMe ? aku : [k.participant, k.participantAlt, k.remoteJidAlt, k.remoteJid].filter(Boolean).map(j => jidNormalizedUser(j));
        let vote;
        let dipakai;
        for (const c of new Set(pembuat)) {
            for (const v of new Set(pemilih)) {
                try {
                    vote = decryptPollVote(upd.vote, { pollEncKey: poll.secret, pollCreatorJid: c, pollMsgId: kunci.id, voterJid: v });
                    dipakai = v;
                    break;
                }
                catch {
                    // kombinasi JID salah, coba yang lain
                }
            }
            if (vote) {
                break;
            }
        }
        if (!vote) {
            logger?.warn({ pollId: kunci.id }, 'gagal membuka suara poll');
            return;
        }
        const waktu = Number(upd.senderTimestampMs) || Date.now();
        poll.suara.set(dipakai, { pollUpdateMessageKey: k, vote, senderTimestampMs: waktu });
        const hasilAgregat = getAggregateVotesInPollMessage({ message: poll.message, pollUpdates: [...poll.suara.values()] }, aku[0]);
        const dipilih = hasilAgregat.filter(o => o.voters.some(x => jidNormalizedUser(x) === dipakai)).map(o => o.name);
        const info = poll.message.pollCreationMessage ?? poll.message.pollCreationMessageV2 ?? poll.message.pollCreationMessageV3;
        const kabar = {
            pollId: kunci.id,
            chat: kunci.remoteJid ?? k.remoteJid,
            title: info?.name ?? '',
            voter: k.fromMe ? aku[0] : (k.participant ?? k.remoteJid),
            voterName: msg.pushName,
            selected: dipilih,
            results: hasilAgregat.map(o => ({ name: o.name, count: o.voters.length, voters: o.voters })),
            timestamp: waktu,
            correctAnswer: info?.correctAnswer?.optionName,
            isCorrect: info?.correctAnswer?.optionName ? dipilih.length === 1 && dipilih[0] === info.correctAnswer.optionName : undefined,
            key: k
        };
        for (const fn of pendengarVote) {
            try {
                await fn(kabar);
            }
            catch (err) {
                logger?.warn({ err }, 'onPollVote: handler error');
            }
        }
    };
    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const m of messages) {
            bukaVote(m).catch(err => logger?.warn({ err }, 'gagal memproses suara poll'));
        }
    });
    // Pasang pendengar suara poll. Mengembalikan fungsi untuk berhenti.
    const onPollVote = (handler) => {
        if (typeof handler !== 'function') {
            throw new Error('onPollVote butuh fungsi');
        }
        pendengarVote.add(handler);
        return () => pendengarVote.delete(handler);
    };
    // ---- helper kecil: kontak, lokasi, voice note, reaksi, pin, tag semua anggota
    const bikinVcard = (c) => {
        const nama = String(c?.name ?? '').trim();
        const nomor = String(c?.number ?? '').replace(/\D/g, '');
        if (!nama || nomor.length < 6) {
            throw new Error('Kontak butuh name dan number (angka, pakai kode negara, contoh 6281234567890)');
        }
        const aman = (t) => String(t).replace(/[\r\n]+/g, ' ');
        return {
            displayName: nama,
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:' + aman(nama) + '\n' + (c.org ? 'ORG:' + aman(c.org) + ';\n' : '') + 'TEL;type=CELL;type=VOICE;waid=' + nomor + ':+' + nomor + '\nEND:VCARD'
        };
    };
    // Kirim satu atau beberapa kontak: { name, number, org? } atau array-nya.
    const sendContact = (jid, kontak, opsi = {}) => {
        const daftar = (Array.isArray(kontak) ? kontak : [kontak]).map(bikinVcard);
        if (!daftar.length || daftar.length > 20) {
            throw new Error('sendContact butuh 1 sampai 20 kontak');
        }
        const { displayName, quoted, ...lainnya } = opsi;
        return sendMessage(jid, { contacts: { displayName: displayName ?? (daftar.length === 1 ? daftar[0].displayName : daftar.length + ' kontak'), contacts: daftar } }, { quoted, ...lainnya });
    };
    // Kirim lokasi. name dan address opsional.
    const sendLocation = (jid, lat, lon, opsi = {}) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            throw new Error('Koordinat tidak valid (lat -90..90, lon -180..180)');
        }
        const { name, address, quoted, ...lainnya } = opsi;
        return sendMessage(jid, { location: { degreesLatitude: lat, degreesLongitude: lon, name, address } }, { quoted, ...lainnya });
    };
    // Kirim voice note (tampil sebagai pesan suara). Paling aman memakai ogg opus; untuk format lain isi opsi.mimetype.
    const sendVoiceNote = (jid, audio, opsi = {}) => {
        if (!audio) {
            throw new Error('sendVoiceNote butuh audio (contoh: { url: "./suara.ogg" } atau Buffer)');
        }
        const { mimetype = 'audio/ogg; codecs=opus', quoted, ...lainnya } = opsi;
        return sendMessage(jid, { audio, ptt: true, mimetype }, { quoted, ...lainnya });
    };
    // Beri reaksi emoji ke sebuah pesan. emoji kosong ('') = hapus reaksi.
    const sendReact = (jid, key, emoji = '') => {
        if (!key?.id) {
            throw new Error('sendReact butuh key pesan (m.key)');
        }
        return sendMessage(jid, { react: { text: emoji, key } });
    };
    const DURASI_PIN = { '24h': 86400, '7d': 604800, '30d': 2592000 };
    // Sematkan pesan di chat. duration: '24h' (bawaan), '7d' atau '30d'.
    const pinMessage = (jid, key, opsi = {}) => {
        if (!key?.id) {
            throw new Error('pinMessage butuh key pesan (m.key)');
        }
        const waktu = DURASI_PIN[opsi.duration ?? '24h'];
        if (!waktu) {
            throw new Error("duration harus '24h', '7d' atau '30d'");
        }
        return sendMessage(jid, { pin: key, type: 1, time: waktu });
    };
    // Lepas sematan pesan.
    const unpinMessage = (jid, key) => {
        if (!key?.id) {
            throw new Error('unpinMessage butuh key pesan (m.key)');
        }
        return sendMessage(jid, { pin: key, type: 2 });
    };
    const anggotaGrup = async (jid) => {
        if (!String(jid).endsWith('@g.us')) {
            throw new Error('Hanya untuk grup (JID berakhiran @g.us)');
        }
        const meta = await sock.groupMetadata(jid);
        const ids = (meta?.participants ?? []).map(p => p.id).filter(Boolean);
        if (!ids.length) {
            throw new Error('Daftar anggota grup kosong');
        }
        return ids;
    };
    // Tag semua anggota dengan fitur @semua bawaan WhatsApp (tanpa daftar nomor). label bisa diganti (contoh '@everyone').
    // manual: true = cara lama, menampilkan daftar @nomor satu per satu.
    const tagAll = async (jid, teks = '', opsi = {}) => {
        const { label = '@semua', manual = false, quoted, ...lainnya } = opsi;
        if (manual) {
            const ids = await anggotaGrup(jid);
            const daftar = ids.map(id => '@' + id.split('@')[0].split(':')[0]).join('\n');
            return sendMessage(jid, { text: (teks ? teks + '\n\n' : '') + daftar, mentions: ids }, { quoted, ...lainnya });
        }
        if (!String(jid).endsWith('@g.us')) {
            throw new Error('Hanya untuk grup (JID berakhiran @g.us)');
        }
        const isi = String(teks ?? '').trim();
        const tulis = isi.includes(label) ? isi : label + (isi ? ' ' + isi : '');
        return sendMessage(jid, { text: tulis, mentionAll: true }, { quoted, ...lainnya });
    };
    // Tag semua anggota tanpa menampilkan daftar (hidetag): hanya teksmu yang terlihat.
    const hideTag = async (jid, teks, opsi = {}) => {
        if (!String(teks ?? '').trim()) {
            throw new Error('hideTag butuh teks');
        }
        const ids = await anggotaGrup(jid);
        const { quoted, ...lainnya } = opsi;
        return sendMessage(jid, { text: String(teks), mentions: ids }, { quoted, ...lainnya });
    };
    // Kirim kuis (poll bawaan WhatsApp dengan jawaban benar). Pilihan tunggal, 2 sampai 12 opsi.
    // answer: teks pilihan yang benar, atau nomor urutnya (mulai 0). Kalau WhatsApp penerima belum mendukung kuis, tampil sebagai poll biasa.
    const sendQuiz = async (jid, soal, pilihan, opsi = {}) => {
        const judul = typeof soal === 'string' ? soal.trim() : '';
        if (!judul) {
            throw new Error('Pertanyaan kuis tidak boleh kosong');
        }
        const daftar = Array.isArray(pilihan) ? pilihan.map(v => String(v).trim()).filter(Boolean) : [];
        if (daftar.length < 2 || daftar.length > 12) {
            throw new Error('Kuis butuh 2 sampai 12 pilihan');
        }
        if (new Set(daftar).size !== daftar.length) {
            throw new Error('Pilihan kuis tidak boleh kembar');
        }
        const { answer, quoted } = opsi;
        const benar = typeof answer === 'number' ? daftar[answer] : answer;
        if (!benar || !daftar.includes(benar)) {
            throw new Error('answer harus salah satu pilihan (teksnya, atau nomor urut mulai 0)');
        }
        const msg = generateWAMessageFromContent(jid, {
            messageContextInfo: { messageSecret: globalThis.crypto.getRandomValues(new Uint8Array(32)) },
            pollCreationMessageV3: {
                name: judul,
                selectableOptionsCount: 1,
                options: daftar.map(optionName => ({ optionName })),
                pollType: proto.Message.PollType.QUIZ,
                correctAnswer: { optionName: benar }
            }
        }, { userJid: sock.user?.id ?? '', quoted });
        await relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: [{ tag: 'meta', attrs: { polltype: 'creation' } }] });
        if (typeof simpanPoll === 'function') {
            simpanPoll(msg);
        }
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
        sendQuiz,
        onPollVote,
        sendContact,
        sendLocation,
        sendVoiceNote,
        sendReact,
        pinMessage,
        unpinMessage,
        tagAll,
        hideTag,
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
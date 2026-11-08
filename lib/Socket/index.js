import { proto } from '../../WAProto/index.js';
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { generateWAMessageFromContent } from '../Utils/messages.js';
import { makeCommunitiesSocket } from './communities.js';
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
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const sock = makeCommunitiesSocket(newConfig);
    const channel = newConfig.autoFollowChannel;
    if (channel) {
        let sudahFollow = false;
        sock.ev.on('connection.update', async ({ connection }) => {
            if (connection === 'open' && !sudahFollow) {
                sudahFollow = true;
                try {
                    await sock.newsletterFollow(channel);
                    console.log('[auto-follow] berhasil follow channel');
                }
                catch (e) {
                    console.log('[auto-follow] gagal:', e.message);
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
        const parent = await sock.sendMessage(jid, { album: { expectedImageCount, expectedVideoCount } }, options);
        const hasil = [parent];
        for (const item of items) {
            const msg = await sock.sendMessage(jid, { ...item, albumParentKey: parent.key }, options);
            hasil.push(msg);
            await new Promise(r => setTimeout(r, 500));
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
        await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: nodes
        });
        return msg;
    };
    return { ...sock, cekIDSaluran, sendAlbum, sendInteractive };
};
export default makeWASocket;
//# sourceMappingURL=index.js.map
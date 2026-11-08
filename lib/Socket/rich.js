import { proto } from '../../WAProto/index.js';
import { generateWAMessageFromContent } from '../Utils/messages.js';
const TIPE = proto.AIRichResponseSubMessageType;
const teks = (messageText) => ({
    messageType: TIPE.AI_RICH_RESPONSE_TEXT,
    messageText
});
const tabel = (title, header, baris) => ({
    messageType: TIPE.AI_RICH_RESPONSE_TABLE,
    tableMetadata: {
        title,
        rows: [
            { items: header, isHeading: true },
            ...baris.map(items => ({ items, isHeading: false }))
        ]
    }
});
const kode = (isi, bahasa) => ({
    messageType: TIPE.AI_RICH_RESPONSE_CODE,
    codeMetadata: {
        codeLanguage: bahasa,
        codeBlocks: [
            {
                highlightType: proto.AIRichResponseCodeMetadata.AIRichResponseCodeHighlightType.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT,
                codeContent: isi
            }
        ]
    }
});
const rakit = (inti, opsi) => [
    ...(opsi.atas ? [teks(opsi.atas)] : []),
    ...inti,
    ...(opsi.bawah ? [teks(opsi.bawah)] : [])
];
export const bikinRich = (sock) => {
    const kirim = async (jid, submessages, quoted) => {
        const msg = generateWAMessageFromContent(jid, {
            richResponseMessage: {
                messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
                submessages
            }
        }, { userJid: sock.user?.id ?? '', quoted });
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    };
    const sendTable = (jid, title, header, baris, opsi = {}) => kirim(jid, rakit([tabel(title, header, baris)], opsi), opsi.quoted);
    const sendList = (jid, title, item, opsi = {}) => {
        const isi = item.map(([label, nilai]) => `• ${label}: ${nilai}`).join('\n');
        return kirim(jid, rakit([teks(`${title}\n${isi}`)], opsi), opsi.quoted);
    };
    const sendCodeBlock = (jid, isi, opsi = {}) => kirim(jid, rakit([kode(isi, opsi.language ?? 'text')], opsi), opsi.quoted);
    return { sendTable, sendList, sendCodeBlock };
};
//# sourceMappingURL=rich.js.map
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
const gabung = (inti, opsi) => [opsi.atas, inti, opsi.bawah].filter(Boolean).join('\n\n');
const tabelTeks = (title, header, baris) => {
    const semua = [header, ...baris];
    const lebar = header.map((_, i) => Math.max(...semua.map(r => (r[i] ?? '').length)));
    const format = (r) => r.map((c, i) => (c ?? '').padEnd(lebar[i])).join(' | ');
    const garis = lebar.map(l => '-'.repeat(l)).join('-+-');
    return `*${title}*\n\`\`\`${[format(header), garis, ...baris.map(format)].join('\n')}\`\`\``;
};
export const bikinRich = (sock) => {
    const kirimRich = async (jid, submessages, quoted) => {
        const msg = generateWAMessageFromContent(jid, {
            richResponseMessage: {
                messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
                submessages
            }
        }, { userJid: sock.user?.id ?? '', quoted });
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    };
    const kirimTeks = (jid, text, quoted) => sock.sendMessage(jid, { text }, { quoted });
    const sendTable = (jid, title, header, baris, opsi = {}) => opsi.rich
        ? kirimRich(jid, rakit([tabel(title, header, baris)], opsi), opsi.quoted)
        : kirimTeks(jid, gabung(tabelTeks(title, header, baris), opsi), opsi.quoted);
    const sendList = (jid, title, item, opsi = {}) => {
        const isi = `*${title}*\n${item.map(([label, nilai]) => `• ${label}: ${nilai}`).join('\n')}`;
        return opsi.rich
            ? kirimRich(jid, rakit([teks(isi)], opsi), opsi.quoted)
            : kirimTeks(jid, gabung(isi, opsi), opsi.quoted);
    };
    const sendCodeBlock = (jid, isi, opsi = {}) => opsi.rich
        ? kirimRich(jid, rakit([kode(isi, opsi.language ?? 'text')], opsi), opsi.quoted)
        : kirimTeks(jid, gabung(`\`\`\`${isi}\`\`\``, opsi), opsi.quoted);
    return { sendTable, sendList, sendCodeBlock };
};
//# sourceMappingURL=rich.js.map
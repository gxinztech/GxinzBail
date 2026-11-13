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
// ---- sendRichMessage: perapi submessage dan pewarna kode sederhana
const KATA_KUNCI = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'new', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'def', 'elif', 'lambda', 'pass', 'None', 'True', 'False', 'null', 'undefined', 'true', 'false', 'this', 'self']);
const tokenKode = (isi, bahasa) => {
    const H = proto.AIRichResponseCodeMetadata.AIRichResponseCodeHighlightType;
    const pagar = /^(python|py|bash|sh|shell|ruby|rb|yaml|yml)$/i.test(bahasa ?? '');
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    const potongan = [];
    const tambah = (highlightType, codeContent) => {
        if (!codeContent) {
            return;
        }
        const akhir = potongan[potongan.length - 1];
        if (akhir && akhir.highlightType === highlightType) {
            akhir.codeContent += codeContent;
        }
        else {
            potongan.push({ highlightType, codeContent });
        }
    };
    let terakhir = 0;
    let m;
    while ((m = re.exec(isi)) !== null) {
        let jenis;
        if (m[1] !== undefined) {
            jenis = m[1].startsWith('#') && !pagar ? H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT : H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_COMMENT;
        }
        else if (m[2] !== undefined) {
            jenis = H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_STRING;
        }
        else if (m[3] !== undefined) {
            jenis = H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_NUMBER;
        }
        else if (KATA_KUNCI.has(m[4] ?? m[5])) {
            jenis = H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_KEYWORD;
        }
        else if (m[4] !== undefined) {
            jenis = H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_METHOD;
        }
        else {
            jenis = H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT;
        }
        tambah(H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT, isi.slice(terakhir, m.index));
        tambah(jenis, m[0]);
        terakhir = m.index + m[0].length;
    }
    tambah(H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT, isi.slice(terakhir));
    // pengaman: gabungan potongan harus sama persis dengan kode asli, kalau tidak pakai satu blok polos
    return potongan.map(p => p.codeContent).join('') === isi
        ? potongan
        : [{ highlightType: H.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT, codeContent: isi }];
};
const rapikanRich = (sub, i) => {
    const T = proto.AIRichResponseSubMessageType;
    if (!sub || typeof sub !== 'object') {
        throw new Error('Submessage #' + i + ' harus berupa objek');
    }
    let tipe = sub.messageType;
    if (typeof tipe === 'string') {
        tipe = T[tipe] ?? T['AI_RICH_RESPONSE_' + tipe.toUpperCase()];
    }
    if (!Number.isInteger(tipe) || !T[tipe]) {
        throw new Error('messageType tidak dikenal pada submessage #' + i);
    }
    const hasil = { ...sub, messageType: tipe };
    if (tipe === T.AI_RICH_RESPONSE_TEXT) {
        if (typeof sub.messageText !== 'string' || !sub.messageText) {
            throw new Error('Submessage #' + i + ' (teks) butuh messageText');
        }
    }
    else if (tipe === T.AI_RICH_RESPONSE_TABLE) {
        const rows = sub.tableMetadata?.rows;
        if (!Array.isArray(rows) || !rows.length || rows.some(r => !Array.isArray(r?.items) || !r.items.length)) {
            throw new Error('Submessage #' + i + ' (tabel) butuh tableMetadata.rows berisi { items: [...] }');
        }
        hasil.tableMetadata = {
            ...sub.tableMetadata,
            rows: rows.map(r => ({ items: r.items.map(c => String(c ?? '')), isHeading: !!r.isHeading }))
        };
    }
    else if (tipe === T.AI_RICH_RESPONSE_CODE) {
        const meta = sub.codeMetadata ?? {};
        const bahasa = meta.codeLanguage ?? 'text';
        const blok = meta.codeBlocks;
        let codeBlocks;
        if (typeof blok === 'string' && blok) {
            codeBlocks = tokenKode(blok, bahasa);
        }
        else if (Array.isArray(blok) && blok.length) {
            codeBlocks = blok.map(b => typeof b === 'string'
                ? { highlightType: proto.AIRichResponseCodeMetadata.AIRichResponseCodeHighlightType.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT, codeContent: b }
                : b);
        }
        else {
            throw new Error('Submessage #' + i + ' (kode) butuh codeMetadata.codeBlocks');
        }
        hasil.codeMetadata = { ...meta, codeLanguage: bahasa, codeBlocks };
    }
    return hasil;
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
    // Kirim banyak blok rich response dalam SATU pesan. messageType: 2 teks, 4 tabel, 5 kode (angka atau nama).
    // opsi.header / opsi.footer ditambahkan sebagai blok teks di awal / akhir.
    const sendRichMessage = (jid, submessages, quoted, opsi = {}) => {
        if (!Array.isArray(submessages) || !submessages.length) {
            throw new Error('sendRichMessage butuh array submessage (minimal 1)');
        }
        if (submessages.length > 30) {
            throw new Error('sendRichMessage maksimal 30 submessage');
        }
        const isi = submessages.map(rapikanRich);
        return kirimRich(jid, rakit(isi, { atas: opsi?.header ?? opsi?.atas, bawah: opsi?.footer ?? opsi?.bawah }), quoted);
    };
    return { sendTable, sendList, sendCodeBlock, sendRichMessage };
};
//# sourceMappingURL=rich.js.map
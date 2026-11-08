"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var rich_exports = {};
__export(rich_exports, {
  bikinRich: () => bikinRich
});
module.exports = __toCommonJS(rich_exports);
var import_WAProto = require("../../WAProto/index.js");
var import_messages = require("../Utils/messages.js");
const TIPE = import_WAProto.proto.AIRichResponseSubMessageType;
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
      ...baris.map((items) => ({ items, isHeading: false }))
    ]
  }
});
const kode = (isi, bahasa) => ({
  messageType: TIPE.AI_RICH_RESPONSE_CODE,
  codeMetadata: {
    codeLanguage: bahasa,
    codeBlocks: [
      {
        highlightType: import_WAProto.proto.AIRichResponseCodeMetadata.AIRichResponseCodeHighlightType.AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT,
        codeContent: isi
      }
    ]
  }
});
const rakit = (inti, opsi) => [
  ...opsi.atas ? [teks(opsi.atas)] : [],
  ...inti,
  ...opsi.bawah ? [teks(opsi.bawah)] : []
];
const gabung = (inti, opsi) => [opsi.atas, inti, opsi.bawah].filter(Boolean).join("\n\n");
const tabelTeks = (title, header, baris) => {
  const semua = [header, ...baris];
  const lebar = header.map((_, i) => Math.max(...semua.map((r) => (r[i] ?? "").length)));
  const format = (r) => r.map((c, i) => (c ?? "").padEnd(lebar[i])).join(" | ");
  const garis = lebar.map((l) => "-".repeat(l)).join("-+-");
  return `*${title}*
\`\`\`${[format(header), garis, ...baris.map(format)].join("\n")}\`\`\``;
};
const bikinRich = (sock) => {
  const kirimRich = async (jid, submessages, quoted) => {
    const msg = (0, import_messages.generateWAMessageFromContent)(jid, {
      richResponseMessage: {
        messageType: import_WAProto.proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
        submessages
      }
    }, { userJid: sock.user?.id ?? "", quoted });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
  };
  const kirimTeks = (jid, text, quoted) => sock.sendMessage(jid, { text }, { quoted });
  const sendTable = (jid, title, header, baris, opsi = {}) => opsi.rich ? kirimRich(jid, rakit([tabel(title, header, baris)], opsi), opsi.quoted) : kirimTeks(jid, gabung(tabelTeks(title, header, baris), opsi), opsi.quoted);
  const sendList = (jid, title, item, opsi = {}) => {
    const isi = `*${title}*
${item.map(([label, nilai]) => `\u2022 ${label}: ${nilai}`).join("\n")}`;
    return opsi.rich ? kirimRich(jid, rakit([teks(isi)], opsi), opsi.quoted) : kirimTeks(jid, gabung(isi, opsi), opsi.quoted);
  };
  const sendCodeBlock = (jid, isi, opsi = {}) => opsi.rich ? kirimRich(jid, rakit([kode(isi, opsi.language ?? "text")], opsi), opsi.quoted) : kirimTeks(jid, gabung(`\`\`\`${isi}\`\`\``, opsi), opsi.quoted);
  return { sendTable, sendList, sendCodeBlock };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bikinRich
});

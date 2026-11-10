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
var Socket_exports = {};
__export(Socket_exports, {
  default: () => Socket_default
});
module.exports = __toCommonJS(Socket_exports);
var import_lru_cache = require("lru-cache");
var import_WAProto = require("../../WAProto/index.js");
var import_Defaults = require("../Defaults/index.js");
var import_messages = require("../Utils/messages.js");
var import_send_limiter = require("../Utils/send-limiter.js");
var import_communities = require("./communities.js");
var import_rich = require("./rich.js");
const bikinTombol = (b) => {
  switch (b.type) {
    case "reply":
      return {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id })
      };
    case "url":
      return {
        name: "cta_url",
        buttonParamsJson: JSON.stringify({ display_text: b.text, url: b.url, merchant_url: b.url })
      };
    case "copy":
      return {
        name: "cta_copy",
        buttonParamsJson: JSON.stringify({ display_text: b.text, copy_code: b.code })
      };
    case "call":
      return {
        name: "cta_call",
        buttonParamsJson: JSON.stringify({ display_text: b.text, phone_number: b.phone })
      };
    default:
      throw new Error("Tipe tombol tidak dikenal");
  }
};
const sudahDifollow = /* @__PURE__ */ new Set();
const makeWASocket = (config) => {
  const newConfig = {
    ...import_Defaults.DEFAULT_CONNECTION_CONFIG,
    ...config
  };
  const logger = newConfig.logger;
  let baseSock;
  const groupCache = new import_lru_cache.LRUCache({ max: 500, ttl: 5 * 60 * 1e3 });
  const groupInflight = /* @__PURE__ */ new Map();
  if (!config?.cachedGroupMetadata) {
    newConfig.cachedGroupMetadata = async (jid) => {
      const hit = groupCache.get(jid);
      if (hit) {
        return hit;
      }
      let pending = groupInflight.get(jid);
      if (!pending) {
        pending = baseSock.groupMetadata(jid).then((meta) => {
          groupCache.set(jid, meta);
          return meta;
        }).finally(() => groupInflight.delete(jid));
        groupInflight.set(jid, pending);
      }
      return pending;
    };
  }
  const sock = (0, import_communities.makeCommunitiesSocket)(newConfig);
  baseSock = sock;
  const dropGroup = (id) => {
    if (id) {
      groupCache.delete(id);
    }
  };
  sock.ev.on("groups.update", (updates) => updates.forEach((u) => dropGroup(u.id)));
  sock.ev.on("groups.upsert", (groups) => groups.forEach((g) => dropGroup(g.id)));
  sock.ev.on("group-participants.update", ({ id }) => dropGroup(id));
  const limiter = newConfig.sendRateLimit === false ? void 0 : (0, import_send_limiter.makeSendLimiter)(newConfig.sendRateLimit, logger);
  sock.ev.on("connection.update", ({ connection }) => {
    if (connection === "close") {
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
  const paced = { ...sock, sendMessage, relayMessage };
  const channel = config?.autoFollowChannel;
  if (channel) {
    sock.ev.on("connection.update", async ({ connection }) => {
      const key = `${sock.user?.id ?? ""}|${channel}`;
      if (connection === "open" && !sudahDifollow.has(key)) {
        sudahDifollow.add(key);
        try {
          await sock.newsletterFollow(channel);
          logger.info({ channel }, "auto-follow: followed channel");
        } catch (e) {
          sudahDifollow.delete(key);
          logger.warn({ channel, err: e?.message }, "auto-follow failed");
        }
      }
    });
  }
  const cekIDSaluran = async (link) => {
    const kode = link.match(/channel\/([A-Za-z0-9_-]+)/)?.[1] ?? link.trim();
    return sock.newsletterMetadata("invite", kode);
  };
  const sendAlbum = async (jid, items, options) => {
    if (!items || items.length < 2) {
      throw new Error("Album minimal 2 media");
    }
    const expectedImageCount = items.filter((i) => i.image).length;
    const expectedVideoCount = items.filter((i) => i.video).length;
    const parent = await sendMessage(jid, { album: { expectedImageCount, expectedVideoCount } }, options);
    const hasil = [parent];
    for (const item of items) {
      const msg = await sendMessage(jid, { ...item, albumParentKey: parent.key }, options);
      hasil.push(msg);
      if (!limiter) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return hasil;
  };
  const sendInteractive = async (jid, opsi, options) => {
    if (!opsi?.buttons?.length) {
      throw new Error("Minimal 1 tombol");
    }
    const interactiveMessage = import_WAProto.proto.Message.InteractiveMessage.create({
      body: import_WAProto.proto.Message.InteractiveMessage.Body.create({ text: opsi.text }),
      footer: import_WAProto.proto.Message.InteractiveMessage.Footer.create({ text: opsi.footer ?? "" }),
      header: import_WAProto.proto.Message.InteractiveMessage.Header.create({
        title: opsi.title ?? "",
        subtitle: "",
        hasMediaAttachment: false
      }),
      nativeFlowMessage: import_WAProto.proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: opsi.buttons.map(bikinTombol),
        messageParamsJson: ""
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
    const msg = (0, import_messages.generateWAMessageFromContent)(jid, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage
        }
      }
    }, { userJid: sock.user?.id ?? "" });
    const nodes = [
      {
        tag: "biz",
        attrs: {},
        content: [
          {
            tag: "interactive",
            attrs: { type: "native_flow", v: "1" },
            content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }]
          }
        ]
      }
    ];
    if (!jid.endsWith("@g.us")) {
      nodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
    }
    await relayMessage(jid, msg.message, {
      messageId: msg.key.id,
      additionalNodes: nodes
    });
    return msg;
  };
  return {
    ...sock,
    sendMessage,
    relayMessage,
    cekIDSaluran,
    sendAlbum,
    sendInteractive,
    ...(0, import_rich.bikinRich)(paced),
    /** pending sends, active chats and how long sending is paused */
    getSendQueueStats: () => limiter?.stats() ?? { pending: 0, activeChats: 0, pausedForMs: 0 },
    /** pause all outgoing messages for `ms` milliseconds */
    pauseSending: (ms) => limiter?.pause(ms)
  };
};
var Socket_default = makeWASocket;

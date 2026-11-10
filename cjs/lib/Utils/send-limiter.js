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
var send_limiter_exports = {};
__export(send_limiter_exports, {
  DEFAULT_SEND_RATE_LIMIT: () => DEFAULT_SEND_RATE_LIMIT,
  isRateLimitError: () => isRateLimitError,
  makeSendLimiter: () => makeSendLimiter
});
module.exports = __toCommonJS(send_limiter_exports);
var import_boom = require("@hapi/boom");
const DEFAULT_SEND_RATE_LIMIT = {
  /** minimum gap between any two sends, across all chats */
  globalMinDelayMs: 300,
  /** minimum gap between two sends to the same chat */
  perChatMinDelayMs: 1e3,
  /** random extra delay (0..jitterMs) added to the gaps above */
  jitterMs: 250,
  /** hard ceiling: at most this many sends inside windowMs */
  maxPerWindow: 40,
  windowMs: 3e4,
  /** reject new sends once this many are waiting, instead of growing without bound */
  maxQueueSize: 500,
  /** retries after an explicit rate-limit response (429 / rate-overlimit) */
  maxRetries: 3,
  retryBaseDelayMs: 3e3,
  retryMaxDelayMs: 3e4
};
const noop = () => {
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (max) => max > 0 ? Math.floor(Math.random() * (max + 1)) : 0;
const isRateLimitError = (err) => {
  const code = err?.output?.statusCode ?? err?.data?.statusCode ?? err?.statusCode;
  if (code === 429) {
    return true;
  }
  const text = `${err?.message ?? ""} ${err?.data?.code ?? ""} ${err?.data?.attrs?.error ?? ""}`;
  return /rate-?overlimit|too many requests/i.test(text);
};
const makeSendLimiter = (options = {}, logger) => {
  const cfg = { ...DEFAULT_SEND_RATE_LIMIT, ...options };
  const chatTail = /* @__PURE__ */ new Map();
  const chatNext = /* @__PURE__ */ new Map();
  const starts = [];
  let lastGlobalStart = 0;
  let pauseUntil = 0;
  let pending = 0;
  let destroyed = false;
  const reserve = (chat) => {
    const now = Date.now();
    let start = Math.max(now, pauseUntil, lastGlobalStart + cfg.globalMinDelayMs + jitter(cfg.jitterMs), chatNext.get(chat) ?? 0);
    while (starts.length && starts[0] <= start - cfg.windowMs) {
      starts.shift();
    }
    if (starts.length >= cfg.maxPerWindow) {
      start = Math.max(start, starts[starts.length - cfg.maxPerWindow] + cfg.windowMs);
    }
    starts.push(start);
    lastGlobalStart = start;
    chatNext.set(chat, start + cfg.perChatMinDelayMs + jitter(cfg.jitterMs));
    return start - now;
  };
  const pruneChatNext = () => {
    if (chatNext.size < 1e3) {
      return;
    }
    const now = Date.now();
    for (const [chat, t] of chatNext) {
      if (t <= now && !chatTail.has(chat)) {
        chatNext.delete(chat);
      }
    }
  };
  const execute = async (chat, task) => {
    try {
      for (let attempt = 0; ; attempt++) {
        const wait = reserve(chat);
        if (wait > 0) {
          await sleep(wait);
        }
        if (destroyed) {
          throw new import_boom.Boom("Connection Closed", { statusCode: 428 });
        }
        try {
          return await task();
        } catch (err) {
          if (!isRateLimitError(err) || attempt >= cfg.maxRetries) {
            throw err;
          }
          const backoff = Math.min(cfg.retryMaxDelayMs, cfg.retryBaseDelayMs * 2 ** attempt) + jitter(cfg.jitterMs * 4);
          pauseUntil = Math.max(pauseUntil, Date.now() + backoff);
          logger?.warn?.({ chat, attempt: attempt + 1, backoffMs: backoff }, "rate limited by WhatsApp, backing off");
        }
      }
    } finally {
      pending--;
    }
  };
  return {
    /** run `task` for `chat` once the pacing rules allow it */
    schedule(chat, task) {
      if (destroyed) {
        return Promise.reject(new import_boom.Boom("Connection Closed", { statusCode: 428 }));
      }
      if (pending >= cfg.maxQueueSize) {
        return Promise.reject(new import_boom.Boom("Send queue is full", { statusCode: 429, data: { pending } }));
      }
      pending++;
      pruneChatNext();
      const prev = chatTail.get(chat) ?? Promise.resolve();
      const run = prev.then(() => execute(chat, task));
      const tail = run.then(noop, noop);
      chatTail.set(chat, tail);
      void tail.then(() => {
        if (chatTail.get(chat) === tail) {
          chatTail.delete(chat);
        }
      });
      return run;
    },
    /** pause every send for `ms` (for example after your own ban/limit detection) */
    pause(ms) {
      pauseUntil = Math.max(pauseUntil, Date.now() + ms);
    },
    stats() {
      return { pending, activeChats: chatTail.size, pausedForMs: Math.max(0, pauseUntil - Date.now()) };
    },
    /** reject everything that is still waiting. Called when the socket closes */
    destroy() {
      destroyed = true;
    }
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SEND_RATE_LIMIT,
  isRateLimitError,
  makeSendLimiter
});

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
var connection_manager_exports = {};
__export(connection_manager_exports, {
  classifyDisconnect: () => classifyDisconnect,
  getDisconnectCode: () => getDisconnectCode,
  makeAutoReconnect: () => makeAutoReconnect
});
module.exports = __toCommonJS(connection_manager_exports);
var import_Types = require("../Types/index.js");
const getDisconnectCode = (error) => {
  const code = error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode;
  const n = Number(code);
  return Number.isFinite(n) ? n : void 0;
};
const classifyDisconnect = (error) => {
  const code = getDisconnectCode(error);
  switch (code) {
    case import_Types.DisconnectReason.loggedOut:
      return { code, reason: "loggedOut", reconnect: false, clearSession: true, immediate: false };
    case import_Types.DisconnectReason.forbidden:
      return { code, reason: "forbidden", reconnect: false, clearSession: false, immediate: false };
    case import_Types.DisconnectReason.connectionReplaced:
      return { code, reason: "connectionReplaced", reconnect: false, clearSession: false, immediate: false };
    case import_Types.DisconnectReason.multideviceMismatch:
      return { code, reason: "multideviceMismatch", reconnect: false, clearSession: false, immediate: false };
    case import_Types.DisconnectReason.restartRequired:
      return { code, reason: "restartRequired", reconnect: true, clearSession: false, immediate: true };
    case import_Types.DisconnectReason.badSession:
      return { code, reason: "badSession", reconnect: true, clearSession: false, immediate: false };
    default:
      return { code, reason: "transient", reconnect: true, clearSession: false, immediate: false };
  }
};
const makeAutoReconnect = (createSocket, opts = {}) => {
  const { maxRetries = 10, baseDelayMs = 1e3, maxDelayMs = 6e4, jitterRatio = 0.3, stableAfterMs = 3e4, logger, onSocket, onRetry, onClose, onLoggedOut, onGiveUp } = opts;
  let current;
  let attempts = 0;
  let openedAt = 0;
  let stopped = false;
  let starting = false;
  let timer;
  const schedule = (delayMs) => {
    clearTimeout(timer);
    timer = setTimeout(() => void start(), delayMs);
  };
  const backoff = () => {
    const base = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(base * (1 - jitterRatio + Math.random() * jitterRatio * 2));
  };
  const failAndRetry = (info) => {
    attempts++;
    if (attempts > maxRetries) {
      stopped = true;
      logger?.error?.({ attempts, reason: info.reason }, "giving up reconnecting");
      onGiveUp?.(info);
      return;
    }
    const delayMs = backoff();
    logger?.warn?.({ attempt: attempts, delayMs, reason: info.reason }, "connection closed, will reconnect");
    onRetry?.({ attempt: attempts, delayMs, ...info });
    schedule(delayMs);
  };
  const handleClose = async (sock, error) => {
    if (stopped || sock !== current) {
      return;
    }
    if (openedAt && Date.now() - openedAt >= stableAfterMs) {
      attempts = 0;
    }
    openedAt = 0;
    const info = { ...classifyDisconnect(error), error };
    onClose?.(info);
    if (info.reason === "loggedOut") {
      logger?.warn?.("session logged out");
      const pairAgain = await onLoggedOut?.(info);
      if (pairAgain === true && !stopped) {
        attempts = 0;
        schedule(0);
      } else {
        stopped = true;
      }
      return;
    }
    if (!info.reconnect) {
      stopped = true;
      logger?.warn?.({ reason: info.reason }, "not reconnecting");
      onGiveUp?.(info);
      return;
    }
    if (info.immediate) {
      schedule(250);
      return;
    }
    failAndRetry(info);
  };
  const start = async () => {
    if (stopped || starting) {
      return;
    }
    starting = true;
    try {
      const sock = await createSocket();
      current = sock;
      sock.ev.on("connection.update", (update) => {
        if (update.connection === "open") {
          openedAt = Date.now();
        } else if (update.connection === "close") {
          void handleClose(sock, update.lastDisconnect?.error);
        }
      });
      onSocket?.(sock);
    } catch (error) {
      current = void 0;
      starting = false;
      if (!stopped) {
        failAndRetry({ code: getDisconnectCode(error), reason: "startFailed", reconnect: true, clearSession: false, immediate: false, error });
      }
      return;
    }
    starting = false;
  };
  void start();
  return {
    get socket() {
      return current;
    },
    /** stop reconnecting and close the current socket (does not log the device out) */
    async stop() {
      stopped = true;
      clearTimeout(timer);
      const sock = current;
      current = void 0;
      if (sock) {
        await sock.end(void 0);
      }
    }
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  classifyDisconnect,
  getDisconnectCode,
  makeAutoReconnect
});

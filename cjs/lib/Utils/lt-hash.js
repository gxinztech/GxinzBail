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
var lt_hash_exports = {};
__export(lt_hash_exports, {
  LT_HASH_ANTI_TAMPERING: () => LT_HASH_ANTI_TAMPERING
});
module.exports = __toCommonJS(lt_hash_exports);
var import_whatsapp_rust_bridge = require("../../vendor/whatsapp-rust-bridge.cjs");
const LT_HASH_ANTI_TAMPERING = new import_whatsapp_rust_bridge.LTHashAntiTampering();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LT_HASH_ANTI_TAMPERING
});

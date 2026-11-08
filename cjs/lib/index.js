"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var lib_exports = {};
__export(lib_exports, {
  default: () => lib_default,
  makeWASocket: () => import_Socket.default
});
module.exports = __toCommonJS(lib_exports);
var import_Socket = __toESM(require("./Socket/index.js"));
__reExport(lib_exports, require("../WAProto/index.js"), module.exports);
__reExport(lib_exports, require("./Utils/index.js"), module.exports);
__reExport(lib_exports, require("./Types/index.js"), module.exports);
__reExport(lib_exports, require("./Defaults/index.js"), module.exports);
__reExport(lib_exports, require("./WABinary/index.js"), module.exports);
__reExport(lib_exports, require("./WAM/index.js"), module.exports);
__reExport(lib_exports, require("./WAUSync/index.js"), module.exports);
var lib_default = import_Socket.default;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  makeWASocket,
  ...require("../WAProto/index.js"),
  ...require("./Utils/index.js"),
  ...require("./Types/index.js"),
  ...require("./Defaults/index.js"),
  ...require("./WABinary/index.js"),
  ...require("./WAM/index.js"),
  ...require("./WAUSync/index.js")
});

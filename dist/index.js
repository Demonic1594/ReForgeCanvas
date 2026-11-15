"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReForgeCanvas = exports.version = void 0;
const forgescript_1 = require("@tryforge/forgescript");
const classes_1 = require("./classes");
const node_path_1 = require("node:path");
const loader_1 = require("./structures/loader");
const logger_1 = require("./structures/logger");
const pkg = __importStar(require("../package.json"));
exports.version = pkg.version;
/** The name the original ForgeCanvas registers; both define the same functions. */
const UPSTREAM_NAME = 'forge.canvas';
/** One-time warnings about guarded working-folder access (files.read / files.write: true). */
let warnedGuarded = false;
class ReForgeCanvas extends forgescript_1.ForgeExtension {
    name = 'reforge.canvas';
    description = pkg.description;
    version = exports.version;
    /** The resolved loader policy of this bot (defaults filled in). */
    policy;
    /** Wrong options throw here, so the bot does not start with a broken setup. */
    constructor(options = {}) {
        super();
        this.policy = (0, loader_1.resolvePolicy)(options);
        (0, logger_1.setLogLevel)(this.policy.logLevel);
    }
    /**
     * Runs before init(), outside ForgeScript's try/catch, so an error here stops the client:
     * ForgeCanvas next to ReForgeCanvas is refused (both define the same functions).
     */
    validateAndInit(client) {
        if (client.options.extensions?.some(x => x !== this && x?.name === UPSTREAM_NAME))
            throw new Error(`${logger_1.LOG_PREFIX} ForgeCanvas (@tryforge/forge.canvas) cannot be loaded next to ReForgeCanvas: both define the same functions, and whichever loads last replaces the other. Remove ForgeCanvas from the extensions (and npm uninstall @tryforge/forge.canvas).`);
        super.validateAndInit(client);
    }
    init(client) {
        const f = this.policy.files;
        if ((f.readGuarded || f.writeGuarded) && !warnedGuarded) {
            warnedGuarded = true;
            logger_1.log.warn(`files.${f.readGuarded ? 'read' : 'write'}: true lets commands use the whole bot folder (${process.cwd()}), with guards: only image, font, GIF and Lottie files, no hidden files, node_modules or databases. A folder of its own is safer: files: { read: "./assets", write: "./output" }.`);
        }
        (0, loader_1.setPolicy)(client, this.policy);
        this.load(__dirname + '/functions');
        client.preloadImages = new classes_1.ImageManager(this.policy);
        const n = this.policy.network, folder = (dir, guarded) => guarded ? 'bot folder (guarded)' : dir ? ((0, node_path_1.isAbsolute)((0, loader_1.describePath)(dir)) ? (0, loader_1.describePath)(dir) : `./${(0, loader_1.describePath)(dir)}`) : 'off';
        logger_1.log.info(`${this.version} started: network ${n.enabled ? `on (${n.timeout} ms, ${n.maxBytes} bytes, ${n.maxRedirects} redirects${n.allowedHosts.length ? `, ${n.allowedHosts.length} allowed host(s)` : ''}${n.allowPrivateNetwork ? ', private network allowed' : n.privateAddresses.length ? `, ${n.privateAddresses.length} private address(es) allowed` : ''})` : 'off'}, files.read ${folder(f.read, f.readGuarded)}, files.write ${folder(f.write, f.writeGuarded)}, log level ${this.policy.logLevel}`);
    }
    static components = new classes_1.ComponentManager();
}
exports.ReForgeCanvas = ReForgeCanvas;
__exportStar(require("./structures"), exports);
__exportStar(require("./classes"), exports);

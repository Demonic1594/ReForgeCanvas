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
const loader_1 = require("./structures/loader");
const pkg = __importStar(require("../package.json"));
exports.version = pkg.version;
/** The name the original ForgeCanvas registers; both define the same functions. */
const UPSTREAM_NAME = 'forge.canvas';
class ReForgeCanvas extends forgescript_1.ForgeExtension {
    name = 'reforge.canvas';
    description = pkg.description;
    version = exports.version;
    /** The resolved loader policy of this bot (defaults filled in). */
    policy;
    constructor(options = {}) {
        super();
        this.policy = (0, loader_1.resolvePolicy)(options);
    }
    init(client) {
        const upstream = client.options.extensions?.filter(x => x !== this && x?.name === UPSTREAM_NAME) ?? [];
        if (upstream.length) {
            forgescript_1.Logger.error(`${loader_1.LOG_PREFIX} ForgeCanvas (@tryforge/forge.canvas) is loaded next to ReForgeCanvas. Both define the same functions; ` +
                'ReForgeCanvas keeps its own and ForgeCanvas is not started. Remove @tryforge/forge.canvas from the extensions.');
            // Extensions listed after this one have not started yet: keep them from replacing the hardened functions.
            for (const ext of upstream)
                ext.init = () => { };
        }
        (0, loader_1.setPolicy)(client, this.policy);
        this.load(__dirname + '/functions');
        client.preloadImages = new classes_1.ImageManager(this.policy);
    }
    static components = new classes_1.ComponentManager();
}
exports.ReForgeCanvas = ReForgeCanvas;
__exportStar(require("./structures"), exports);
__exportStar(require("./classes"), exports);

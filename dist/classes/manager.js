"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComponentManager = exports.LottieManager = exports.NeuQuantManager = exports.ImageManager = exports.GradientManager = exports.GIFManager = exports.CanvasManager = void 0;
const canvas_1 = require("@napi-rs/canvas");
const forgescript_1 = require("@tryforge/forgescript");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const __1 = require("..");
const logger_1 = require("../structures/logger");
const loader_1 = require("../structures/loader");
class Manager {
    map;
    constructor() { this.map = new Map(); }
    get(name) { return this.map.get(name); }
    remove(name) { this.map.delete(name); }
}
class CanvasManager extends Manager {
    current;
    set(name, a, b) {
        if (typeof a === 'number')
            this.map.set(name, new __1.CanvasBuilder(a, b ?? a));
        else
            this.map.set(name, a);
    }
    getOrCurrent(name) {
        return this.map.get(name) ?? this.current;
    }
}
exports.CanvasManager = CanvasManager;
class GIFManager {
    encoders;
    decoders;
    decodeOptions;
    frames;
    currentOptions;
    currentEncoder;
    constructor() {
        this.encoders = new Map();
        this.decoders = new Map();
        this.decodeOptions = new Map();
        this.frames = new Map();
    }
    getEncoderOrCurrent(name) {
        return this.encoders.get(name) ?? this.currentEncoder;
    }
    setEncoder(name, encoder) { this.encoders.set(name, encoder); }
    setDecoder(name, decoder) { this.decoders.set(name, decoder); }
    setDecodeOptions(name, options) { this.decodeOptions.set(name, options); }
    setFrame(name, frame) { this.frames.set(name, frame); }
    getEncoder(name) { return this.encoders.get(name); }
    getDecoder(name) { return this.decoders.get(name); }
    getDecodeOptions(name) { return this.decodeOptions.get(name); }
    getFrame(name) { return this.frames.get(name); }
    removeEncoder(name) { this.encoders.delete(name); }
    removeDecoder(name) { this.decoders.delete(name); }
    removeDecodeOptions(name) { this.decodeOptions.delete(name); }
    removeFrame(name) { this.frames.delete(name); }
}
exports.GIFManager = GIFManager;
class GradientManager extends Manager {
    ctx;
    stops;
    constructor() {
        super();
        this.ctx = (0, canvas_1.createCanvas)(0, 0).getContext('2d');
        this.stops = [];
    }
    set(name, a, ...options) {
        if (typeof a !== 'object')
            this.map.set(name, a === 1 /* GradientType.radial */
                ? this.ctx.createRadialGradient(...options)
                : a === 2 /* GradientType.conic */
                    ? this.ctx.createConicGradient(...options)
                    : this.ctx.createLinearGradient(...options));
        else
            this.map.set(name, a);
    }
}
exports.GradientManager = GradientManager;
class ImageManager extends Manager {
    loadOptions;
    /** The loader policy this manager's loads follow (the bot's, or the strict defaults). */
    policy;
    /** Names stored by the automatic cache, oldest first; capped by policy.cache.maxImages. */
    cached = new Set();
    constructor(policy) {
        super();
        this.policy = policy ?? loader_1.DEFAULT_POLICY;
    }
    set(name, image) {
        this.cached.delete(name);
        this.map.set(name, image);
    }
    /** Stores an image the extension cached by itself (emojis, URLs, patterns); the oldest go first. */
    cache(name, image) {
        this.cached.delete(name);
        this.cached.add(name);
        this.map.set(name, image);
        const max = this.policy.cache.maxImages;
        for (const oldest of this.cached) {
            if (this.cached.size <= max)
                break;
            this.cached.delete(oldest);
            this.map.delete(oldest);
        }
    }
    remove(name) {
        this.cached.delete(name);
        this.map.delete(name);
    }
    async load(name, src, fetchOptions) {
        if (name instanceof canvas_1.Image)
            return name;
        if (src !== undefined && !isImageSource(src)) {
            fetchOptions = src;
            src = undefined;
        }
        const image = await (0, loader_1.loadImageFrom)(src ?? name, this.policy, this.loadOptions, fetchOptions);
        if (typeof name === 'string')
            this.cache(name, image);
        return image;
    }
    async tryGet(name, src, fetchOptions) {
        const image = this.map.get(name);
        if (image) {
            if (logger_1.log.enabled('debug'))
                logger_1.log.debug(`cache hit: ${/^https?:/i.test(name) ? (0, loader_1.describeUrl)(name) : name}`);
            return image;
        }
        return this.load(name, src, fetchOptions ?? {});
    }
}
exports.ImageManager = ImageManager;
function isImageSource(x) {
    return typeof x === 'string' || x instanceof URL || x instanceof canvas_1.Image
        || Buffer.isBuffer(x) || x instanceof Uint8Array || x instanceof ArrayBuffer
        || (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer);
}
class NeuQuantManager extends Manager {
    set(name, nq) { this.map.set(name, nq); }
}
exports.NeuQuantManager = NeuQuantManager;
class LottieManager extends Manager {
    set(name, lottie) { this.map.set(name, lottie); }
}
exports.LottieManager = LottieManager;
class ComponentManager extends Manager {
    set(component) {
        this.map.set(// @ts-ignore
        component?.data?.name ?? component.name, component instanceof forgescript_1.ForgeFunction
            ? component : new forgescript_1.ForgeFunction(component));
    }
    load(path, verbose) {
        if (!(0, node_fs_1.existsSync)(path)) {
            logger_1.log.error(`Component ${path} does not exist`);
            throw new Error(`${logger_1.LOG_PREFIX} Component ${path} does not exist`);
        }
        if ((0, node_fs_1.statSync)(path).isFile()) {
            if (!path.endsWith('.js'))
                return;
            try {
                require.cache[path] = undefined;
                const r = require(path);
                const component = r?.default ?? r;
                this.set(component);
                if (verbose)
                    logger_1.log.print(`Successfully loaded component: ${component.data?.name ?? component.name}`);
            }
            catch (error) {
                logger_1.log.error(`Failed to load component ${path}: ${error}`);
                throw new Error(`${logger_1.LOG_PREFIX} Failed to load component ${path}: ${error}`);
            }
        }
        else
            for (const child of (0, node_fs_1.readdirSync)(path))
                this.load((0, node_path_1.join)(path, child), verbose);
    }
}
exports.ComponentManager = ComponentManager;

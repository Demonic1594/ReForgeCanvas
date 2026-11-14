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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_POLICY = exports.DEFAULT_POLICY = exports.LOG_PREFIX = exports.LoaderError = void 0;
exports.resolvePolicy = resolvePolicy;
exports.setPolicy = setPolicy;
exports.policyOf = policyOf;
exports.isBlockedAddress = isBlockedAddress;
exports.addressRefused = addressRefused;
exports.hostAllowed = hostAllowed;
exports.describeUrl = describeUrl;
exports.fetchBytes = fetchBytes;
exports.resolveReadPath = resolveReadPath;
exports.assertReadablePath = assertReadablePath;
exports.readLocal = readLocal;
exports.writeLocal = writeLocal;
exports.sourceKind = sourceKind;
exports.loadSource = loadSource;
exports.loadImageFrom = loadImageFrom;
// ReForgeCanvas: the shared loader every image, font, GIF and Lottie source goes through.
const node_net_1 = require("node:net");
const dns = __importStar(require("node:dns"));
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const canvas_1 = require("@napi-rs/canvas");
/** A refused or failed load. `message` is for the log; users get a generic text. */
class LoaderError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'LoaderError';
    }
}
exports.LoaderError = LoaderError;
exports.LOG_PREFIX = '[ReForgeCanvas]';
function nonNegative(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function resolvePolicy(options = {}) {
    const n = options.network ?? {};
    const f = options.files ?? {};
    const hosts = (n.allowedHosts ?? []).map(normaliseHost).filter(Boolean);
    return Object.freeze({
        network: Object.freeze({
            enabled: n.enabled ?? true,
            timeout: nonNegative(n.timeout, 10_000) || 10_000,
            maxBytes: nonNegative(n.maxBytes, 10 * 1024 * 1024),
            maxRedirects: Math.floor(nonNegative(n.maxRedirects, 5)),
            allowedHosts: Object.freeze(hosts),
            allowPrivateNetwork: n.allowPrivateNetwork === true,
            privateAddresses: Object.freeze(Array.isArray(n.allowPrivateNetwork)
                ? n.allowPrivateNetwork.map(normaliseHost).filter(x => (0, node_net_1.isIP)(x)) : [])
        }),
        files: Object.freeze({
            read: typeof f.read === 'string' && f.read.length ? (0, node_path_1.resolve)(f.read) : null,
            write: typeof f.write === 'string' && f.write.length ? (0, node_path_1.resolve)(f.write) : null
        }),
        fonts: Object.freeze({
            maxDepth: Math.floor(nonNegative(options.fonts?.maxDepth, 3)),
            maxFiles: Math.floor(nonNegative(options.fonts?.maxFiles, 100))
        }),
        cache: Object.freeze({ maxImages: Math.floor(nonNegative(options.cache?.maxImages, 500)) })
    });
}
/** The policy used when no bot is known (managers created outside a command). */
exports.DEFAULT_POLICY = resolvePolicy();
/**
 * The policy for code the bot owner calls from JavaScript (registerFonts at start-up):
 * local files anywhere, as in ForgeCanvas, with the default network limits.
 */
exports.OWNER_POLICY = resolvePolicy({ files: { read: (0, node_path_1.parse)(process.cwd()).root } });
const policies = new WeakMap();
function setPolicy(client, policy) { policies.set(client, policy); }
function policyOf(client) {
    return (client && policies.get(client)) || exports.DEFAULT_POLICY;
}
/* ---------- addresses ---------- */
const blocked = new node_net_1.BlockList();
for (const [net, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
])
    blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
    ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
    ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
])
    blocked.addSubnet(net, prefix, 'ipv6');
/** Expands an IPv6 address to 8 numbers (handles `::` and a trailing dotted quad). */
function ipv6Groups(address) {
    let a = address.toLowerCase().split('%')[0];
    const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
    if (quad) {
        const [b0, b1, b2, b3] = quad.slice(1).map(Number);
        a = a.slice(0, quad.index) + ((b0 << 8) | b1).toString(16) + ':' + ((b2 << 8) | b3).toString(16);
    }
    const halves = a.split('::');
    if (halves.length > 2)
        return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail].map(x => parseInt(x, 16));
    return groups.length === 8 && groups.every(x => x >= 0 && x <= 0xffff) ? groups : null;
}
function v4FromGroups(hi, lo) {
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
/** True for loopback, private, link-local, multicast, documentation and other non-public addresses. */
function isBlockedAddress(address) {
    const family = (0, node_net_1.isIP)(address);
    if (family === 4)
        return blocked.check(address, 'ipv4');
    if (family !== 6)
        return true;
    const g = ipv6Groups(address);
    if (!g)
        return true;
    // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16)
    const zeros5 = g.slice(0, 5).every(x => x === 0);
    if (zeros5 && (g[5] === 0xffff || g[5] === 0) && (g[6] || g[7] || g[5]))
        return isBlockedAddress(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0))
        return isBlockedAddress(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x2002)
        return isBlockedAddress(v4FromGroups(g[1], g[2]));
    return blocked.check(address, 'ipv6');
}
/** True when the policy refuses this resolved address. */
function addressRefused(address, policy) {
    if (policy.network.allowPrivateNetwork || !isBlockedAddress(address))
        return false;
    const a = normaliseHost(address);
    return !policy.network.privateAddresses.some(x => x === a || ((0, node_net_1.isIP)(x) === 6 && (0, node_net_1.isIP)(a) === 6 && sameV6(x, a)));
}
function sameV6(a, b) {
    const x = ipv6Groups(a), y = ipv6Groups(b);
    return !!x && !!y && x.every((v, i) => v === y[i]);
}
function normaliseHost(host) {
    return String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}
function hostAllowed(hostname, policy, extraHosts = []) {
    const list = policy.network.allowedHosts;
    if (!list.length)
        return true;
    const host = normaliseHost(hostname);
    return [...list, ...extraHosts].some(entry => entry.startsWith('*.') ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1 : host === entry);
}
function safeLookup(policy) {
    return (hostname, options, callback) => {
        dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addresses) => {
            if (err)
                return callback(err);
            if (!addresses?.length)
                return callback(new LoaderError('FAILED', `${hostname} did not resolve`));
            const bad = addresses.find(a => addressRefused(a.address, policy));
            if (bad)
                return callback(new LoaderError('NOT_ALLOWED', `${hostname} resolves to a non-public address (${bad.address})`));
            if (options?.all)
                return callback(null, addresses);
            callback(null, addresses[0].address, addresses[0].family);
        });
    };
}
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** A URL for the log: no credentials, no query string. */
function describeUrl(url) {
    try {
        const u = new URL(String(url));
        return `${u.protocol}//${u.host}${u.pathname}`;
    }
    catch {
        return String(url).slice(0, 200);
    }
}
function checkUrl(url, policy, extraHosts) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new LoaderError('NOT_ALLOWED', `protocol ${url.protocol} is not allowed`);
    if (!policy.network.enabled)
        throw new LoaderError('NOT_ALLOWED', 'network sources are off (network.enabled)');
    if (url.username || url.password)
        throw new LoaderError('NOT_ALLOWED', 'URLs with credentials are not allowed');
    const host = normaliseHost(url.hostname);
    if (!hostAllowed(host, policy, extraHosts))
        throw new LoaderError('NOT_ALLOWED', `host ${host} is not in network.allowedHosts`);
    if ((0, node_net_1.isIP)(host) && addressRefused(host, policy))
        throw new LoaderError('NOT_ALLOWED', `${host} is a non-public address`);
}
function cleanHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
        const key = k.toLowerCase();
        if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(key))
            continue;
        if (typeof v === 'string' || typeof v === 'number')
            out[k] = String(v);
    }
    return out;
}
/** Fetches a URL under the policy: allowlist, address checks on every hop, redirect cap, timeout, size cap. */
function fetchBytes(input, policy, options = {}) {
    const limit = Math.min(policy.network.maxRedirects, nonNegative(options.maxRedirects, Infinity));
    const maxBytes = policy.network.maxBytes;
    const headers = cleanHeaders(options.headers);
    return new Promise((resolve, reject) => {
        let settled = false;
        let current;
        const finish = (err, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (err) {
                current?.destroy();
                reject(err);
            }
            else
                resolve(value);
        };
        const timer = setTimeout(() => finish(new LoaderError('TIMEOUT', `no complete answer within ${policy.network.timeout} ms`)), policy.network.timeout);
        const go = (url, hops) => {
            try {
                checkUrl(url, policy, options.extraHosts);
            }
            catch (e) {
                return finish(e);
            }
            const lib = url.protocol === 'https:' ? node_https_1.request : node_http_1.request;
            const req = lib(url, {
                method: 'GET',
                headers,
                agent: false,
                lookup: safeLookup(policy)
            }, (res) => {
                const status = res.statusCode ?? 0;
                if (REDIRECTS.has(status) && typeof res.headers.location === 'string') {
                    res.resume();
                    if (hops >= limit)
                        return finish(new LoaderError('NOT_ALLOWED', `more than ${limit} redirects`));
                    let next;
                    try {
                        next = new URL(res.headers.location, url);
                    }
                    catch {
                        return finish(new LoaderError('FAILED', 'invalid redirect location'));
                    }
                    return go(next, hops + 1);
                }
                if (status < 200 || status >= 300) {
                    res.resume();
                    return finish(new LoaderError('FAILED', `${describeUrl(url)} answered ${status}`));
                }
                const declared = Number(res.headers['content-length']);
                if (Number.isFinite(declared) && declared > maxBytes)
                    return finish(new LoaderError('TOO_LARGE', `${describeUrl(url)} is ${declared} bytes (network.maxBytes ${maxBytes})`));
                const chunks = [];
                let size = 0;
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        res.destroy();
                        return finish(new LoaderError('TOO_LARGE', `${describeUrl(url)} is over ${maxBytes} bytes (network.maxBytes)`));
                    }
                    chunks.push(chunk);
                });
                res.on('error', e => finish(e));
                res.on('end', () => finish(null, {
                    data: Buffer.concat(chunks),
                    contentType: String(res.headers['content-type'] ?? ''),
                    url: url.href
                }));
            });
            current = req;
            req.on('error', e => finish(e instanceof LoaderError ? e : new LoaderError('FAILED', `${describeUrl(url)}: ${e.message}`)));
            req.end();
        };
        let first;
        try {
            first = new URL(String(input));
        }
        catch {
            return finish(new LoaderError('FAILED', 'invalid URL'));
        }
        go(first, 0);
    });
}
/* ---------- local files ---------- */
function inside(child, root, allowSelf = false) {
    const rel = (0, node_path_1.relative)(root, child);
    if (rel === '')
        return allowSelf;
    return rel !== '..' && !rel.startsWith('..' + node_path_1.sep) && !(0, node_path_1.isAbsolute)(rel);
}
async function realRoot(root) {
    try {
        return await node_fs_1.promises.realpath(root);
    }
    catch {
        throw new LoaderError('FAILED', `folder ${root} does not exist`);
    }
}
/**
 * Resolves a local path the policy allows to read (relative paths start at the working directory).
 * `kind` "folder" also allows the files.read folder itself; "any" accepts a file or a folder.
 */
async function resolveReadPath(path, policy, kind = 'file') {
    const root = policy.files.read;
    if (!root)
        throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: local reads are off (set files.read)`);
    if (path.includes('\0'))
        throw new LoaderError('NOT_ALLOWED', 'path contains a NUL byte');
    const allowSelf = kind !== 'file';
    const abs = (0, node_path_1.resolve)(path);
    if (!inside(abs, root, allowSelf))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} is outside files.read (${root})`);
    let real;
    try {
        real = await node_fs_1.promises.realpath(abs);
    }
    catch {
        throw new LoaderError('FAILED', `local file ${abs} does not exist`);
    }
    if (!inside(real, await realRoot(root), allowSelf))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} links outside files.read (${root})`);
    const st = await node_fs_1.promises.stat(real);
    const folder = st.isDirectory();
    if ((kind === 'file' && !st.isFile()) || (kind === 'folder' && !folder) || (kind === 'any' && !folder && !st.isFile()))
        throw new LoaderError('FAILED', `${abs} is not a ${kind === 'folder' ? 'folder' : 'file'}`);
    if (folder && !inside(real, await realRoot(root), true))
        throw new LoaderError('NOT_ALLOWED', `${abs} is outside files.read`);
    return { path: real, size: st.size, folder };
}
/** Lexical check only, for paths a library will open later (Lottie assets). */
function assertReadablePath(path, policy) {
    const root = policy.files.read;
    if (!root)
        throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: local reads are off (set files.read)`);
    const abs = (0, node_path_1.resolve)(path);
    if (path.includes('\0') || !inside(abs, root, true))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} is outside files.read (${root})`);
    return abs;
}
async function readLocal(path, policy) {
    const { path: real, size } = await resolveReadPath(path, policy);
    if (size > policy.network.maxBytes)
        throw new LoaderError('TOO_LARGE', `local file ${real} is ${size} bytes (network.maxBytes ${policy.network.maxBytes})`);
    return node_fs_1.promises.readFile(real);
}
/** Writes inside files.write only, without following a symbolic link at the target. */
async function writeLocal(path, data, policy) {
    const root = policy.files.write;
    if (!root)
        throw new LoaderError('NOT_ALLOWED', `writing ${path} refused: file writes are off (set files.write)`);
    if (path.includes('\0'))
        throw new LoaderError('NOT_ALLOWED', 'path contains a NUL byte');
    const abs = (0, node_path_1.resolve)(path);
    if (!inside(abs, root))
        throw new LoaderError('NOT_ALLOWED', `${abs} is outside files.write (${root})`);
    let dir;
    try {
        dir = await node_fs_1.promises.realpath((0, node_path_1.dirname)(abs));
    }
    catch {
        throw new LoaderError('FAILED', `folder ${(0, node_path_1.dirname)(abs)} does not exist`);
    }
    if (!inside(dir, await realRoot(root), true))
        throw new LoaderError('NOT_ALLOWED', `${abs} links outside files.write (${root})`);
    const target = (0, node_path_1.join)(dir, (0, node_path_1.basename)(abs));
    const existing = await node_fs_1.promises.lstat(target).catch(() => null);
    if (existing?.isSymbolicLink())
        throw new LoaderError('NOT_ALLOWED', `${target} is a symbolic link`);
    if (existing && !existing.isFile())
        throw new LoaderError('FAILED', `${target} is not a file`);
    const flags = typeof node_fs_1.constants.O_NOFOLLOW === 'number'
        ? node_fs_1.constants.O_WRONLY | node_fs_1.constants.O_CREAT | node_fs_1.constants.O_TRUNC | node_fs_1.constants.O_NOFOLLOW : 'w';
    await node_fs_1.promises.writeFile(target, data, { flag: flags });
    return target;
}
function sourceKind(src) {
    const s = src.trimStart();
    if (/^https?:\/\//i.test(s))
        return 'http';
    if (/^data:/i.test(s))
        return 'data';
    if (/^[a-z]:[\\/]/i.test(s))
        return 'path'; // Windows drive
    if (/^[a-z][a-z0-9+.-]*:/i.test(s))
        return 'other';
    return 'path';
}
/**
 * Turns a text source into bytes (or a data: URL) under the policy.
 * http(s): fetched with every limit; data: passed through; local path: files.read only; anything else refused.
 */
async function loadSource(src, policy, options = {}) {
    switch (sourceKind(src)) {
        case 'http': return (await fetchBytes(src.trim(), policy, options)).data;
        case 'data': return src.trimStart();
        case 'path': return readLocal(src, policy);
        default: throw new LoaderError('NOT_ALLOWED', `source scheme ${src.slice(0, src.indexOf(':') + 1)} is not allowed`);
    }
}
/**
 * Loads an image under the policy. @napi-rs/canvas only ever receives bytes or a data: URL,
 * never a path or a URL, so its own file reads and unlimited fetches are not reachable.
 */
async function loadImageFrom(src, policy, loadOptions, fetchOptions = {}) {
    if (src instanceof canvas_1.Image)
        return src;
    if (src instanceof URL)
        src = src.href;
    const data = typeof src === 'string'
        ? await loadSource(src, policy, {
            maxRedirects: loadOptions?.maxRedirects,
            headers: loadOptions?.requestOptions?.headers,
            ...fetchOptions
        })
        : src;
    try {
        return await (0, canvas_1.loadImage)(data, { alt: loadOptions?.alt });
    }
    catch (e) {
        throw new LoaderError('FAILED', `could not decode the image: ${e?.message ?? e}`);
    }
}

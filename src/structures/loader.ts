/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

// ReForgeCanvas: the shared loader every image, font, GIF and Lottie source goes through.

import { BlockList, isIP } from 'node:net';
import * as dns from 'node:dns';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { promises as fsp, constants as fsc } from 'node:fs';
import { resolve as resolvePath, relative, isAbsolute, sep, dirname, basename, join, parse as parsePath } from 'node:path';

import type { ForgeClient } from '@tryforge/forgescript';
import { Image, loadImage, LoadImageOptions } from '@napi-rs/canvas';
import { LOG_PREFIX, LOG_LEVELS, LogLevel, envLogLevel, log } from './logger';

export { LOG_PREFIX, LOG_LEVELS, LogLevel } from './logger';

/** Options a bot owner passes to `new ReForgeCanvas({ ... })`. Every field is optional. */
export interface IReForgeCanvasOptions {
    /** What ReForgeCanvas prints. Default: REFORGECANVAS_LOG_LEVEL, else "warn" */
    logLevel?: LogLevel;
    network?: {
        /** Allow http(s) sources at all. Default: true */
        enabled?: boolean;
        /** Time limit for one load, all redirects and the body included, in ms. Default: 10000 */
        timeout?: number;
        /** Largest response (and local file) accepted, in bytes. Default: 10 MiB */
        maxBytes?: number;
        /** Redirects followed per load. Default: 5 */
        maxRedirects?: number;
        /** Hosts that may be fetched (`example.com`, `*.example.com`). Empty: any public host. Default: [] */
        allowedHosts?: string[];
        /**
         * Allow loopback, private, link-local and other non-public addresses: true for all of them,
         * or a list of exact addresses (e.g. a local image server at "10.0.0.5"). Default: false
         */
        allowPrivateNetwork?: boolean | string[];
    };
    files?: {
        /**
         * Where ForgeScript functions may read local files: a folder (recommended), true for the bot's
         * working folder with guards (images, fonts, GIFs and Lottie files only; no hidden files,
         * node_modules or databases), or null for none. Default: null
         */
        read?: string | boolean | null;
        /** Where $saveCanvas and $saveEncoder may write: a folder, true (working folder, guarded), or null. Default: null */
        write?: string | boolean | null;
    };
    fonts?: {
        /** Nesting allowed for stylesheets and font folders. Default: 3 */
        maxDepth?: number;
        /** Font files one registration may load. Default: 100 */
        maxFiles?: number;
    };
    cache?: {
        /** Images kept in an automatic cache (emojis, URLs, patterns) per manager. Default: 500 */
        maxImages?: number;
    };
    limits?: {
        /** Largest canvas or GIF encoder ($createCanvas, $resizeCanvas, $newGIFEncoder), in pixels. Default: 25,000,000 */
        maxCanvasPixels?: number;
        /** Largest image to decode, in pixels, read from its header before decoding. Default: 25,000,000 */
        maxImagePixels?: number;
        /** Frames one GIF encoder may hold. Default: 300 */
        maxGifFrames?: number;
        /** Pixels of all frames of one GIF encoder together. Default: 100,000,000 */
        maxGifPixels?: number;
        /** Emoji images one $drawText may load; the rest stay text. Default: 50 */
        maxEmojisPerText?: number;
    };
}

export interface LoaderPolicy {
    readonly logLevel: LogLevel;
    readonly network: {
        readonly enabled: boolean;
        readonly timeout: number;
        readonly maxBytes: number;
        readonly maxRedirects: number;
        readonly allowedHosts: readonly string[];
        readonly allowPrivateNetwork: boolean;
        readonly privateAddresses: readonly string[];
    };
    /** read/write: the folder; readGuarded/writeGuarded: true when it came from `true` (the working folder). */
    readonly files: { readonly read: string | null; readonly write: string | null; readonly readGuarded: boolean; readonly writeGuarded: boolean };
    readonly fonts: { readonly maxDepth: number; readonly maxFiles: number };
    readonly cache: { readonly maxImages: number };
    readonly limits: {
        readonly maxCanvasPixels: number;
        readonly maxImagePixels: number;
        readonly maxGifFrames: number;
        readonly maxGifPixels: number;
        readonly maxEmojisPerText: number;
    };
}

export type LoaderErrorCode = 'NOT_ALLOWED' | 'TOO_LARGE' | 'TIMEOUT' | 'FAILED';

/** A refused or failed load. `message` is for the log; users get a generic text. */
export class LoaderError extends Error {
    constructor(public readonly code: LoaderErrorCode, message: string) {
        super(message);
        this.name = 'LoaderError';
    }
}

function optionError(message: string): never {
    throw new TypeError(`${LOG_PREFIX} ${message}`);
}

function num(value: unknown, fallback: number, key: string, min = 0) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || Number.isNaN(value) || value < min)
        optionError(`${key} must be a number of at least ${min} (Infinity for no limit), got ${JSON.stringify(value)}`);
    return value;
}

function folder(value: unknown, key: string): { dir: string | null, guarded: boolean } {
    if (value === undefined || value === null || value === false) return { dir: null, guarded: false };
    if (value === true) return { dir: process.cwd(), guarded: true };
    if (typeof value === 'string' && value.trim().length) return { dir: resolvePath(value), guarded: false };
    return optionError(`${key} must be a folder path, true (the working folder, guarded) or null, got ${JSON.stringify(value)}`);
}

/** Checks the options and fills in the defaults; a wrong option throws here, in the extension's constructor. */
export function resolvePolicy(options: IReForgeCanvasOptions = {}): LoaderPolicy {
    if (options === null || typeof options !== 'object') optionError('options must be an object');
    const n = options.network ?? {};
    const f = options.files ?? {};
    const l = options.limits ?? {};
    if (options.logLevel !== undefined && !(LOG_LEVELS as unknown[]).includes(options.logLevel))
        optionError(`logLevel must be one of ${LOG_LEVELS.join(', ')}, got ${JSON.stringify(options.logLevel)}`);
    if (n.allowedHosts !== undefined && !(Array.isArray(n.allowedHosts) && n.allowedHosts.every(h => typeof h === 'string')))
        optionError('network.allowedHosts must be a list of host names');
    if (n.allowPrivateNetwork !== undefined && typeof n.allowPrivateNetwork !== 'boolean'
        && !(Array.isArray(n.allowPrivateNetwork) && n.allowPrivateNetwork.every(a => typeof a === 'string' && isIP(normaliseHost(a)))))
        optionError('network.allowPrivateNetwork must be true, false or a list of IP addresses');
    const read = folder(f.read, 'files.read');
    const write = folder(f.write, 'files.write');
    const hosts = (n.allowedHosts ?? []).map(normaliseHost).filter(Boolean);
    return Object.freeze({
        logLevel: options.logLevel ?? envLogLevel() ?? 'info',
        network: Object.freeze({
            enabled: n.enabled ?? true,
            timeout: num(n.timeout, 10_000, 'network.timeout', 1),
            maxBytes: num(n.maxBytes, 10 * 1024 * 1024, 'network.maxBytes'),
            maxRedirects: Math.floor(num(n.maxRedirects, 5, 'network.maxRedirects')),
            allowedHosts: Object.freeze(hosts),
            allowPrivateNetwork: n.allowPrivateNetwork === true,
            privateAddresses: Object.freeze(Array.isArray(n.allowPrivateNetwork)
                ? n.allowPrivateNetwork.map(normaliseHost).filter(x => isIP(x)) : [])
        }),
        files: Object.freeze({ read: read.dir, write: write.dir, readGuarded: read.guarded, writeGuarded: write.guarded }),
        fonts: Object.freeze({
            maxDepth: Math.floor(num(options.fonts?.maxDepth, 3, 'fonts.maxDepth')),
            maxFiles: Math.floor(num(options.fonts?.maxFiles, 100, 'fonts.maxFiles'))
        }),
        cache: Object.freeze({ maxImages: Math.floor(num(options.cache?.maxImages, 500, 'cache.maxImages')) }),
        limits: Object.freeze({
            maxCanvasPixels: num(l.maxCanvasPixels, 25_000_000, 'limits.maxCanvasPixels', 1),
            maxImagePixels: num(l.maxImagePixels, 25_000_000, 'limits.maxImagePixels', 1),
            maxGifFrames: num(l.maxGifFrames, 300, 'limits.maxGifFrames', 1),
            maxGifPixels: num(l.maxGifPixels, 100_000_000, 'limits.maxGifPixels', 1),
            maxEmojisPerText: Math.floor(num(l.maxEmojisPerText, 50, 'limits.maxEmojisPerText'))
        })
    });
}

/** The policy used when no bot is known (managers created outside a command). */
export const DEFAULT_POLICY = resolvePolicy();

/**
 * The policy for code the bot owner calls from JavaScript (registerFonts at start-up):
 * local files anywhere, as in ForgeCanvas, with the default network limits.
 */
export const OWNER_POLICY = resolvePolicy({ files: { read: parsePath(process.cwd()).root } });

const policies = new WeakMap<object, LoaderPolicy>();

export function setPolicy(client: ForgeClient, policy: LoaderPolicy) { policies.set(client, policy) }
export function policyOf(client: ForgeClient | null | undefined): LoaderPolicy {
    return (client && policies.get(client)) || DEFAULT_POLICY;
}

/* ---------- addresses ---------- */

const blocked = new BlockList();
for (const [net, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
    ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
    ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Expands an IPv6 address to 8 numbers (handles `::` and a trailing dotted quad). */
function ipv6Groups(address: string): number[] | null {
    let a = address.toLowerCase().split('%')[0];
    const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
    if (quad) {
        const [b0, b1, b2, b3] = quad.slice(1).map(Number);
        a = a.slice(0, quad.index) + ((b0 << 8) | b1).toString(16) + ':' + ((b2 << 8) | b3).toString(16);
    }
    const halves = a.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail].map(x => parseInt(x, 16));
    return groups.length === 8 && groups.every(x => x >= 0 && x <= 0xffff) ? groups : null;
}

function v4FromGroups(hi: number, lo: number) {
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for loopback, private, link-local, multicast, documentation and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return blocked.check(address, 'ipv4');
    if (family !== 6) return true;

    const g = ipv6Groups(address);
    if (!g) return true;
    // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16)
    const zeros5 = g.slice(0, 5).every(x => x === 0);
    if (zeros5 && (g[5] === 0xffff || g[5] === 0) && (g[6] || g[7] || g[5]))
        return isBlockedAddress(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0))
        return isBlockedAddress(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x2002) return isBlockedAddress(v4FromGroups(g[1], g[2]));
    return blocked.check(address, 'ipv6');
}

/** True when the policy refuses this resolved address. */
export function addressRefused(address: string, policy: LoaderPolicy) {
    if (policy.network.allowPrivateNetwork || !isBlockedAddress(address)) return false;
    const a = normaliseHost(address);
    return !policy.network.privateAddresses.some(x => x === a || (isIP(x) === 6 && isIP(a) === 6 && sameV6(x, a)));
}

function sameV6(a: string, b: string) {
    const x = ipv6Groups(a), y = ipv6Groups(b);
    return !!x && !!y && x.every((v, i) => v === y[i]);
}

function normaliseHost(host: string) {
    return String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function hostAllowed(hostname: string, policy: LoaderPolicy, extraHosts: readonly string[] = []) {
    const list = policy.network.allowedHosts;
    if (!list.length) return true;
    const host = normaliseHost(hostname);
    return [...list, ...extraHosts].some(entry =>
        entry.startsWith('*.') ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1 : host === entry
    );
}

function safeLookup(policy: LoaderPolicy) {
    return (hostname: string, options: any, callback: (...args: any[]) => void) => {
        dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addresses: dns.LookupAddress[]) => {
            if (err) return callback(err);
            if (!addresses?.length) return callback(new LoaderError('FAILED', `${hostname} did not resolve`));
            const bad = addresses.find(a => addressRefused(a.address, policy));
            if (bad) return callback(new LoaderError('NOT_ALLOWED', `${hostname} resolves to a non-public address (${bad.address})`));
            if (options?.all) return callback(null, addresses);
            callback(null, addresses[0].address, addresses[0].family);
        });
    };
}

/* ---------- network ---------- */

export interface FetchOptions {
    /** Lowers the policy's redirect limit (from $loadImageOptions). */
    maxRedirects?: number;
    headers?: Record<string, string>;
    /** Hosts allowed for this load even with an allowlist (fixed URLs the extension builds itself). */
    extraHosts?: readonly string[];
}

export interface FetchResult { data: Buffer; contentType: string; url: string }

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** A URL for the log: no credentials, no query string. */
export function describeUrl(url: string | URL) {
    try {
        const u = new URL(String(url));
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch { return String(url).slice(0, 200) }
}

function checkUrl(url: URL, policy: LoaderPolicy, extraHosts?: readonly string[]) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new LoaderError('NOT_ALLOWED', `protocol ${url.protocol} is not allowed`);
    if (!policy.network.enabled) throw new LoaderError('NOT_ALLOWED', 'network sources are off (network.enabled)');
    if (url.username || url.password) throw new LoaderError('NOT_ALLOWED', 'URLs with credentials are not allowed');
    const host = normaliseHost(url.hostname);
    if (!hostAllowed(host, policy, extraHosts))
        throw new LoaderError('NOT_ALLOWED', `host ${host} is not in network.allowedHosts`);
    if (isIP(host) && addressRefused(host, policy))
        throw new LoaderError('NOT_ALLOWED', `${host} is a non-public address`);
    // RFC 6761: localhost and *.localhost always mean this machine, whatever DNS says
    if ((host === 'localhost' || host.endsWith('.localhost')) && !policy.network.allowPrivateNetwork
        && !policy.network.privateAddresses.some(x => x === '127.0.0.1' || x === '::1'))
        throw new LoaderError('NOT_ALLOWED', `${host} is this machine`);
}

function cleanHeaders(headers?: Record<string, unknown>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
        const key = k.toLowerCase();
        if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(key)) continue;
        if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
    }
    return out;
}

/** Fetches a URL under the policy: allowlist, address checks on every hop, redirect cap, timeout, size cap. */
export function fetchBytes(input: string | URL, policy: LoaderPolicy, options: FetchOptions = {}): Promise<FetchResult> {
    const limit = Math.min(policy.network.maxRedirects, typeof options.maxRedirects === 'number' && options.maxRedirects >= 0 ? options.maxRedirects : Infinity);
    const maxBytes = policy.network.maxBytes;
    const headers = cleanHeaders(options.headers);

    return new Promise<FetchResult>((resolve, reject) => {
        let settled = false;
        let current: ReturnType<typeof httpRequest> | undefined;
        const finish = (err: Error | null, value?: FetchResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (err) { current?.destroy(); reject(err) } else resolve(value!);
        };
        const started = Date.now();
        const timer = setTimeout(
            () => finish(new LoaderError('TIMEOUT', `no complete answer within ${policy.network.timeout} ms`)),
            policy.network.timeout
        );

        const go = (url: URL, hops: number) => {
            try { checkUrl(url, policy, options.extraHosts) } catch (e: any) { return finish(e) }
            const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
            const req = lib(url, {
                method: 'GET',
                headers,
                agent: false,
                lookup: safeLookup(policy) as any
            }, (res: IncomingMessage) => {
                const status = res.statusCode ?? 0;
                if (REDIRECTS.has(status) && typeof res.headers.location === 'string') {
                    res.resume();
                    if (hops >= limit) return finish(new LoaderError('NOT_ALLOWED', `more than ${limit} redirects`));
                    let next: URL;
                    try { next = new URL(res.headers.location, url) } catch {
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

                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        res.destroy();
                        return finish(new LoaderError('TOO_LARGE', `${describeUrl(url)} is over ${maxBytes} bytes (network.maxBytes)`));
                    }
                    chunks.push(chunk);
                });
                res.on('error', e => finish(e));
                res.on('end', () => {
                    if (log.enabled('debug')) log.debug(`fetched ${describeUrl(url)}: ${size} bytes in ${Date.now() - started} ms${hops ? ` after ${hops} redirect(s)` : ''}`);
                    finish(null, { data: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? ''), url: url.href });
                });
            });
            current = req;
            req.on('error', e => finish(e instanceof LoaderError ? e : new LoaderError('FAILED', `${describeUrl(url)}: ${e.message}`)));
            req.end();
        };

        let first: URL;
        try { first = new URL(String(input)) } catch { return finish(new LoaderError('FAILED', 'invalid URL')) }
        go(first, 0);
    });
}

/* ---------- local files ---------- */

const READ_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'ttf', 'otf', 'woff', 'woff2', 'ttc', 'json']);
const WRITE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif']);
const DATABASE_NAME = /\.(db|sqlite|sqlite3|db3|sdb)$|-(wal|shm|journal)$/i;

/** Refuses files: true would otherwise expose: hidden files and folders, node_modules, databases, other kinds of files. */
function guard(path: string, root: string, kind: 'read' | 'write', folderOk: boolean) {
    const parts = relative(root, path).split(sep).filter(Boolean);
    const bad = parts.find(x => x.startsWith('.') || x === 'node_modules');
    if (bad) throw new LoaderError('NOT_ALLOWED', `${path}: ${bad} is never ${kind === 'read' ? 'read' : 'written'} with files.${kind}: true (hidden files and node_modules are refused)`);
    const name = parts[parts.length - 1] ?? '';
    if (DATABASE_NAME.test(name)) throw new LoaderError('NOT_ALLOWED', `${path}: database files are refused with files.${kind}: true`);
    if (folderOk) return;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!(kind === 'read' ? READ_EXTENSIONS : WRITE_EXTENSIONS).has(ext))
        throw new LoaderError('NOT_ALLOWED', `${path}: only ${[...(kind === 'read' ? READ_EXTENSIONS : WRITE_EXTENSIONS)].join(', ')} files are allowed with files.${kind}: true`);
}

const OFF_READ = 'local reads are off: set files: { read: "./assets" } to the folder your images and fonts are in (or read: true for the bot folder, guarded)';
const OFF_WRITE = 'file writes are off: set files: { write: "./output" } to an existing folder (or write: true for the bot folder, guarded)';

/** A path for the log, relative to the working folder when it is inside it. */
export function describePath(path: string) {
    const rel = relative(process.cwd(), path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

function inside(child: string, root: string, allowSelf = false) {
    const rel = relative(root, child);
    if (rel === '') return allowSelf;
    return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

async function realRoot(root: string) {
    try { return await fsp.realpath(root) } catch {
        throw new LoaderError('FAILED', `folder ${root} does not exist`);
    }
}

/**
 * Resolves a local path the policy allows to read (relative paths start at the working directory).
 * `kind` "folder" also allows the files.read folder itself; "any" accepts a file or a folder.
 */
export async function resolveReadPath(path: string, policy: LoaderPolicy, kind: 'file' | 'folder' | 'any' = 'file') {
    const root = policy.files.read;
    if (!root) throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: ${OFF_READ}`);
    if (path.includes('\0')) throw new LoaderError('NOT_ALLOWED', 'path contains a NUL byte');

    const allowSelf = kind !== 'file';
    const abs = resolvePath(path);
    if (!inside(abs, root, allowSelf)) throw new LoaderError('NOT_ALLOWED', `local file ${abs} is outside files.read (${root})`);

    let real: string;
    try { real = await fsp.realpath(abs) } catch { throw new LoaderError('FAILED', `local file ${abs} does not exist`) }
    if (!inside(real, await realRoot(root), allowSelf))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} links outside files.read (${root})`);

    const st = await fsp.stat(real);
    const folder = st.isDirectory();
    if ((kind === 'file' && !st.isFile()) || (kind === 'folder' && !folder) || (kind === 'any' && !folder && !st.isFile()))
        throw new LoaderError('FAILED', `${abs} is not a ${kind === 'folder' ? 'folder' : 'file'}`);
    if (folder && !inside(real, await realRoot(root), true)) throw new LoaderError('NOT_ALLOWED', `${abs} is outside files.read`);
    if (policy.files.readGuarded) {
        // the name asked for and the file it really is (a link inside the folder) must both pass
        guard(abs, root, 'read', folder);
        guard(real, await realRoot(root), 'read', folder);
    }
    return { path: real, size: st.size, folder };
}

/** Lexical check only, for paths a library will open later (Lottie assets). */
export function assertReadablePath(path: string, policy: LoaderPolicy) {
    const root = policy.files.read;
    if (!root) throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: ${OFF_READ}`);
    const abs = resolvePath(path);
    if (path.includes('\0') || !inside(abs, root, true))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} is outside files.read (${root})`);
    if (policy.files.readGuarded) guard(abs, root, 'read', false);
    return abs;
}

export async function readLocal(path: string, policy: LoaderPolicy) {
    const { path: real, size } = await resolveReadPath(path, policy);
    if (size > policy.network.maxBytes)
        throw new LoaderError('TOO_LARGE', `local file ${real} is ${size} bytes (network.maxBytes ${policy.network.maxBytes})`);
    const data = await fsp.readFile(real);
    // files.read: true: a database renamed to .png is still a database
    if (policy.files.readGuarded && data.subarray(0, 16).toString('latin1') === 'SQLite format 3\0')
        throw new LoaderError('NOT_ALLOWED', `${describePath(real)} is a SQLite database: refused with files.read: true`);
    if (log.enabled('debug')) log.debug(`read ${describePath(real)}: ${data.length} bytes`);
    return data;
}

/** Writes inside files.write only, without following a symbolic link at the target. */
export async function writeLocal(path: string, data: Buffer | Uint8Array, policy: LoaderPolicy) {
    const root = policy.files.write;
    if (!root) throw new LoaderError('NOT_ALLOWED', `writing ${path} refused: ${OFF_WRITE}`);
    if (path.includes('\0')) throw new LoaderError('NOT_ALLOWED', 'path contains a NUL byte');

    const abs = resolvePath(path);
    if (!inside(abs, root)) throw new LoaderError('NOT_ALLOWED', `${abs} is outside files.write (${root})`);

    let dir: string;
    try { dir = await fsp.realpath(dirname(abs)) } catch { throw new LoaderError('FAILED', `folder ${dirname(abs)} does not exist`) }
    if (!inside(dir, await realRoot(root), true)) throw new LoaderError('NOT_ALLOWED', `${abs} links outside files.write (${root})`);

    const target = join(dir, basename(abs));
    if (policy.files.writeGuarded) guard(target, await realRoot(root), 'write', false);
    const existing = await fsp.lstat(target).catch(() => null);
    if (existing?.isSymbolicLink()) throw new LoaderError('NOT_ALLOWED', `${target} is a symbolic link`);
    if (existing && !existing.isFile()) throw new LoaderError('FAILED', `${target} is not a file`);

    const flags = typeof fsc.O_NOFOLLOW === 'number'
        ? fsc.O_WRONLY | fsc.O_CREAT | fsc.O_TRUNC | fsc.O_NOFOLLOW : 'w';
    await fsp.writeFile(target, data, { flag: flags as any });
    if (log.enabled('debug')) log.debug(`wrote ${describePath(target)}: ${data.length} bytes`);
    return target;
}

/* ---------- sources ---------- */

export type SourceKind = 'http' | 'data' | 'path' | 'other';

export function sourceKind(src: string): SourceKind {
    const s = src.trimStart();
    if (/^https?:\/\//i.test(s)) return 'http';
    if (/^data:/i.test(s)) return 'data';
    if (/^[a-z]:[\\/]/i.test(s)) return 'path'; // Windows drive
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'other';
    return 'path';
}

/**
 * Turns a text source into bytes (or a data: URL) under the policy.
 * http(s): fetched with every limit; data: passed through; local path: files.read only; anything else refused.
 */
export async function loadSource(src: string, policy: LoaderPolicy, options: FetchOptions = {}): Promise<Buffer | string> {
    switch (sourceKind(src)) {
        case 'http': return (await fetchBytes(src.trim(), policy, options)).data;
        case 'data': return src.trimStart();
        case 'path': return readLocal(src, policy);
        default: throw new LoaderError('NOT_ALLOWED', `source scheme ${src.slice(0, src.indexOf(':') + 1)} is not allowed`);
    }
}

/* ---------- images ---------- */

export type ImageSource = string | Buffer | Uint8Array | Image | ArrayBufferLike | URL;

/**
 * Loads an image under the policy. @napi-rs/canvas only ever receives bytes or a data: URL,
 * never a path or a URL, so its own file reads and unlimited fetches are not reachable.
 */
export async function loadImageFrom(
    src: ImageSource,
    policy: LoaderPolicy,
    loadOptions?: LoadImageOptions,
    fetchOptions: FetchOptions = {}
): Promise<Image> {
    if (src instanceof Image) return src;
    if (src instanceof URL) src = src.href;

    let data = typeof src === 'string'
        ? await loadSource(src, policy, {
            maxRedirects: loadOptions?.maxRedirects,
            headers: (loadOptions?.requestOptions as any)?.headers,
            ...fetchOptions
        })
        : src;
    if (typeof data === 'string') data = dataUrlBytes(data);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

    // the size an image decodes to is in its header: refuse a small file that would decode to a huge bitmap
    const size = imageDimensions(bytes);
    const max = policy.limits.maxImagePixels;
    if (size && size.width * size.height > max)
        throw new LoaderError('TOO_LARGE', `the image is ${size.width}x${size.height} (${size.format}), over limits.maxImagePixels ${max}`);

    let image: Image;
    try {
        image = await loadImage(bytes, { alt: loadOptions?.alt });
    } catch (e: any) {
        throw new LoaderError('FAILED', `could not decode the image: ${e?.message ?? e}`);
    }
    if (!size && image.width * image.height > max)
        throw new LoaderError('TOO_LARGE', `the image is ${image.width}x${image.height}, over limits.maxImagePixels ${max}`);
    return image;
}

/** Bytes of a data: URL (base64 or percent-encoded); a malformed one fails like a broken image. */
export function dataUrlBytes(url: string) {
    const m = /^\s*data:([^,]*),(.*)$/is.exec(url);
    if (!m) throw new LoaderError('FAILED', 'invalid data: URL');
    return /;base64$/i.test(m[1].trim()) ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf8');
}

/**
 * Width and height from an image's header, without decoding it: PNG, GIF, JPEG, WebP, BMP, AVIF/HEIF and
 * SVG (width/height attributes or viewBox). null when the format is not recognised; the size is then
 * checked after decoding.
 */
export function imageDimensions(b: Buffer): { width: number, height: number, format: string } | null {
    try {
        if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR')
            return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' };
        if (b.length >= 10 && b.toString('latin1', 0, 4) === 'GIF8')
            return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: 'gif' };
        if (b.length >= 26 && b.toString('latin1', 0, 2) === 'BM')
            return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)), format: 'bmp' };
        if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
            const kind = b.toString('latin1', 12, 16);
            if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: 'webp' };
            if (kind === 'VP8L') {
                const v = b.readUInt32LE(21);
                return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1, format: 'webp' };
            }
            if (kind === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, format: 'webp' };
        }
        if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
            let i = 2;
            while (i + 9 < b.length) {
                if (b[i] !== 0xff) { i++; continue }
                const marker = b[i + 1];
                if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
                const len = b.readUInt16BE(i + 2);
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
                    return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), format: 'jpeg' };
                i += 2 + len;
            }
            return null;
        }
        if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
            const at = b.indexOf('ispe', 0, 'latin1');
            if (at > 0 && at + 16 <= b.length) return { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12), format: 'avif' };
            return null;
        }
        const head = b.toString('utf8', 0, Math.min(b.length, 4096));
        const svg = /<svg\b[^>]*>/i.exec(head)?.[0];
        if (svg) {
            const attr = (k: string) => { const m = new RegExp(`\\b${k}\\s*=\\s*["']\\s*([\\d.]+)`, 'i').exec(svg); return m ? Math.ceil(Number(m[1])) : null };
            const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
            const width = attr('width') ?? (vb ? Math.ceil(Number(vb[1])) : 300);
            const height = attr('height') ?? (vb ? Math.ceil(Number(vb[2])) : 150);
            return { width, height, format: 'svg' };
        }
    } catch { /* a truncated header: let the decoder report it */ }
    return null;
}

/** Throws when a canvas (or GIF encoder) of width x height is over limits.maxCanvasPixels. */
export function checkCanvasSize(width: number, height: number, policy: LoaderPolicy, what = 'canvas') {
    const max = policy.limits.maxCanvasPixels;
    if (!(width * height <= max))
        throw new LoaderError('TOO_LARGE', `a ${width}x${height} ${what} is over limits.maxCanvasPixels ${max}`);
}

const gifUsage = new WeakMap<object, { frames: number, pixels: number }>();

/** Counts a frame added to a GIF encoder against limits.maxGifFrames and limits.maxGifPixels. */
export function countGifFrame(encoder: object, pixels: number, policy: LoaderPolicy) {
    const u = gifUsage.get(encoder) ?? { frames: 0, pixels: 0 };
    if (u.frames + 1 > policy.limits.maxGifFrames)
        throw new LoaderError('TOO_LARGE', `the GIF already has ${u.frames} frames (limits.maxGifFrames ${policy.limits.maxGifFrames})`);
    if (u.pixels + pixels > policy.limits.maxGifPixels)
        throw new LoaderError('TOO_LARGE', `the GIF's frames would hold ${u.pixels + pixels} pixels (limits.maxGifPixels ${policy.limits.maxGifPixels})`);
    u.frames++;
    u.pixels += pixels;
    gifUsage.set(encoder, u);
}

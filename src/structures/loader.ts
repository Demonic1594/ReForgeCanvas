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

/** Options a bot owner passes to `new ReForgeCanvas({ ... })`. Every field is optional. */
export interface IReForgeCanvasOptions {
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
        /** Folder ForgeScript functions may read local files from. null: no local reads. Default: null */
        read?: string | null;
        /** Folder $saveCanvas and $saveEncoder may write to. null: no writes. Default: null */
        write?: string | null;
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
}

export interface LoaderPolicy {
    readonly network: {
        readonly enabled: boolean;
        readonly timeout: number;
        readonly maxBytes: number;
        readonly maxRedirects: number;
        readonly allowedHosts: readonly string[];
        readonly allowPrivateNetwork: boolean;
        readonly privateAddresses: readonly string[];
    };
    readonly files: { readonly read: string | null; readonly write: string | null };
    readonly fonts: { readonly maxDepth: number; readonly maxFiles: number };
    readonly cache: { readonly maxImages: number };
}

export type LoaderErrorCode = 'NOT_ALLOWED' | 'TOO_LARGE' | 'TIMEOUT' | 'FAILED';

/** A refused or failed load. `message` is for the log; users get a generic text. */
export class LoaderError extends Error {
    constructor(public readonly code: LoaderErrorCode, message: string) {
        super(message);
        this.name = 'LoaderError';
    }
}

export const LOG_PREFIX = '[ReForgeCanvas]';

function nonNegative(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function resolvePolicy(options: IReForgeCanvasOptions = {}): LoaderPolicy {
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
                ? n.allowPrivateNetwork.map(normaliseHost).filter(x => isIP(x)) : [])
        }),
        files: Object.freeze({
            read: typeof f.read === 'string' && f.read.length ? resolvePath(f.read) : null,
            write: typeof f.write === 'string' && f.write.length ? resolvePath(f.write) : null
        }),
        fonts: Object.freeze({
            maxDepth: Math.floor(nonNegative(options.fonts?.maxDepth, 3)),
            maxFiles: Math.floor(nonNegative(options.fonts?.maxFiles, 100))
        }),
        cache: Object.freeze({ maxImages: Math.floor(nonNegative(options.cache?.maxImages, 500)) })
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
    ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
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
    const limit = Math.min(policy.network.maxRedirects, nonNegative(options.maxRedirects, Infinity));
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

        let first: URL;
        try { first = new URL(String(input)) } catch { return finish(new LoaderError('FAILED', 'invalid URL')) }
        go(first, 0);
    });
}

/* ---------- local files ---------- */

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
    if (!root) throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: local reads are off (set files.read)`);
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
    return { path: real, size: st.size, folder };
}

/** Lexical check only, for paths a library will open later (Lottie assets). */
export function assertReadablePath(path: string, policy: LoaderPolicy) {
    const root = policy.files.read;
    if (!root) throw new LoaderError('NOT_ALLOWED', `local file ${path} refused: local reads are off (set files.read)`);
    const abs = resolvePath(path);
    if (path.includes('\0') || !inside(abs, root, true))
        throw new LoaderError('NOT_ALLOWED', `local file ${abs} is outside files.read (${root})`);
    return abs;
}

export async function readLocal(path: string, policy: LoaderPolicy) {
    const { path: real, size } = await resolveReadPath(path, policy);
    if (size > policy.network.maxBytes)
        throw new LoaderError('TOO_LARGE', `local file ${real} is ${size} bytes (network.maxBytes ${policy.network.maxBytes})`);
    return fsp.readFile(real);
}

/** Writes inside files.write only, without following a symbolic link at the target. */
export async function writeLocal(path: string, data: Buffer | Uint8Array, policy: LoaderPolicy) {
    const root = policy.files.write;
    if (!root) throw new LoaderError('NOT_ALLOWED', `writing ${path} refused: file writes are off (set files.write)`);
    if (path.includes('\0')) throw new LoaderError('NOT_ALLOWED', 'path contains a NUL byte');

    const abs = resolvePath(path);
    if (!inside(abs, root)) throw new LoaderError('NOT_ALLOWED', `${abs} is outside files.write (${root})`);

    let dir: string;
    try { dir = await fsp.realpath(dirname(abs)) } catch { throw new LoaderError('FAILED', `folder ${dirname(abs)} does not exist`) }
    if (!inside(dir, await realRoot(root), true)) throw new LoaderError('NOT_ALLOWED', `${abs} links outside files.write (${root})`);

    const target = join(dir, basename(abs));
    const existing = await fsp.lstat(target).catch(() => null);
    if (existing?.isSymbolicLink()) throw new LoaderError('NOT_ALLOWED', `${target} is a symbolic link`);
    if (existing && !existing.isFile()) throw new LoaderError('FAILED', `${target} is not a file`);

    const flags = typeof fsc.O_NOFOLLOW === 'number'
        ? fsc.O_WRONLY | fsc.O_CREAT | fsc.O_TRUNC | fsc.O_NOFOLLOW : 'w';
    await fsp.writeFile(target, data, { flag: flags as any });
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

    const data = typeof src === 'string'
        ? await loadSource(src, policy, {
            maxRedirects: loadOptions?.maxRedirects,
            headers: (loadOptions?.requestOptions as any)?.headers,
            ...fetchOptions
        })
        : src;

    try {
        return await loadImage(data as Buffer, { alt: loadOptions?.alt });
    } catch (e: any) {
        throw new LoaderError('FAILED', `could not decode the image: ${e?.message ?? e}`);
    }
}

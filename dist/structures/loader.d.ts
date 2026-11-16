import type { ForgeClient } from '@tryforge/forgescript';
import { Image, LoadImageOptions } from '@napi-rs/canvas';
import { LogLevel } from './logger';
export { LOG_PREFIX, LOG_LEVELS, LogLevel } from './logger';
/** Options a bot owner passes to `new ReForgeCanvas({ ... })`. Every field is optional. */
export interface IReForgeCanvasOptions {
    /** What ReForgeCanvas prints. Default: REFORGECANVAS_LOG_LEVEL, else "info" */
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
    readonly files: {
        readonly read: string | null;
        readonly write: string | null;
        readonly readGuarded: boolean;
        readonly writeGuarded: boolean;
    };
    readonly fonts: {
        readonly maxDepth: number;
        readonly maxFiles: number;
    };
    readonly cache: {
        readonly maxImages: number;
    };
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
export declare class LoaderError extends Error {
    readonly code: LoaderErrorCode;
    constructor(code: LoaderErrorCode, message: string);
}
/** Checks the options and fills in the defaults; a wrong option throws here, in the extension's constructor. */
export declare function resolvePolicy(options?: IReForgeCanvasOptions): LoaderPolicy;
/** The policy used when no bot is known (managers created outside a command). */
export declare const DEFAULT_POLICY: LoaderPolicy;
/**
 * The policy for code the bot owner calls from JavaScript (registerFonts at start-up):
 * local files anywhere, as in ForgeCanvas, with the default network limits.
 */
export declare const OWNER_POLICY: LoaderPolicy;
export declare function setPolicy(client: ForgeClient, policy: LoaderPolicy): void;
export declare function policyOf(client: ForgeClient | null | undefined): LoaderPolicy;
/** True for loopback, private, link-local, multicast, documentation and other non-public addresses. */
export declare function isBlockedAddress(address: string): boolean;
/** True when the policy refuses this resolved address. */
export declare function addressRefused(address: string, policy: LoaderPolicy): boolean;
export declare function hostAllowed(hostname: string, policy: LoaderPolicy, extraHosts?: readonly string[]): boolean;
export interface FetchOptions {
    /** Lowers the policy's redirect limit (from $loadImageOptions). */
    maxRedirects?: number;
    headers?: Record<string, string>;
    /** Hosts allowed for this load even with an allowlist (fixed URLs the extension builds itself). */
    extraHosts?: readonly string[];
}
export interface FetchResult {
    data: Buffer;
    contentType: string;
    url: string;
}
/** A URL for the log: no credentials, no query string. */
export declare function describeUrl(url: string | URL): string;
/** Fetches a URL under the policy: allowlist, address checks on every hop, redirect cap, timeout, size cap. */
export declare function fetchBytes(input: string | URL, policy: LoaderPolicy, options?: FetchOptions): Promise<FetchResult>;
/** A path for the log, relative to the working folder when it is inside it. */
export declare function describePath(path: string): string;
/**
 * Resolves a local path the policy allows to read (relative paths start at the working directory).
 * `kind` "folder" also allows the files.read folder itself; "any" accepts a file or a folder.
 */
export declare function resolveReadPath(path: string, policy: LoaderPolicy, kind?: 'file' | 'folder' | 'any'): Promise<{
    path: string;
    size: number;
    folder: boolean;
}>;
/** Lexical check only, for paths a library will open later (Lottie assets). */
export declare function assertReadablePath(path: string, policy: LoaderPolicy): string;
export declare function readLocal(path: string, policy: LoaderPolicy): Promise<NonSharedBuffer>;
/** Writes inside files.write only, without following a symbolic link at the target. */
export declare function writeLocal(path: string, data: Buffer | Uint8Array, policy: LoaderPolicy): Promise<string>;
export type SourceKind = 'http' | 'data' | 'path' | 'other';
export declare function sourceKind(src: string): SourceKind;
/**
 * Turns a text source into bytes (or a data: URL) under the policy.
 * http(s): fetched with every limit; data: passed through; local path: files.read only; anything else refused.
 */
export declare function loadSource(src: string, policy: LoaderPolicy, options?: FetchOptions): Promise<Buffer | string>;
export type ImageSource = string | Buffer | Uint8Array | Image | ArrayBufferLike | URL;
/**
 * Loads an image under the policy. @napi-rs/canvas only ever receives bytes or a data: URL,
 * never a path or a URL, so its own file reads and unlimited fetches are not reachable.
 */
export declare function loadImageFrom(src: ImageSource, policy: LoaderPolicy, loadOptions?: LoadImageOptions, fetchOptions?: FetchOptions): Promise<Image>;
/** Bytes of a data: URL (base64 or percent-encoded); a malformed one fails like a broken image. */
export declare function dataUrlBytes(url: string): Buffer<ArrayBuffer>;
/**
 * Width and height from an image's header, without decoding it: PNG, GIF, JPEG, WebP, BMP, AVIF/HEIF and
 * SVG (width/height attributes or viewBox). null when the format is not recognised; the size is then
 * checked after decoding.
 */
export declare function imageDimensions(b: Buffer): {
    width: number;
    height: number;
    format: string;
} | null;
/** Throws when a canvas (or GIF encoder) of width x height is over limits.maxCanvasPixels. */
export declare function checkCanvasSize(width: number, height: number, policy: LoaderPolicy, what?: string): void;
/** Counts a frame added to a GIF encoder against limits.maxGifFrames and limits.maxGifPixels. */
export declare function countGifFrame(encoder: object, pixels: number, policy: LoaderPolicy): void;

import type { ForgeClient } from '@tryforge/forgescript';
import { Image, LoadImageOptions } from '@napi-rs/canvas';
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
    readonly files: {
        readonly read: string | null;
        readonly write: string | null;
    };
    readonly fonts: {
        readonly maxDepth: number;
        readonly maxFiles: number;
    };
    readonly cache: {
        readonly maxImages: number;
    };
}
export type LoaderErrorCode = 'NOT_ALLOWED' | 'TOO_LARGE' | 'TIMEOUT' | 'FAILED';
/** A refused or failed load. `message` is for the log; users get a generic text. */
export declare class LoaderError extends Error {
    readonly code: LoaderErrorCode;
    constructor(code: LoaderErrorCode, message: string);
}
export declare const LOG_PREFIX = "[ReForgeCanvas]";
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

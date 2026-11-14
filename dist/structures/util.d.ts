import { CompiledFunction, Context, ForgeClient } from '@tryforge/forgescript';
import { Image } from '@napi-rs/canvas';
import { Frame } from '@gifsx/gifsx';
import { ForgeCanvasError, CanvasBuilder, Spans, ImageManager } from '..';
import { LoaderPolicy, ImageSource } from './loader';
export declare const urlRegex: RegExp;
export declare const fontcssRegex: RegExp;
export declare const emojiRegex: RegExp;
export declare const cacheRegex: RegExp;
export declare const wordRegex: RegExp;
export declare const httpsRegex: RegExp;
export declare const fontRegex: RegExp;
export declare const filterRegex: RegExp;
export declare const rgbaRegex: RegExp;
export declare const hexRegex: RegExp;
export declare const SUPPORTED_FONT_FORMATS: string[];
/**
 * Registers fonts from URLs (a font file or a stylesheet such as Google Fonts), files or folders.
 * Called from JavaScript without a policy, it trusts the bot owner: local paths anywhere (as in
 * ForgeCanvas), with the network limits. $registerFont passes the bot's policy.
 * Fonts named by a downloaded stylesheet are always fetched over http(s), never read from disk.
 */
export declare function registerFonts(fonts: {
    src: string;
    name?: string | null;
}[], log?: boolean, policy?: LoaderPolicy): Promise<void>;
/** The ImageManager of this run, created with the bot's policy when missing. */
export declare function imageManagerOf(ctx: Context): ImageManager;
/**
 * Logs why a load failed (with the detail) and returns a generic error for the user.
 * Refusals say only that the source is not allowed or too large; never the address, path or library text.
 */
export declare function loaderFailure(self: CompiledFunction, err: unknown, generic?: ForgeCanvasError | string, tooLarge?: ForgeCanvasError | string): import("@tryforge/forgescript").Return<import("@tryforge/forgescript").ReturnType.Error>;
/** True when a $drawImage source is meant as a style (colour, gradient://, pattern://) rather than an image. */
export declare function isStyleSource(src: string): boolean;
export declare function validateFont(font: string): string | RegExpExecArray;
export declare function parseFilters(str: string): any[];
export declare function resolveStyle(self: CompiledFunction, ctx: Context, canvas: CanvasBuilder, style: string | undefined | null): Promise<string | import("@napi-rs/canvas").CanvasGradient | import("@napi-rs/canvas").CanvasPattern | import("@tryforge/forgescript").Return<import("@tryforge/forgescript").ReturnType.Error>>;
export declare function resolveImage(self: CompiledFunction, ctx: Context, src: string): Promise<Image | import("@tryforge/forgescript").Return<import("@tryforge/forgescript").ReturnType.Error>>;
export declare function rgbaStringToHex(rgba: string): string;
export declare function resolveFrame(self: CompiledFunction, ctx: Context, frame: string, speed: number | undefined | null): Promise<Frame | import("@tryforge/forgescript").Return<import("@tryforge/forgescript").ReturnType.Error>>;
/** Emoji images come from a URL the extension builds (digits only), so this host is always allowed. */
export declare const EMOJI_HOSTS: readonly ["cdn.discordapp.com"];
export declare function parseText(client: ForgeClient, text: string, parseNL?: boolean | null, parseEmoji?: boolean | null): Promise<Spans>;
export declare function loadFrame(manager: ImageManager | null, src: ImageSource, speed?: number | null): Promise<Frame>;
export declare function parseArgs(str: string, prefix: string | number, length: number, rest?: boolean): string[];
export declare const Colors: Record<string, string>;

/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { CompiledFunction, Context, ForgeClient, Logger } from '@tryforge/forgescript';
import { createCanvas, GlobalFonts, Image, Canvas } from '@napi-rs/canvas';
import { Frame, rgbaToHex, hexToRgba, indexedToRgba } from '@gifsx/gifsx';

import { join, basename } from 'node:path';
import { promises as fsp } from 'node:fs';

import { ForgeCanvasError, CanvasBuilder, Spans, ImageFormat, ImageManager } from '..';
import {
    LoaderError, LoaderPolicy, LOG_PREFIX, OWNER_POLICY, DEFAULT_POLICY, ImageSource,
    describeUrl, fetchBytes, loadImageFrom, policyOf, readLocal, resolveReadPath, sourceKind
} from './loader';

export const urlRegex = /^url\(['"]?|['"]?\)$/g;
export const fontcssRegex = /\/\*\s*(?<subset>[\w-]+)\s*\*\/[\s\S]*?font-family:\s*['"]?(?<family>[^'";]+)['"]?;[\s\S]*?url\((?<url>[^)]+)\)/g;
export const emojiRegex = /<(a?):(\w+):(\d+)>/y;
export const cacheRegex = /^cache_.*/;
export const wordRegex = /\S+\s*|\s+/g;
export const httpsRegex = /https?:\/\//;
export const fontRegex = /^\s*(?=(?:(?:[-a-z]+\s*){0,2}(italic|oblique))?)(?=(?:(?:[-a-z]+\s*){0,2}(small-caps))?)(?=(?:(?:[-a-z]+\s*){0,2}(bold(?:er)?|lighter|[1-9]00))?)(?:(?:normal|\1|\2|\3)\s*){0,3}((?:xx?-)?(?:small|large)|medium|smaller|larger|[.\d]+(?:\%|in|[cem]m|ex|p[ctx]))(?:\s*\/\s*(normal|[.\d]+(?:\%|in|[cem]m|ex|p[ctx])))?\s*([-,\'\sa-z_.0-9]+?)\s*$/i;
export const filterRegex = /([a-zA-Z-]+)\(([^)]+)\)/g;
export const rgbaRegex = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*,\s*(0|1|0?\.\d+))?\s*\)$/;
export const hexRegex = /^#?([0-9A-Fa-f]{3,4}){1,2}$/;

export const SUPPORTED_FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2'];
const FONT_USER_AGENT = 'Mozilla/5.0 () Gecko/20100101 Firefox/147.0';

interface FontState { files: number }

/**
 * Registers fonts from URLs (a font file or a stylesheet such as Google Fonts), files or folders.
 * Called from JavaScript without a policy, it trusts the bot owner: local paths anywhere (as in
 * ForgeCanvas), with the network limits. $registerFont passes the bot's policy.
 * Fonts named by a downloaded stylesheet are always fetched over http(s), never read from disk.
 */
export async function registerFonts(
    fonts: { src: string, name?: string | null }[],
    log?: boolean,
    policy: LoaderPolicy = OWNER_POLICY
) {
    await registerFontList(fonts, log ?? false, policy, 0, { files: 0 }, null);
}

function countFont(policy: LoaderPolicy, state: FontState, src: string) {
    if (++state.files > policy.fonts.maxFiles)
        throw new LoaderError('NOT_ALLOWED', `more than ${policy.fonts.maxFiles} font files in one registration (fonts.maxFiles), at ${describeUrl(src)}`);
}

async function registerFontList(
    fonts: { src: string, name?: string | null }[],
    log: boolean,
    policy: LoaderPolicy,
    depth: number,
    state: FontState,
    base: string | null
): Promise<void> {
    if (depth > policy.fonts.maxDepth)
        throw new LoaderError('NOT_ALLOWED', `fonts nested more than ${policy.fonts.maxDepth} levels (fonts.maxDepth)`);

    for (const font of fonts) {
        let src = font.src.startsWith('url(') ? font.src.replace(urlRegex, '').trim() : font.src.trim();

        // Inside a stylesheet, every url() is resolved against the stylesheet: never a local path.
        if (base) {
            try { src = new URL(src, base).href } catch { throw new LoaderError('FAILED', `invalid font URL in stylesheet ${describeUrl(base)}`) }
            if (sourceKind(src) !== 'http') throw new LoaderError('NOT_ALLOWED', `stylesheet ${describeUrl(base)} names a non-http font`);
        }

        if (sourceKind(src) === 'http') {
            countFont(policy, state, src);
            const { data, contentType, url } = await fetchBytes(src, policy, { headers: { 'User-Agent': FONT_USER_AGENT } });

            if (contentType.startsWith('text/')) {
                const families = [...data.toString('utf8').matchAll(fontcssRegex)].map(match => {
                    // @ts-expect-error
                    const { url: u, subset, family = font.name } = match.groups;
                    return { src: u, name: subset?.length ? `${family}-${subset.trim()}` : family };
                });

                if (!families.length) throw new LoaderError('FAILED', `invalid font CSS: ${font.name ?? describeUrl(src)}`);
                state.files--; // the stylesheet itself is not a font file
                await registerFontList(families, log, policy, depth + 1, state, url);
            } else if (!GlobalFonts.register(data, font.name ?? undefined)) {
                if (log) Logger.warn(`${LOG_PREFIX} Failed to register font: '${font.name ?? describeUrl(src)}'`);
            } else if (log) Logger.info(`${LOG_PREFIX} Registered a font: ${font.name ?? describeUrl(src)}`);
            continue;
        }

        if (sourceKind(src) !== 'path') throw new LoaderError('NOT_ALLOWED', `font source scheme of ${src.slice(0, 40)} is not allowed`);

        let entry: { path: string, size: number, folder: boolean };
        try { entry = await resolveReadPath(src, policy, 'any') } catch (e: any) {
            if (e instanceof LoaderError && e.code === 'FAILED') {
                if (log) throw new Error(`Invalid font source: ${src}`);
                continue;
            }
            throw e;
        }

        if (entry.folder) {
            const children = await fsp.readdir(entry.path);
            await registerFontList(children.map(x => ({ src: join(entry.path, x) })), log, policy, depth + 1, state, null);
            continue;
        }

        let filename = basename(entry.path);
        if (!SUPPORTED_FONT_FORMATS.includes(filename.split('.').pop()!)) continue;

        filename = font.name ?? filename.slice(0, filename.lastIndexOf('.'));
        if (log && GlobalFonts.has(filename))
            Logger.warn(`${LOG_PREFIX} Font with name '${filename}' already exists`);

        if (!filename?.length)
            throw new Error(`Font name cannot be empty: ${src}`);
        if (filename.includes(','))
            throw new Error(`Font name cannot contain commas: ${filename}`);

        countFont(policy, state, src);
        if (!GlobalFonts.register(await readLocal(entry.path, policy), filename)) {
            if (log) Logger.warn(`${LOG_PREFIX} Failed to register font: ${filename} (${src})`);
            continue;
        }
        if (log) Logger.info(`${LOG_PREFIX} Registered a font: ${filename} (${src})`);
    }
}

/** The ImageManager of this run, created with the bot's policy when missing. */
export function imageManagerOf(ctx: Context) {
    if (!(ctx.imageManager instanceof ImageManager))
        ctx.imageManager = new ImageManager(policyOf(ctx.client));
    return ctx.imageManager;
}

/**
 * Logs why a load failed (with the detail) and returns a generic error for the user.
 * Refusals say only that the source is not allowed or too large; never the address, path or library text.
 */
export function loaderFailure(self: CompiledFunction, err: unknown, generic: ForgeCanvasError | string = ForgeCanvasError.ImageFail) {
    const code = err instanceof LoaderError ? err.code : 'FAILED';
    const detail = err instanceof Error ? err.message : String(err);
    Logger.warn(`${LOG_PREFIX} ${self?.data?.name ?? 'load'}: ${code} ${detail}`);
    return self.customError(
        code === 'NOT_ALLOWED' ? ForgeCanvasError.SourceNotAllowed
            : code === 'TOO_LARGE' ? ForgeCanvasError.SourceTooLarge
                : generic
    );
}

/** True when a $drawImage source is meant as a style (colour, gradient://, pattern://) rather than an image. */
export function isStyleSource(src: string) {
    return /^(gradient|pattern):\/\//.test(src) || hexRegex.test(src) || rgbaRegex.test(src) || Object.hasOwn(Colors, src);
}

export function validateFont(font: string) {
    const match = fontRegex.exec(font);
    if (!match?.[0]) return ForgeCanvasError.InvalidFontFormat;

    const families = match[6].split(',').map(x => x?.trim());
    for (const family of families)
        if (!GlobalFonts.has(family.replace(/['',]/g, '')))
            return `${ForgeCanvasError.InvalidFont} (${family})`;
    return match;
}

export function parseFilters(str: string) {
    const result = new Array(1);

    let match: RegExpExecArray | null;
    while ((match = filterRegex.exec(str)) !== null) {
        const [raw, filter, value] = match;
        result.push({ filter, value, raw });
    }

    return result;
}

export async function resolveStyle(self: CompiledFunction, ctx: Context, canvas: CanvasBuilder, style: string | undefined | null) {
    if (!style) return '#0';
    const s = style.split('://');
    const args = style.slice(style.indexOf('://') + 3);

    if (s[0] === 'gradient') {
        const gradient = ctx.gradientManager?.get(args);
        if (!gradient) return self.customError(ForgeCanvasError.NoGradient);
        return gradient;
    }

    if (s[0] === 'pattern') {
        const splits = args.split(':'),
            type = splits.shift()?.toLowerCase();
        let x: number | undefined, y: number | undefined;

        if (splits.length > 2) {
            const l = splits.length;
            const xa = parseFloat(splits[l - 2]);
            const ya = parseFloat(splits[l - 1]);
            if (!Number.isNaN(xa) && !Number.isNaN(ya)) {
                x = xa;
                y = ya;
                splits.pop();
                splits.pop();
            }
        }

        const repeat = splits.length && [
            'repeat', 'repeat-x',
            'repeat-y', 'no-repeat'
        ].includes(splits[splits.length - 1])
            ? splits.pop() : null;

        let image: Image | ImageData | Canvas;

        if (type === 'canvas') {
            const canvas_2 = ctx.canvasManager?.get(repeat ? splits.join(':') : splits.join());
            if (!canvas_2) return self.customError(ForgeCanvasError.NoCanvas);

            image = canvas_2.ctx.canvas;
        } else if (type === 'images' && splits[0]?.startsWith('//')) {
            const source = splits.join(':').slice(2);
            const meow = source.startsWith('preload://');
            const img = (meow ? ctx.client.preloadImages : ctx.imageManager)
                ?.get(meow ? source.slice(10) : source);

            if (!img) return self.customError(ForgeCanvasError.NoImage);

            image = img;
        } else {
            const src = repeat ? splits.join(':') : `${type}:${splits.join(':')}`;
            const manager = imageManagerOf(ctx);
            try {
                image = await loadImageFrom(
                    src, manager.policy,
                    ctx.imageManager?.loadOptions ?? ctx.client.preloadImages?.loadOptions
                );
            } catch (e) { return loaderFailure(self, e) }

            manager.cache(src, image);
        }

        const pattern = canvas.ctx.createPattern(image, repeat as any);
        if (!pattern) return self.customError(ForgeCanvasError.ImageFail);
        if (x !== undefined && y !== undefined)
            pattern.setTransform(new DOMMatrix().translate(x, y));
        return pattern;
    }

    return (
        hexRegex.test(style) ? style :
            rgbaRegex.test(style) ? rgbaStringToHex(style) :
                Colors[style]
    ) ?? '#0';
}

export async function resolveImage(self: CompiledFunction, ctx: Context, src: string) {
    const splitted = src.split('//');
    const protocol = splitted[0].slice(0, -1);

    let img: ImageSource = src;
    switch (protocol) {
        case 'rgba':
        case 'rgb':
        case 'hex': {
            const [size, data] = parseArgs(src, splitted[0].length + 2, 2);
            const [width, height] = size.split('x').map(Number);

            const canvas = createCanvas(width, height);
            const context = canvas.getContext('2d');
            const imageData = context.createImageData(width, height);

            imageData.data.set(new Uint8ClampedArray(
                protocol === 'hex'
                    ? hexToRgba(data.split(',').map(x => x.trim()))
                    : protocol === 'rgb'
                        ? data.split(',').map(Number).flatMap((v, i) => {
                            if ((i + 1) % 3 === 0)
                                return [v, 255];
                            return [v];
                        })
                        : data.split(',').map(Number)
            ));

            context.putImageData(imageData, 0, 0);
            img = canvas.toBuffer('image/png');
            break;
        }
        case 'frame': {
            const frame = ctx.gifManager?.getFrame(src.slice(8));
            if (!frame) return self.customError(ForgeCanvasError.NoFrame);

            const { width, height, buffer } = frame;

            const canvas = createCanvas(width, height);
            const context = canvas.getContext('2d');
            const imageData = context.createImageData(width, height);

            imageData.data.set(
                buffer.length === width * height * 4
                    ? buffer : indexedToRgba(
                        Uint8Array.from(buffer),
                        new Uint8Array(frame.palette ?? []),
                        frame.transparent
                    )
            );
            context.putImageData(imageData, 0, 0);

            img = await canvas.encode('png');
            break;
        }
        case 'preload': {
            const image = ctx.client.preloadImages?.get(splitted.slice(1).join('//'));
            if (!image) return self.customError(ForgeCanvasError.NoImage);

            img = image;
            break;
        }
        case 'images': {
            const image = ctx.imageManager?.get(splitted.slice(1).join('//'));
            if (!image) return self.customError(ForgeCanvasError.NoImage);

            img = image;
            break;
        }
        case 'canvas': {
            const canvas = ctx.canvasManager?.get(splitted.slice(1).join('//'));
            if (!canvas) return self.customError(ForgeCanvasError.NoCanvas);

            img = await canvas.encode(ImageFormat.png);
            break;
        }
        default: if (src?.includes('<svg'))
            img = `data:image/svg+xml;base64,${Buffer.from(src)?.toString('base64')}`;
    }

    try {
        return await loadImageFrom(
            img, policyOf(ctx.client),
            ctx.imageManager?.loadOptions ?? ctx.client.preloadImages?.loadOptions
        );
    } catch (e) { return loaderFailure(self, e) }
}

export function rgbaStringToHex(rgba: string) {
    const match = rgba.match(rgbaRegex)!;
    return rgbaToHex(Uint8Array.from([
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10),
        match[5] ? Number.parseFloat(match[5]) : 255
    ]), false, true)[0];
}

export async function resolveFrame(self: CompiledFunction, ctx: Context, frame: string, speed: number | undefined | null) {
    switch (frame.substring(0, frame.indexOf(':'))) {
        case 'rgba': {
            const [size, data] = parseArgs(frame, 'rgba://', 2);
            const [width, height] = size.split('x').map(Number);
            return Frame.fromRgba(
                width, height,
                Uint8Array.from(data.split(',').map(Number)),
                speed
            );
        }

        case 'hex': {
            const [size, data] = parseArgs(frame, 'hex://', 2);
            const [width, height] = size.split('x').map(Number);
            return Frame.fromHex(
                width, height,
                data.split(',').map(x => x.trim()),
                speed
            );
        }

        case 'rgb': {
            const [size, data] = parseArgs(frame, 'rgb://', 2);
            const [width, height] = size.split('x').map(Number);
            return Frame.fromRgb(
                width, height,
                Uint8Array.from(data.split(',').map(Number)),
                speed
            );
        }

        case 'indexed': {
            const [size, data] = parseArgs(frame, 'indexed://', 2);
            const [width, height] = size.split('x').map(Number);
            return Frame.fromIndexedPixels(
                width, height,
                Uint8Array.from(data.split(',').map(Number))
            );
        }

        case 'images': {
            const source = frame.slice(9);
            const meow = frame.startsWith('preload://');
            const img = (meow ? ctx.client.preloadImages : ctx.imageManager)
                ?.get(meow ? source.slice(10) : source);

            if (!img) return self.customError(ForgeCanvasError.NoImage);
            return await loadFrame(imageManagerOf(ctx), img, speed);
        }

        case 'canvas': {
            const canvas = ctx.canvasManager?.get(frame.slice(9));
            if (!canvas) return self.customError(ForgeCanvasError.NoCanvas);
            return Frame.fromRgba(
                canvas.width, canvas.height,
                Uint8Array.from(canvas.inner.data()),
                speed
            );
        }

        default: try {
            return await loadFrame(imageManagerOf(ctx), frame, speed);
        } catch (e) { return loaderFailure(self, e, ForgeCanvasError.FrameFail) }
    }
}

/** Emoji images come from a URL the extension builds (digits only), so this host is always allowed. */
export const EMOJI_HOSTS = ['cdn.discordapp.com'] as const;

export async function parseText(client: ForgeClient, text: string, parseNL?: boolean | null, parseEmoji?: boolean | null): Promise<Spans> {
    if (!text?.trim()?.length) return [];
    if (!parseNL && !parseEmoji) return [text];

    const spans = new Array(0);
    const regex = new RegExp(emojiRegex.source, 'y');

    let cur = '';

    let sI = 0;
    let i = 0;
    while (i < text.length) {
        const c = text[i];

        if (c === '\\') {
            cur += text.slice(sI, i);
            
            i++;
            sI = i;
            i++;
            continue;
        } else if (parseNL && c === '\n') {
            cur += text.slice(sI, i);
            if (cur.length) spans.push(cur);

            spans.push(null);
            cur = '';
            i++;
            sI = i;
            continue;
        } else if (parseEmoji && c === '<') {
            regex.lastIndex = i;
            const match = regex.exec(text);

            if (match) {
                cur += text.slice(sI, i);
                const id = match[3];

                if (cur.length) spans.push(cur);

                spans.push(client.preloadImages.tryGet(
                    `cache_emoji_${id}`,
                    `https://cdn.discordapp.com/emojis/${id}.png`,
                    { extraHosts: EMOJI_HOSTS }
                ));
                cur = '';

                i += match[0].length;
                sI = i;

                continue;
            }
        }
        i++;
    }

    cur = text.slice(sI, i);
    if (cur.length) spans.push(cur);

    return Promise.all(spans);
}

export async function loadFrame(
    manager: ImageManager | null,
    src: ImageSource,
    speed?: number | null
) {
    const img = manager ? await manager.load(src)
        : await loadImageFrom(src, DEFAULT_POLICY);

    const canvas = createCanvas(img.width, img.height);

    canvas.getContext('2d').drawImage(img, 0, 0);
    return Frame.fromRgba(
        canvas.width, canvas.height,
        Uint8Array.from(canvas.data()),
        speed
    );
}

export function parseArgs(str: string, prefix: string | number, length: number, rest?: boolean) {
    const args = str.slice(typeof prefix === 'string' ? prefix.length : prefix).split(':');
    if (!rest ? args.length !== length : args.length < length)
        throw new Error(`${prefix} expects ${length} arguments`);

    return args;
}

export const Colors: Record<string, string> = {
    White: '#ffffff',
    Aqua: '#1abc9c',
    Green: '#57f287',
    Blue: '#3498db',
    Yellow: '#fee75c',
    Purple: '#9b59b6',
    LuminousVividPink: '#e91e63',
    Fuchsia: '#eb459e',
    Gold: '#f1c40f',
    Orange: '#e67e22',
    Red: '#ed4245',
    RubberDuck: '#FFD700',
    Grey: '#95a5a6',
    Navy: '#34495e',
    DarkAqua: '#11806a',
    DarkGreen: '#1f8b4c',
    DarkBlue: '#206694',
    DarkPurple: '#71368a',
    DarkVividPink: '#ad1457',
    DarkGold: '#c27c0e',
    DarkOrange: '#a84300',
    DarkRed: '#992d22',
    DarkGrey: '#979c9f',
    DarkerGrey: '#7f8c8d',
    LightGrey: '#bcc0c0',
    DarkNavy: '#2c3e50',
    Blurple: '#5865f2',
    Greyple: '#99aab5',
    DarkButNotBlack: '#2c2f33',
    NotQuiteBlack: '#23272a'
};
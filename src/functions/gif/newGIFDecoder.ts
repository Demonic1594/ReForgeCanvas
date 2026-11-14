/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { ArgType, NativeFunction } from '@tryforge/forgescript';
import { Decoder } from '@gifsx/gifsx';

import { ForgeCanvasError, GIFManager, LoaderError, imageDimensions, loaderFailure, loadSource, policyOf } from '../..';

export default new NativeFunction({
    name: '$newGIFDecoder',
    aliases: ['$createGIFDecoder', '$createDecoder', '$GIFDecoder', '$newDecoder'],
    description: 'Creates a new GIF Decoder',
    version: '1.2.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'gif',
            description: 'Name of the new GIF Decoder',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'path',
            description: 'URL or path of the GIF file (local paths only inside files.read), or encoder://name',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'options',
            description: 'Options for the GIF Decoder',
            type: ArgType.String,
            required: false,
            rest: false
        }
    ],
    async execute (ctx, [name, path, options]) {
        const manager = ctx.gifManager instanceof GIFManager ?
            ctx.gifManager : ctx.gifManager = new GIFManager();

        let gif: Uint8Array | Buffer;
        if (path.startsWith('encoder://')) {
            const encoder = manager.getEncoder(path.slice(10));
            if (!encoder) return this.customError(ForgeCanvasError.NoEncoder);

            gif = encoder.getBuffer();
        } else try {
            const data = await loadSource(path, policyOf(ctx.client));
            if (typeof data === 'string') return this.customError(ForgeCanvasError.GIFFail); // data: URLs were never supported here
            gif = data;
        } catch (e) { return loaderFailure(this, e, ForgeCanvasError.GIFFail) }

        try {
            const size = imageDimensions(Buffer.from(gif.buffer, gif.byteOffset, gif.byteLength));
            const max = policyOf(ctx.client).limits.maxImagePixels;
            if (size && size.width * size.height > max)
                throw new LoaderError('TOO_LARGE', `the GIF is ${size.width}x${size.height}, over limits.maxImagePixels ${max}`);
            manager.setDecoder(
                name,
                new Decoder(
                    new Uint8Array(gif),
                    options ? manager.getDecodeOptions(options) : undefined
                )
            );
        } catch (e) { return loaderFailure(this, e, ForgeCanvasError.GIFFail) }
        return this.success();
    }
});

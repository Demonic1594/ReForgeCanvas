"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const gifsx_1 = require("@gifsx/gifsx");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
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
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'path',
            description: 'URL or path of the GIF file (local paths only inside files.read), or encoder://name',
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'options',
            description: 'Options for the GIF Decoder',
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        }
    ],
    async execute(ctx, [name, path, options]) {
        const manager = ctx.gifManager instanceof __1.GIFManager ?
            ctx.gifManager : ctx.gifManager = new __1.GIFManager();
        let gif;
        if (path.startsWith('encoder://')) {
            const encoder = manager.getEncoder(path.slice(10));
            if (!encoder)
                return this.customError("No GIF encoder with provided name found" /* ReForgeCanvasError.NoEncoder */);
            gif = encoder.getBuffer();
        }
        else
            try {
                const data = await (0, __1.loadSource)(path, (0, __1.policyOf)(ctx.client));
                if (typeof data === 'string')
                    return this.customError("Failed to load the GIF" /* ReForgeCanvasError.GIFFail */); // data: URLs were never supported here
                gif = data;
            }
            catch (e) {
                return (0, __1.loaderFailure)(this, e, "Failed to load the GIF" /* ReForgeCanvasError.GIFFail */);
            }
        try {
            const size = (0, __1.imageDimensions)(Buffer.from(gif.buffer, gif.byteOffset, gif.byteLength));
            const max = (0, __1.policyOf)(ctx.client).limits.maxImagePixels;
            if (size && size.width * size.height > max)
                throw new __1.LoaderError('TOO_LARGE', `the GIF is ${size.width}x${size.height}, over limits.maxImagePixels ${max}`);
            manager.setDecoder(name, new gifsx_1.Decoder(new Uint8Array(gif), options ? manager.getDecodeOptions(options) : undefined));
        }
        catch (e) {
            return (0, __1.loaderFailure)(this, e, "Failed to load the GIF" /* ReForgeCanvasError.GIFFail */);
        }
        return this.success();
    }
});

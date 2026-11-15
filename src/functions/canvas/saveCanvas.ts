/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { loadImage } from '@napi-rs/canvas';

import { imageManagerOf, ImageFormat, ReForgeCanvasError, loaderFailure, policyOf, writeLocal } from '../..';

export default new NativeFunction({
    name: '$saveCanvas',
    aliases: ['$downloadCanvas', '$canvasSave', '$canvasDownload'],
    description: 'Saves a canvas to a file',
    version: '1.1.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'canvas',
            description: 'Name of the canvas',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'path',
            description: 'Path of the file to write (inside the extension\'s files.write folder), or images://name',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'format',
            description: 'The image format',
            type: ArgType.Enum,
            enum: ImageFormat,
            required: false,
            rest: false
        }
    ],
    async execute (ctx, [name, path, f]) {
        const canvas = ctx.canvasManager?.getOrCurrent(name);
        
        if (!canvas) return this.customError(ReForgeCanvasError.NoCanvas);
        if (!path) return this.customError(ReForgeCanvasError.NoPath);

        // CanvasBuilder.encode takes the format name ('png'), not a MIME type ('image/png' threw in 1.3.1)
        const format: any = (typeof f === 'number' ? ImageFormat[f] : f) ?? 'png';

        if (path.startsWith('images://')) {
            imageManagerOf(ctx).set(
                path.slice(9),
                await loadImage(await canvas.encode(format))
            );
        } else try {
            await writeLocal(path, await canvas.encode(format), policyOf(ctx.client));
        } catch (e) { return loaderFailure(this, e, ReForgeCanvasError.WriteFail) }
        return this.success();
    }
});

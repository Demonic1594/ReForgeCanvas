/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { ForgeCanvasError, loaderFailure, policyOf, writeLocal } from '../..';

export default new NativeFunction({
    name: '$saveEncoder',
    aliases: [
        '$downloadEncoder',
        '$downloadGIF',
        '$saveGIF',
        '$encoderSave',
        '$encoderDownload',
        '$gifDownload',
        '$gifSave'
    ],
    description: 'Saves an Encoder GIF to a file',
    version: '1.1.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'gif',
            description: 'Name of the Encoder',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'path',
            description: 'Path of the file to write (inside the extension\'s files.write folder)',
            type: ArgType.String,
            required: true,
            rest: false
        }
    ],
    async execute (ctx, [name, path]) {
        const gif = ctx.gifManager?.getEncoderOrCurrent(name);

        if (!gif) return this.customError(ForgeCanvasError.NoEncoder);
        if (!path) return this.customError(ForgeCanvasError.NoPath);

        try {
            await writeLocal(path, gif.getBuffer(), policyOf(ctx.client));
        } catch (e) { return loaderFailure(this, e, ForgeCanvasError.WriteFail) }
        return this.success();
    }
});
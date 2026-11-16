/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { ArgType, NativeFunction } from '@tryforge/forgescript';
import { DecodeOptions } from '@gifsx/gifsx';

import { GIFManager, ColorOutput, ReForgeCanvasError } from '../..';

export default new NativeFunction({
    name: '$setColorOutput',
    aliases: ['$setOutputColor'],
    description: 'Configure the color output for the GIF Decoder',
    version: '1.2.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'name',
            description: 'Name of the Decode Options',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'output',
            description: 'The color output type',
            type: ArgType.Enum,
            enum: ColorOutput,
            required: true,
            rest: false
        }
    ],
    execute (ctx, [name, output]) {
        const manager = ctx.gifManager instanceof GIFManager ?
            ctx.gifManager : ctx.gifManager = new GIFManager();
        if (!name && !manager.currentOptions)
            manager.currentOptions = new DecodeOptions();

        const options = name
            ? manager.getDecodeOptions(name)
            : manager.currentOptions;
        if (!options) return this.customError(ReForgeCanvasError.NoDecodeOptions);

        // ForgeScript passes a numeric enum by name ("Rgba" for 0), and @gifsx/gifsx needs the number. Its decoder
        // only knows Rgba and IndexedPixels: Hex (in the enum since ForgeCanvas) is refused with a normal error.
        const value = typeof output === 'number' ? output : (ColorOutput as unknown as Record<string, number>)[String(output)];
        try { options.setColorOutput(value as unknown as import('@gifsx/gifsx').ColorOutput) }
        catch { return this.customError(ReForgeCanvasError.InvalidColorOutput) }
        return this.success();
    }
});
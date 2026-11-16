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
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'output',
            description: 'The color output type',
            type: forgescript_1.ArgType.Enum,
            enum: __1.ColorOutput,
            required: true,
            rest: false
        }
    ],
    execute(ctx, [name, output]) {
        const manager = ctx.gifManager instanceof __1.GIFManager ?
            ctx.gifManager : ctx.gifManager = new __1.GIFManager();
        if (!name && !manager.currentOptions)
            manager.currentOptions = new gifsx_1.DecodeOptions();
        const options = name
            ? manager.getDecodeOptions(name)
            : manager.currentOptions;
        if (!options)
            return this.customError("No decode options with provided name found" /* ReForgeCanvasError.NoDecodeOptions */);
        // ForgeScript passes a numeric enum by name ("Rgba" for 0), and @gifsx/gifsx needs the number. Its decoder
        // only knows Rgba and IndexedPixels: Hex (in the enum since ForgeCanvas) is refused with a normal error.
        const value = typeof output === 'number' ? output : __1.ColorOutput[String(output)];
        try {
            options.setColorOutput(value);
        }
        catch {
            return this.customError("GIF decoding supports the color outputs Rgba and IndexedPixels" /* ReForgeCanvasError.InvalidColorOutput */);
        }
        return this.success();
    }
});

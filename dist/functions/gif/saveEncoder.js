"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
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
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'path',
            description: 'Path of the file to write (inside the extension\'s files.write folder)',
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        }
    ],
    async execute(ctx, [name, path]) {
        const gif = ctx.gifManager?.getEncoderOrCurrent(name);
        if (!gif)
            return this.customError("No GIF encoder with provided name found" /* ForgeCanvasError.NoEncoder */);
        if (!path)
            return this.customError("No path provided" /* ForgeCanvasError.NoPath */);
        try {
            await (0, __1.writeLocal)(path, gif.getBuffer(), (0, __1.policyOf)(ctx.client));
        }
        catch (e) {
            return (0, __1.loaderFailure)(this, e, "Failed to save the file" /* ForgeCanvasError.WriteFail */);
        }
        return this.success();
    }
});

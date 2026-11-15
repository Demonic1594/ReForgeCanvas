"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const canvas_1 = require("@napi-rs/canvas");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
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
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'path',
            description: 'Path of the file to write (inside the extension\'s files.write folder), or images://name',
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'format',
            description: 'The image format',
            type: forgescript_1.ArgType.Enum,
            enum: __1.ImageFormat,
            required: false,
            rest: false
        }
    ],
    async execute(ctx, [name, path, f]) {
        const canvas = ctx.canvasManager?.getOrCurrent(name);
        if (!canvas)
            return this.customError("No canvas with provided name found" /* ReForgeCanvasError.NoCanvas */);
        if (!path)
            return this.customError("No path provided" /* ReForgeCanvasError.NoPath */);
        // CanvasBuilder.encode takes the format name ('png'), not a MIME type ('image/png' threw in 1.3.1)
        const format = (typeof f === 'number' ? __1.ImageFormat[f] : f) ?? 'png';
        if (path.startsWith('images://')) {
            (0, __1.imageManagerOf)(ctx).set(path.slice(9), await (0, canvas_1.loadImage)(await canvas.encode(format)));
        }
        else
            try {
                await (0, __1.writeLocal)(path, await canvas.encode(format), (0, __1.policyOf)(ctx.client));
            }
            catch (e) {
                return (0, __1.loaderFailure)(this, e, "Failed to save the file" /* ReForgeCanvasError.WriteFail */);
            }
        return this.success();
    }
});

"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
    name: '$resizeCanvas',
    aliases: ['$canvasResize'],
    description: 'Resizes a canvas',
    version: '1.0.0',
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
            name: 'width',
            description: 'The new canvas width',
            type: forgescript_1.ArgType.Number,
            required: true,
            rest: false
        },
        {
            name: 'height',
            description: 'The new canvas height',
            type: forgescript_1.ArgType.Number,
            required: true,
            rest: false
        },
    ],
    execute(ctx, [name, w, h]) {
        const canvas = ctx.canvasManager?.getOrCurrent(name);
        if (!canvas)
            return this.customError("No canvas with provided name found" /* ReForgeCanvasError.NoCanvas */);
        try {
            (0, __1.checkCanvasSize)(w, h, (0, __1.policyOf)(ctx.client));
        }
        catch (e) {
            return (0, __1.loaderFailure)(this, e, "This canvas is too large" /* ReForgeCanvasError.CanvasTooLarge */, "This canvas is too large" /* ReForgeCanvasError.CanvasTooLarge */);
        }
        canvas.resize(w, h);
        return this.success();
    }
});

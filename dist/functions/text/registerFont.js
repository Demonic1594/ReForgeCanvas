"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
    name: '$registerFont',
    aliases: ['$registerFonts'],
    description: 'Registers a font',
    version: '1.0.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'src',
            description: 'The font source: a URL (font file or stylesheet), or a path inside files.read',
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'name',
            description: 'The font name',
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'log',
            description: 'Whether to log the registration',
            type: forgescript_1.ArgType.Boolean,
            required: false,
            rest: false
        }
    ],
    async execute(ctx, [src, name, log]) {
        try {
            return this.success(await (0, __1.registerFonts)([{ src: src, name }], log ?? false, (0, __1.policyOf)(ctx.client)));
        }
        catch (e) {
            if (e instanceof __1.LoaderError)
                return (0, __1.loaderFailure)(this, e, "Failed to register the font" /* ReForgeCanvasError.FontFail */);
            return this.customError(e?.message ?? String(e));
        }
    }
});

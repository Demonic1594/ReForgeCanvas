/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { ForgeCanvasError, LoaderError, loaderFailure, policyOf, registerFonts } from '../..';

export default new NativeFunction({
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
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'name',
            description: 'The font name',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'log',
            description: 'Whether to log the registration',
            type: ArgType.Boolean,
            required: false,
            rest: false
        }
    ],
    async execute (ctx, [src, name, log]) {
        try {
            return this.success(await registerFonts(
                [{ src: src, name }],
                log ?? false,
                policyOf(ctx.client)
            ));
        } catch(e: any) {
            if (e instanceof LoaderError) return loaderFailure(this, e, ForgeCanvasError.FontFail);
            return this.customError(e?.message ?? String(e));
        }
    }
});
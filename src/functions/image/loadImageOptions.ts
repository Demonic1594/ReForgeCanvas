/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { LoadImageOptions } from '@napi-rs/canvas';

import { imageManagerOf } from '../..';

export default new NativeFunction({
    name: '$loadImageOptions',
    aliases: [],
    description: 'Sets or returns the current load image options; Applies to $drawImage and other',
    version: '1.3.0',
    brackets: false,
    unwrap: true,
    args: [
        {
            name: 'global',
            description: 'If true, touches global Image Manager instead',
            type: ArgType.Boolean,
            required: false,
            rest: false
        },
        {
            name: 'alt',
            description: 'Sets the alt text of the next images',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'maxRedirects',
            description: 'Lowers the number of redirects followed while fetching; Cannot go above the extension\'s network.maxRedirects (5 by default)',
            type: ArgType.Number,
            required: false,
            rest: false
        },
        {
            name: 'requestOptions',
            description: 'Sets the loader\'s fetch options; Only headers are used',
            type: ArgType.Json,
            required: false,
            rest: false
        }
    ],
    async execute (ctx, [g, alt, max, opts]) {
        const manager = !g ? imageManagerOf(ctx) : ctx.client.preloadImages;

        if (!alt && !max && !opts) return this.successJSON(manager.loadOptions ?? {});

        const options: LoadImageOptions = {};

        if (alt?.trim().length) options.alt = alt;
        if (typeof max === 'number')
            options.maxRedirects = max;
        if (Object.keys(opts ?? {}).length)
            options.requestOptions = opts as any;

        if (Object.keys(options).length)
            manager.loadOptions = options;
        else delete manager.loadOptions;

        return this.success();
    }
});

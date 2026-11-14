/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { indexedToHex } from '@gifsx/gifsx';
import { indexedProblem } from '../..';

export default new NativeFunction({
    name: '$indexedToHex',
    description: 'Converts indexed pixels to HEX',
    version: '1.2.1',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'palette',
            description: 'The palette to use for the conversion',
            type: ArgType.Json,
            required: true,
            rest: false
        },
        {
            name: 'transparent',
            description: 'The index of the transparent color in the palette',
            type: ArgType.Number,
            required: false,
            rest: false
        },
        {
            name: 'alwaysAlpha',
            description: 'Determines whether to always include the alpha channel in the output (default: false)',
            type: ArgType.Boolean,
            required: false,
            rest: false
        },
        {
            name: 'allowShort',
            description: 'Whether to allow short hex output (default: false)',
            type: ArgType.Boolean,
            required: false,
            rest: false
        },
        {
            name: 'pixels',
            description: 'The pixels to convert into HEX',
            type: ArgType.Number,
            check: (x: number) => x >= 0 && x <= 255,
            required: true,
            rest: true
        }
    ],
    execute (_, [palette, transparent, aua, a_s, pixels]) {
        const px = Uint8Array.from(pixels);
        const pal = Array.isArray(palette) ? Uint8Array.from(palette as number[]) : null;
        const problem = indexedProblem(px, pal);
        if (problem) return this.customError(problem);
        try {
            const res = indexedToHex(
                px, pal!,
                typeof transparent === 'number' && !Number.isNaN(transparent) ? transparent : undefined, aua === true,
                a_s === true
            );
            return this.success(`[${res.map(x => `"${x}"`).join(', ')}]`);
        } catch(e) {
            return this.customError((e as any).toString());
        }
    }
});
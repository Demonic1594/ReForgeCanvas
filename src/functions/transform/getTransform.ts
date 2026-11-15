/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { ReForgeCanvasError } from '../..';

export default new NativeFunction({
    name: '$getTransform',
    description: 'Returns the current transformation matrix',
    version: '1.0.0',
    brackets: false,
    unwrap: true,
    args: [
        {
            name: 'canvas',
            description: 'Name of the canvas',
            type: ArgType.String,
            required: false,
            rest: false
        }
    ],
    execute (ctx, [name]) {
        const canvas = ctx.canvasManager?.getOrCurrent(name);
        if (!canvas) return this.customError(ReForgeCanvasError.NoCanvas);

        const { a,b,c,d,e,f } = canvas.ctx.getTransform();
        return this.success(JSON.stringify([a,b,c,d,e,f]));
    }
});
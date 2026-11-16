/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType, Return } from '@tryforge/forgescript';
import { DisposalMethod } from '@gifsx/gifsx';

import { ReForgeCanvasError, countGifFrame, loaderFailure, policyOf, resolveFrame } from '../..';

export default new NativeFunction({
    name: '$addFrame',
    description: 'Adds a frame to the GIF',
    version: '1.2.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'gif',
            description: 'Name of the GIF',
            type: ArgType.String,
            required: false,
            rest: false
        },
        {
            name: 'frame',
            description: 'Frame source',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'options',
            description: 'Frame options',
            type: ArgType.Json,
            required: false,
            rest: false
        },
        {
            name: 'speed',
            description: 'Frame rgb quantization speed',
            type: ArgType.Number,
            check: (x: number) => x >= 1 && x <= 30,
            required: false,
            rest: false
        }
    ],
    async execute (ctx, [name, frame, options, speed]) {
        const gif = ctx.gifManager?.getEncoderOrCurrent(name);
        if (!gif) return this.customError(ReForgeCanvasError.NoEncoder);

        const f = await resolveFrame(this, ctx, frame, speed);
        if (f instanceof Return) return f;

        try {
            if (options) {
                if (typeof options.delay === 'number') f.delay = options.delay;

                // @ts-expect-error
                if (options.dispose && DisposalMethod[options.dispose])
                    f.dispose = options.dispose as DisposalMethod;

                if (typeof options.transparent === 'number')
                    f.transparent = options.transparent;

                if (typeof options.needsUserInput === 'boolean')
                    f.needsUserInput = options.needsUserInput;

                if (typeof options.top === 'number')
                    f.top = options.top;
                if (typeof options.left === 'number')
                    f.left = options.left;

                if (typeof options.interlaced === 'boolean')
                    f.interlaced = options.interlaced;

                if (Array.isArray(options.palette))
                    f.setPalette(Uint8Array.from(options.palette));
            }
        } catch (e) { return loaderFailure(this, e, ReForgeCanvasError.FrameRejected) }

        try { countGifFrame(gif, f.width * f.height, policyOf(ctx.client)) } catch (e) { return loaderFailure(this, e, ReForgeCanvasError.GIFTooLarge, ReForgeCanvasError.GIFTooLarge) }
        // the encoder checks the frame against the GIF (same size, a palette for indexed frames)
        try { gif.addFrame(f) } catch (e) { return loaderFailure(this, e, ReForgeCanvasError.FrameRejected) }
        return this.success();
    }
});

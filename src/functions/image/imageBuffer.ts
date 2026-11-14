/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { Image } from '@napi-rs/canvas';

import { ForgeCanvasError, imageManagerOf, loaderFailure } from '../..';

export default new NativeFunction({
    name: '$imageBuffer',
    description: 'Stores the image\'s buffer which can be accessed with $env',
    version: '1.2.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'variable name',
            description: 'The variable to load it to, accessed with $env[name]',
            type: ArgType.String,
            required: true,
            rest: false,
            version: '1.3.0'
        },
        {
            name: 'path',
            description: 'The image path',
            type: ArgType.String,
            required: true,
            rest: false
        }
    ],
    async execute (ctx, [vname, path]) {
        let image: Image | undefined

        if (path.startsWith('images://')) {
            path = path.slice(9);

            let manager = ctx.imageManager;
            if (path.startsWith('preload://')) {
                path = path.slice(10);
                manager = ctx.client.preloadImages;
            }

            image = manager?.get(path);
        } else if (path.startsWith('preload://'))
            image = ctx.client.preloadImages.get(path.slice(10));
        else try {
            image = await imageManagerOf(ctx).load(path);
        } catch (e) { return loaderFailure(this, e) }
        if (!image) return this.customError(ForgeCanvasError.NoImage);

        ctx.setEnvironmentKey(vname, Buffer.from(image.src));
        return this.success();
    }
});

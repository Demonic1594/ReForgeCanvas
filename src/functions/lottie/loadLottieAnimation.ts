/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { NativeFunction, ArgType } from '@tryforge/forgescript';
import { LottieAnimation } from '@napi-rs/canvas';

import { resolve as resolvePath } from 'node:path';

import { ReForgeCanvasError, LoaderError, LottieManager, assertReadablePath, loaderFailure, policyOf, readLocal, resolveReadPath } from '../..';

export default new NativeFunction({
    name: '$loadLottieAnimation',
    aliases: ['$loadLottie', '$lottie', '$lottieAnimation'],
    description: 'Loads a lottie animation from a JSON text or a file path (inside files.read)',
    version: '1.3.0',
    brackets: true,
    unwrap: true,
    args: [
        {
            name: 'lottie',
            description: 'Name of the lottie animation to load',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'data',
            description: 'Data of the lottie animation to load',
            type: ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'resourcePath',
            description: 'Base folder for external resources (images, fonts); must be inside files.read',
            type: ArgType.String,
            required: false,
            rest: false
        }
    ],
    async execute(ctx, [name, data, resourcePath]) {
        if (!(ctx.lottieManager instanceof LottieManager))
            ctx.lottieManager = new LottieManager();

        const policy = policyOf(ctx.client);
        let animation: LottieAnimation;
        try {
            // JSON text is used as is; anything else is a local path under files.read.
            const d = data.trimStart().startsWith('{') ? data : await readLocal(data, policy);

            let base: string | undefined;
            if (resourcePath) {
                base = (await resolveReadPath(resourcePath, policy, 'folder')).path;
                checkExternalAssets(d, base, policy);
            }

            animation = LottieAnimation.loadFromData(d, base ? { resourcePath: base } : undefined);
        } catch (e) { return loaderFailure(this, e, ReForgeCanvasError.LottieFail) }

        ctx.lottieManager.set(name, animation);
        return this.success();
    }
});


/**
 * With a resourcePath, Skia resolves image assets as resourcePath + u + p, and "../" in them
 * leaves the folder. Every external asset must stay inside files.read.
 */
function checkExternalAssets(data: string | Buffer, base: string, policy: ReturnType<typeof policyOf>) {
    let json: any;
    try { json = JSON.parse(data.toString()) } catch { throw new LoaderError('FAILED', 'Lottie data is not valid JSON') }

    const paths: string[] = [];
    for (const asset of Array.isArray(json?.assets) ? json.assets : []) {
        if (typeof asset?.p !== 'string' || asset.e === 1 || /^data:/i.test(asset.p)) continue;
        paths.push(resolvePath(base, typeof asset.u === 'string' ? asset.u : '', asset.p));
    }
    for (const font of Array.isArray(json?.fonts?.list) ? json.fonts.list : []) {
        if (typeof font?.fPath === 'string' && font.fPath && !/^(https?|data):/i.test(font.fPath))
            paths.push(resolvePath(base, font.fPath));
    }
    for (const p of paths) assertReadablePath(p, policy);
}

"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const canvas_1 = require("@napi-rs/canvas");
const node_path_1 = require("node:path");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
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
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'data',
            description: 'Data of the lottie animation to load',
            type: forgescript_1.ArgType.String,
            required: true,
            rest: false
        },
        {
            name: 'resourcePath',
            description: 'Base folder for external resources (images, fonts); must be inside files.read',
            type: forgescript_1.ArgType.String,
            required: false,
            rest: false
        }
    ],
    async execute(ctx, [name, data, resourcePath]) {
        if (!(ctx.lottieManager instanceof __1.LottieManager))
            ctx.lottieManager = new __1.LottieManager();
        const policy = (0, __1.policyOf)(ctx.client);
        let animation;
        try {
            // JSON text is used as is; anything else is a local path under files.read.
            const d = data.trimStart().startsWith('{') ? data : await (0, __1.readLocal)(data, policy);
            let base;
            if (resourcePath) {
                base = (await (0, __1.resolveReadPath)(resourcePath, policy, 'folder')).path;
                checkExternalAssets(d, base, policy);
            }
            animation = canvas_1.LottieAnimation.loadFromData(d, base ? { resourcePath: base } : undefined);
        }
        catch (e) {
            return (0, __1.loaderFailure)(this, e, "Failed to load the Lottie animation" /* ReForgeCanvasError.LottieFail */);
        }
        ctx.lottieManager.set(name, animation);
        return this.success();
    }
});
/**
 * With a resourcePath, Skia resolves image assets as resourcePath + u + p, and "../" in them
 * leaves the folder. Every external asset must stay inside files.read.
 */
function checkExternalAssets(data, base, policy) {
    let json;
    try {
        json = JSON.parse(data.toString());
    }
    catch {
        throw new __1.LoaderError('FAILED', 'Lottie data is not valid JSON');
    }
    const paths = [];
    for (const asset of Array.isArray(json?.assets) ? json.assets : []) {
        if (typeof asset?.p !== 'string' || asset.e === 1 || /^data:/i.test(asset.p))
            continue;
        paths.push((0, node_path_1.resolve)(base, typeof asset.u === 'string' ? asset.u : '', asset.p));
    }
    for (const font of Array.isArray(json?.fonts?.list) ? json.fonts.list : []) {
        if (typeof font?.fPath === 'string' && font.fPath && !/^(https?|data):/i.test(font.fPath))
            paths.push((0, node_path_1.resolve)(base, font.fPath));
    }
    for (const p of paths)
        (0, __1.assertReadablePath)(p, policy);
}

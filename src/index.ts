/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { ForgeClient, ForgeExtension, Logger } from '@tryforge/forgescript';
import { CanvasManager, ComponentManager, GIFManager, GradientManager, ImageManager, LottieManager, NeuQuantManager } from './classes';
import { IReForgeCanvasOptions, LoaderPolicy, LOG_PREFIX, resolvePolicy, setPolicy } from './structures/loader';

import * as pkg from '../package.json';
export const version = pkg.version;

/** The name the original ForgeCanvas registers; both define the same functions. */
const UPSTREAM_NAME = 'forge.canvas';

export class ReForgeCanvas extends ForgeExtension {
    name = 'reforge.canvas';
    description = pkg.description;
    version = version;

    /** The resolved loader policy of this bot (defaults filled in). */
    public readonly policy: LoaderPolicy;

    constructor(options: IReForgeCanvasOptions = {}) {
        super();
        this.policy = resolvePolicy(options);
    }

    public init(client: ForgeClient) {
        const upstream = client.options.extensions?.filter(x => x !== this && x?.name === UPSTREAM_NAME) ?? [];
        if (upstream.length) {
            Logger.error(
                `${LOG_PREFIX} ForgeCanvas (@tryforge/forge.canvas) is loaded next to ReForgeCanvas. Both define the same functions; ` +
                'ReForgeCanvas keeps its own and ForgeCanvas is not started. Remove @tryforge/forge.canvas from the extensions.'
            );
            // Extensions listed after this one have not started yet: keep them from replacing the hardened functions.
            for (const ext of upstream) ext.init = () => {};
        }

        setPolicy(client, this.policy);
        this.load(__dirname + '/functions');
        client.preloadImages = new ImageManager(this.policy);
    }

    public static components = new ComponentManager();
}

declare module '@tryforge/forgescript' {
    interface ForgeClient {
        preloadImages: ImageManager;
    }

    interface Context {
        canvasManager?: CanvasManager;
        gradientManager?: GradientManager;
        imageManager?: ImageManager;
        gifManager?: GIFManager;
        neuquantManager?: NeuQuantManager;
        lottieManager?: LottieManager;
    }
}

export * from './structures';
export * from './classes';
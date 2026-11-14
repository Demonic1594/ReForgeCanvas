/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

import { ForgeClient, ForgeExtension } from '@tryforge/forgescript';
import { CanvasManager, ComponentManager, GIFManager, GradientManager, ImageManager, LottieManager, NeuQuantManager } from './classes';
import { IReForgeCanvasOptions, LoaderPolicy, resolvePolicy, setPolicy } from './structures/loader';
import { LOG_PREFIX, log, setLogLevel } from './structures/logger';

import * as pkg from '../package.json';
export const version = pkg.version;

/** The name the original ForgeCanvas registers; both define the same functions. */
const UPSTREAM_NAME = 'forge.canvas';

/** One-time warnings about guarded working-folder access (files.read / files.write: true). */
let warnedGuarded = false;

export class ReForgeCanvas extends ForgeExtension {
    name = 'reforge.canvas';
    description = pkg.description;
    version = version;

    /** The resolved loader policy of this bot (defaults filled in). */
    public readonly policy: LoaderPolicy;

    /** Wrong options throw here, so the bot does not start with a broken setup. */
    constructor(options: IReForgeCanvasOptions = {}) {
        super();
        this.policy = resolvePolicy(options);
        setLogLevel(this.policy.logLevel);
    }

    /**
     * Runs before init(), outside ForgeScript's try/catch, so an error here stops the client:
     * ForgeCanvas next to ReForgeCanvas is refused (both define the same functions).
     */
    protected validateAndInit(client: ForgeClient) {
        if (client.options.extensions?.some(x => x !== this && x?.name === UPSTREAM_NAME))
            throw new Error(`${LOG_PREFIX} ForgeCanvas (@tryforge/forge.canvas) cannot be loaded next to ReForgeCanvas: both define the same functions, and whichever loads last replaces the other. Remove ForgeCanvas from the extensions (and npm uninstall @tryforge/forge.canvas).`);
        super.validateAndInit(client);
    }

    public init(client: ForgeClient) {
        const f = this.policy.files;
        if ((f.readGuarded || f.writeGuarded) && !warnedGuarded) {
            warnedGuarded = true;
            log.warn(`files.${f.readGuarded ? 'read' : 'write'}: true lets commands use the whole bot folder (${process.cwd()}), with guards: only image, font, GIF and Lottie files, no hidden files, node_modules or databases. A folder of its own is safer: files: { read: "./assets", write: "./output" }.`);
        }
        setPolicy(client, this.policy);
        this.load(__dirname + '/functions');
        client.preloadImages = new ImageManager(this.policy);
        log.debug(`started: network ${this.policy.network.enabled ? 'on' : 'off'}, files.read ${f.read ?? 'off'}, files.write ${f.write ?? 'off'}`);
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
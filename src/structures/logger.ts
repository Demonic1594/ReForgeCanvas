/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

// ReForgeCanvas's logger: every line starts with [ReForgeCanvas], and the level comes from the
// logLevel option or REFORGECANVAS_LOG_LEVEL ("info" by default, like the other ReForge extensions).
// info: start-up and configuration; warn: a refused or failed load (one line, with the reason);
// debug: each load and cache hit; trace: more. It never prints query strings, tokens or file
// contents: callers pass describeUrl() for URLs and paths relative to the bot.

import { Logger } from '@tryforge/forgescript';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export const LOG_LEVELS: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug', 'trace'];
export const LOG_PREFIX = '[ReForgeCanvas]';

export function envLogLevel(): LogLevel | undefined {
    const v = String(process.env.REFORGECANVAS_LOG_LEVEL ?? '').trim().toLowerCase();
    return (LOG_LEVELS as string[]).includes(v) ? v as LogLevel : undefined;
}

let level: LogLevel = envLogLevel() ?? 'info';

/** Sets the level for the whole process (the last ReForgeCanvas created sets it). */
export function setLogLevel(l: LogLevel) { level = l }
export function getLogLevel() { return level }

const on = (l: LogLevel) => LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(l);

export const log = {
    error: (msg: string) => { if (on('error')) Logger.error(`${LOG_PREFIX} ${msg}`) },
    warn: (msg: string) => { if (on('warn')) Logger.warn(`${LOG_PREFIX} ${msg}`) },
    info: (msg: string) => { if (on('info')) Logger.info(`${LOG_PREFIX} ${msg}`) },
    debug: (msg: string) => { if (on('debug')) Logger.debug(`${LOG_PREFIX} ${msg}`) },
    trace: (msg: string) => { if (on('trace')) Logger.debug(`${LOG_PREFIX} trace: ${msg}`) },
    /** Lines the caller asked for explicitly (registerFonts(..., true), components.load(..., true)): shown unless silent. */
    print: (msg: string) => { if (level !== 'silent') Logger.info(`${LOG_PREFIX} ${msg}`) },
    enabled: on,
};

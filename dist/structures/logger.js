"use strict";
/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.LOG_PREFIX = exports.LOG_LEVELS = void 0;
exports.envLogLevel = envLogLevel;
exports.setLogLevel = setLogLevel;
exports.getLogLevel = getLogLevel;
// ReForgeCanvas's logger: every line starts with [ReForgeCanvas], and the level comes from the
// logLevel option or REFORGECANVAS_LOG_LEVEL ("info" by default, like the other ReForge extensions).
// info: start-up and configuration; warn: a refused or failed load (one line, with the reason);
// debug: each load and cache hit; trace: more. It never prints query strings, tokens or file
// contents: callers pass describeUrl() for URLs and paths relative to the bot.
const forgescript_1 = require("@tryforge/forgescript");
exports.LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug', 'trace'];
exports.LOG_PREFIX = '[ReForgeCanvas]';
function envLogLevel() {
    const v = String(process.env.REFORGECANVAS_LOG_LEVEL ?? '').trim().toLowerCase();
    return exports.LOG_LEVELS.includes(v) ? v : undefined;
}
let level = envLogLevel() ?? 'info';
/** Sets the level for the whole process (the last ReForgeCanvas created sets it). */
function setLogLevel(l) { level = l; }
function getLogLevel() { return level; }
const on = (l) => exports.LOG_LEVELS.indexOf(level) >= exports.LOG_LEVELS.indexOf(l);
exports.log = {
    error: (msg) => { if (on('error'))
        forgescript_1.Logger.error(`${exports.LOG_PREFIX} ${msg}`); },
    warn: (msg) => { if (on('warn'))
        forgescript_1.Logger.warn(`${exports.LOG_PREFIX} ${msg}`); },
    info: (msg) => { if (on('info'))
        forgescript_1.Logger.info(`${exports.LOG_PREFIX} ${msg}`); },
    debug: (msg) => { if (on('debug'))
        forgescript_1.Logger.debug(`${exports.LOG_PREFIX} ${msg}`); },
    trace: (msg) => { if (on('trace'))
        forgescript_1.Logger.debug(`${exports.LOG_PREFIX} trace: ${msg}`); },
    /** Lines the caller asked for explicitly (registerFonts(..., true), components.load(..., true)): shown unless silent. */
    print: (msg) => { if (level !== 'silent')
        forgescript_1.Logger.info(`${exports.LOG_PREFIX} ${msg}`); },
    enabled: on,
};

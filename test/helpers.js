/*
 * Test helpers. The tests run the compiled package (dist/, or REFORGE_DIST) the way ForgeScript
 * runs it: each function's execute() with a context, so the same files also run against the
 * original ForgeCanvas 1.3.1 build to show which tests fail there.
 */
'use strict';

const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const dns = require('node:dns');
const { Return, ReturnType, Logger } = require('@tryforge/forgescript');
const { createCanvas } = require('@napi-rs/canvas');

const DIST = process.env.REFORGE_DIST ? path.resolve(process.env.REFORGE_DIST) : path.join(__dirname, '..', 'dist');
const mod = require(DIST);
const hardened = typeof mod.ReForgeCanvas === 'function';

function png(w = 4, h = 4, color = '#ff0000') {
    const c = createCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    return c.toBuffer('image/png');
}

/** A bot (client) with ReForgeCanvas options applied; the original build ignores options. */
function makeBot(options = {}) {
    const client = { options: { extensions: [] } };
    if (hardened) {
        const ext = new mod.ReForgeCanvas(options);
        mod.setPolicy(client, ext.policy);
        client.preloadImages = new mod.ImageManager(ext.policy);
    } else client.preloadImages = new mod.ImageManager();
    return client;
}

function makeCtx(client = makeBot()) {
    const env = {};
    return {
        client, env,
        setEnvironmentKey(k, v) { env[k] = v },
        getEnvironmentKey(k) { return env[k] }
    };
}

function fn(rel) { return require(path.join(DIST, 'functions', rel)).default }

/** Runs a ForgeScript function; resolves { ok, value, error, timedOut }. */
async function call(rel, ctx, args, timeoutMs = 4000) {
    const f = fn(rel);
    const self = {
        data: f.data,
        success: (v = null) => new Return(ReturnType.Success, v),
        successJSON: v => new Return(ReturnType.Success, typeof v === 'string' ? v : JSON.stringify(v)),
        customError: m => new Return(ReturnType.Error, m)
    };
    let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => r({ timedOut: true }), timeoutMs); timer.unref() });
    const run = Promise.resolve()
        .then(() => f.data.execute.call(self, ctx, args))
        .then(r => ({ ok: r?.success === true, value: r?.value, error: r?.error ? String(r.value?.message ?? r.value) : null }),
            e => ({ ok: false, error: String(e?.message ?? e), thrown: true }));
    const out = await Promise.race([run, timeout]);
    clearTimeout(timer);
    return out;
}

/** A local HTTP server; `hits` lists every path requested. */
async function server(handler, host = '127.0.0.1') {
    const hits = [];
    const srv = http.createServer((req, res) => { hits.push(req.url); handler(req, res) });
    await new Promise((r, j) => srv.once('error', j).listen(0, host, r));
    const port = srv.address().port;
    return {
        hits, port, host,
        url: (p = '/') => `http://${host}:${port}${p}`,
        close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()) })
    };
}

/** Maps hostnames to addresses for the duration of a test (the loader resolves through dns.lookup). */
function fakeDns(map) {
    const original = dns.lookup;
    dns.lookup = function (hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {} }
        if (Object.hasOwn(map, hostname)) {
            const address = map[hostname];
            const family = address.includes(':') ? 6 : 4;
            return process.nextTick(() => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family));
        }
        return original.call(dns, hostname, options, callback);
    };
    return () => { dns.lookup = original };
}

/** Collects what the extension logs as warnings or errors. */
function captureLog() {
    const lines = [];
    const saved = { warn: Logger.warn, error: Logger.error };
    Logger.warn = (...a) => lines.push(a.join(' '));
    Logger.error = (...a) => lines.push(a.join(' '));
    return { lines, restore: () => Object.assign(Logger, saved) };
}

function tmpdir(prefix = 'rfc-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

const NOT_ALLOWED = 'This source is not allowed';
const TOO_LARGE = 'This source is too large';

module.exports = { DIST, mod, hardened, png, makeBot, makeCtx, fn, call, server, fakeDns, captureLog, tmpdir, NOT_ALLOWED, TOO_LARGE };

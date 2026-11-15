/*
 * Test harness: a real ForgeScript client (never logged in) with the extension under test, running
 * ForgeScript code through ForgeScript's own Compiler and Interpreter, as a command would.
 * Only the outside world is stood in for: local HTTP servers, a fake DNS answer, temporary folders.
 *
 * The build under test is dist/ (or REFORGE_DIST): the same files run against the ForgeCanvas 1.3.1
 * build to show what fails there. That build ignores ReForgeCanvas's options.
 */
'use strict';

const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const dns = require('node:dns');
const { ForgeClient, Compiler, Interpreter, Container, Logger } = require('@tryforge/forgescript');
const { createCanvas } = require('@napi-rs/canvas');

const DIST = process.env.REFORGE_DIST ? path.resolve(process.env.REFORGE_DIST) : path.join(__dirname, '..', 'dist');
const mod = require(DIST);
const hardened = typeof mod.ReForgeCanvas === 'function';

/* ---------- log capture (ForgeScript's Logger, which both builds print through) ---------- */

const logs = [];
for (const level of ['error', 'warn', 'info', 'debug']) {
    Logger[level] = (...a) => { logs.push({ level, text: a.map(String).join(' ') }) };
}

/* ---------- bots ---------- */

/** A client with the extension under test. 1.3.1 takes no options. */
function boot(options = {}, more = {}) {
    const ext = hardened ? new mod.ReForgeCanvas(options) : new mod.ForgeCanvas();
    const client = new ForgeClient({ intents: ['Guilds'], extensions: [ext, ...(more.extensions ?? [])] });
    return { client, ext, run: (code, opts) => run(client, code, opts) };
}

/** The message of a ForgeScript error as Logger prints it: "> **`text`** at `$fn[...]`". */
function errorText(line) {
    const m = /\*\*`([\s\S]*?)`\*\*/.exec(line);
    return m ? m[1] : line;
}

/**
 * Runs ForgeScript code. Resolves { ok, value, error, logs, timedOut, ms }.
 * `error` is the message a user would see; `logs` holds what the extension printed during the run.
 */
async function run(client, code, { timeout = 8000 } = {}) {
    const from = logs.length;
    let data;
    try { data = Compiler.compile(code) } catch (e) {
        return { ok: false, value: null, error: String(e?.message ?? e), compileError: true, timedOut: false, logs: [], files: [], ms: 0 };
    }
    const runtime = {
        client, data, obj: {}, args: [], keywords: {}, environment: {},
        doNotSend: true, redirectErrorsToConsole: true, allowTopLevelReturn: true, container: new Container()
    };
    const started = Date.now();
    let timer;
    const timedOut = new Promise((r) => { timer = setTimeout(() => r({ timedOut: true }), timeout); timer.unref() });
    const done = Interpreter.run(runtime).then(
        (value) => ({ value }),
        (e) => ({ thrown: String(e?.message ?? e) })
    );
    const out = await Promise.race([done, timedOut]);
    clearTimeout(timer);
    const lines = logs.slice(from);
    const errLine = lines.filter((l) => l.level === 'error' && /\*\*`/.test(l.text)).pop();
    // a plain JS error thrown inside a function: ForgeScript logs it as "RangeError: ..." and stops the command
    const rawLine = lines.filter((l) => l.level === 'error' && !/\*\*`/.test(l.text) && !l.text.startsWith('[ReForgeCanvas]')).pop();
    const error = out.thrown ?? (errLine ? errorText(errLine.text) : rawLine ? rawLine.text : null);
    return {
        ok: !out.timedOut && !error && out.value !== undefined,
        value: out.value ?? null,
        error,
        raw: !out.thrown && !errLine && !!rawLine,
        timedOut: !!out.timedOut,
        logs: lines.map((l) => `${l.level}: ${l.text}`),
        files: (runtime.container.files ?? []).map((f) => f.name),
        ms: Date.now() - started
    };
}

/* ---------- the outside world ---------- */

function png(w = 4, h = 4, color = '#ff0000') {
    const c = createCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    return c.toBuffer('image/png');
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
        close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()) })
    };
}

/** Maps host names to addresses while a test runs (the loader resolves through dns.lookup). */
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

function tmpdir(prefix = 'rfc-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

/** A PNG whose header says W x H (1-bit, all black): a few KB that decode to W*H*4 bytes. */
function pngBomb(W, H) {
    const zlib = require('node:zlib');
    const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 1;
    const raw = Buffer.alloc((1 + Math.ceil(W / 8)) * H);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A data URI for ForgeScript code (its ";" escaped). */
function dataUri(buf, mime = 'image/png') { return `data:${mime}\\;base64,${buf.toString('base64')}` }

/** Escapes ; [ ] so text can be one ForgeScript argument. */
function esc(text) { return String(text).replace(/[;[\]\\$]/g, (c) => '\\' + c) }

const NOT_ALLOWED = 'This source is not allowed';
const TOO_LARGE = 'This source is too large';

module.exports = { DIST, mod, hardened, logs, boot, run, png, server, fakeDns, tmpdir, pngBomb, dataUri, esc, NOT_ALLOWED, TOO_LARGE };

'use strict';

// Seeded fuzz: every function with hostile arguments, through the real interpreter.
// FUZZ_SEED replays a run, FUZZ_RUNS sets how many calls (default 600).
// Checked: no crash or unhandled rejection, every call ends in time, no request reaches the
// "internal" server, the secret file is never read (its access time, so native reads count too),
// and the functions that load or save sources only fail with errors $try can catch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, png, pngBomb, server, tmpdir, dataUri, esc } = require('./harness');

const SEED = Number(process.env.FUZZ_SEED ?? 1337) >>> 0;
const RUNS = Number(process.env.FUZZ_RUNS ?? 600);
const LOADERS = new Set(['$loadImage', '$preloadImage', '$drawImage', '$drawImageArea', '$imageSize', '$imageBuffer', '$loadImageOptions',
    '$createFrame', '$addFrame', '$newGIFDecoder', '$registerFont', '$loadLottieAnimation', '$saveCanvas', '$saveEncoder',
    '$drawRect', '$fill', '$stroke', '$drawText', '$drawProgressBar', '$createCanvas', '$resizeCanvas', '$newGIFEncoder']);

test(`fuzz (FUZZ_SEED=${SEED}, FUZZ_RUNS=${RUNS})`, async (t) => {
    let seed = SEED;
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 };
    const pick = (a) => a[Math.floor(rand() * a.length)];

    const internal = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()) });
    const dir = tmpdir('rfc-secret-');
    const secret = path.join(dir, 'secret.png');
    fs.writeFileSync(secret, png(37, 41));
    const old = new Date(Date.now() - 86400000);
    fs.utimesSync(secret, old, new Date()); // atime older than mtime: the next read updates it
    const atime = fs.statSync(secret).atimeMs;
    t.after(() => { internal.close(); fs.rmSync(dir, { recursive: true, force: true }) });

    const problems = [];
    const onCrash = (e) => problems.push(`process-level: ${e?.stack?.split('\n')[0] ?? e}`);
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
    t.after(() => { process.off('uncaughtException', onCrash); process.off('unhandledRejection', onCrash) });

    const fns = require('../metadata/functions.json');
    const u = internal.url('/x.png');
    const pool = [
        '', '0', '-1', '1', '64', '1e309', 'NaN', '99999999', '-99999', '1.5', 'abc', 'true', 'false', 'fill', 'stroke', 'clear',
        '#ff0000', 'Red', 'gradient://g', 'pattern://' + u, 'images://nope', 'preload://nope', 'canvas://c', 'frame://f', 'encoder://g',
        u, 'http://169.254.169.254/latest/meta-data/', 'http://localhost/a.png', 'http://[::1\\]/a.png', 'file:///etc/passwd',
        secret, './' + path.relative(process.cwd(), secret), '../../../../' + secret, '/etc/passwd', 'C:\\\\Windows\\\\win.ini',
        dataUri(png()), 'data:image/png\\;base64,AAAA', dataUri(pngBomb(30000, 30000)), esc('<svg xmlns="http://www.w3.org/2000/svg" width="99999" height="99999"/>'),
        'rgba://2x2:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16', 'hex://1x1:#fff', '20px sans-serif', '\\;', '💥', 'A'.repeat(5000),
        esc('{"a":1}'), esc('[1,2,3]'), esc('{"delay":-1,"palette":[1,2]}'), '<:e:123456789012345678>'
    ];
    const prefix = '$createCanvas[c;64;64]$newGIFEncoder[g;16;16]';
    const counts = { runs: 0, ok: 0, caught: 0, raw: 0, compile: 0 };
    const raw = new Map();

    for (let i = 0; i < RUNS; i++) {
        const f = pick(fns);
        const n = Math.max(0, (f.args?.length ?? 0) + Math.floor(rand() * 3) - 1);
        const args = Array.from({ length: n }, () => pick(pool));
        const call = f.brackets === false && !n ? f.name : `${f.name}[${args.join(';')}]`;
        const bot = boot();
        const r = await bot.run(`${prefix}$try[${call};CAUGHT]`, { timeout: 15000 });
        counts.runs++;
        if (r.compileError) { counts.compile++; continue } // ForgeScript refused the call itself (argument count)
        if (r.timedOut) problems.push(`timed out: ${call.slice(0, 160)}`);
        else if (r.error) { counts.raw++; raw.set(f.name, (raw.get(f.name) ?? 0) + 1); if (LOADERS.has(f.name)) problems.push(`not catchable: ${call.slice(0, 160)} -> ${r.error.slice(0, 120)}`) }
        else if (String(r.value).includes('CAUGHT')) counts.caught++;
        else counts.ok++;
    }

    const reads = fs.statSync(secret).atimeMs !== atime;
    t.diagnostic(`${counts.runs} calls: ${counts.compile} refused by the compiler, ${counts.ok} succeeded, ${counts.caught} refused with a catchable error, ${counts.raw} raw errors ` +
        `(outside the loaders: ${[...raw].filter(([k]) => !LOADERS.has(k)).map(([k, v]) => `${k} x${v}`).join(', ') || 'none'})`);
    assert.equal(internal.hits.length, 0, `the internal server got ${internal.hits.length} requests`);
    assert.equal(reads, false, 'the secret file was read');
    assert.deepEqual(problems.slice(0, 10), []);
});

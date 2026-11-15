'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, png, server, fakeDns, esc, NOT_ALLOWED, TOO_LARGE } = require('./harness');

const IMG = png();
const LOCAL = { network: { allowPrivateNetwork: ['127.0.0.1'] } };
const net = (more) => ({ network: { ...LOCAL.network, ...more } });

test('network', async (t) => {
    const img = await server((req, res) => {
        if (req.url.startsWith('/hang')) return; // never answers
        if (req.url.startsWith('/big')) {
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(5 * 1024 * 1024) });
            return res.end(Buffer.alloc(5 * 1024 * 1024));
        }
        if (req.url.startsWith('/stream')) { // no content-length, 40 MiB
            res.writeHead(200, { 'content-type': 'image/png' });
            let sent = 0;
            const push = () => { while (sent < 40) { sent++; if (!res.write(Buffer.alloc(1024 * 1024))) return res.once('drain', push) } res.end() };
            return push();
        }
        const hop = /^\/hop\/(\d+)/.exec(req.url);
        if (hop) {
            const n = Number(hop[1]);
            res.writeHead(302, { location: n > 1 ? `/hop/${n - 1}` : '/ok.png' });
            return res.end();
        }
        if (req.url.startsWith('/to/')) {
            res.writeHead(302, { location: decodeURIComponent(req.url.slice(4)) });
            return res.end();
        }
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(IMG);
    });
    // a second "internal" service on another loopback address
    const internal = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(IMG) }, '127.0.0.2');
    t.after(() => Promise.all([img.close(), internal.close()]));
    const local = boot(LOCAL);
    const strict = boot();

    await t.test('an allowed source still loads', async () => {
        const r = await local.run(`$loadImage[a;${img.url('/ok.png')}]$imageSize[images://a;width]`);
        assert.equal(r.value, '4', r.error);
    });

    await t.test('loopback is refused by default, before connecting', async () => {
        const before = img.hits.length;
        const r = await strict.run(`$loadImage[a;${img.url('/ok.png')}]`);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before, 'the server must not be contacted');
    });

    await t.test('every spelling of this machine is refused before connecting', async () => {
        // decimal, hex, short, octal, IPv4-mapped (both forms), IPv6 loopback, 0.0.0.0, a trailing-dot name, upper case
        for (const host of ['2130706433', '0x7f000001', '127.1', '0177.0.0.1', '0x7f.0.0.1', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]',
            '[::1]', '0.0.0.0', '0', 'localhost', 'localhost.', 'LOCALHOST']) {
            const before = img.hits.length;
            const r = await strict.run(`$loadImage[a;${esc(`http://${host}:${img.port}/ok.png`)}]`);
            assert.equal(r.error, NOT_ALLOWED, host);
            assert.equal(img.hits.length, before, host);
        }
    });

    await t.test('private, shared, link-local and IPv6 local ranges are refused', async () => {
        for (const host of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '100.64.0.1', '169.254.169.254', '[fd00::1]', '[fe80::1]', '[fc00::5]', '[64:ff9b::a9fe:a9fe]', '[64:ff9b:1::1]']) {
            const r = await strict.run(`$loadImage[a;${esc(`http://${host}/x.png`)}]`, { timeout: 3000 });
            assert.equal(r.error, NOT_ALLOWED, host);
        }
    });

    await t.test('an IPv6 zone ID is refused without a request', async () => {
        const before = img.hits.length;
        const r = await strict.run('$loadImage[a;http://[fe80::1%25lo\\]/x.png]', { timeout: 3000 });
        assert.equal(r.ok, false);
        assert.equal(img.hits.length, before);
    });

    await t.test('a redirect to a private address is refused', async () => {
        const target = encodeURIComponent(internal.url('/secret.png'));
        const r = await local.run(`$loadImage[a;${img.url(`/to/${target}`)}]`);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(internal.hits.length, 0);
    });

    await t.test('a redirect to a name that resolves to a private address is refused', async (t2) => {
        t2.after(fakeDns({ 'internal.test': '127.0.0.2' }));
        const target = encodeURIComponent(`http://internal.test:${internal.port}/secret.png`);
        const r = await local.run(`$loadImage[a;${img.url(`/to/${target}`)}]`);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(internal.hits.length, 0);
    });

    await t.test('redirects are capped (5 by default)', async () => {
        assert.equal((await local.run(`$loadImage[a;${img.url('/hop/5')}]ok`)).value, 'ok');
        assert.equal((await local.run(`$loadImage[a;${img.url('/hop/8')}]`)).error, NOT_ALLOWED);
    });

    await t.test('$loadImageOptions cannot raise the redirect cap', async () => {
        const r = await local.run(`$loadImageOptions[false;;50]$loadImage[a;${img.url('/hop/8')}]`);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('a slow server times out', async () => {
        const r = await boot(net({ timeout: 300 })).run(`$loadImage[a;${img.url('/hang')}]`, { timeout: 3000 });
        assert.equal(r.timedOut, false, 'the load must end by itself');
        assert.equal(r.ok, false);
        assert.ok(r.ms < 2000, `${r.ms} ms`);
    });

    await t.test('a declared size over maxBytes is refused', async () => {
        assert.equal((await boot(net({ maxBytes: 1024 * 1024 })).run(`$loadImage[a;${img.url('/big')}]`)).error, TOO_LARGE);
    });

    await t.test('a body without a size is cut off at maxBytes', async () => {
        assert.equal((await boot(net({ maxBytes: 1024 * 1024 })).run(`$loadImage[a;${img.url('/stream')}]`)).error, TOO_LARGE);
    });

    await t.test('allowedHosts limits which hosts are fetched (exact and *.)', async (t2) => {
        t2.after(fakeDns({ 'cdn.example.test': '127.0.0.1', 'cdn.example.test.': '127.0.0.1', 'img.cdn.example.test': '127.0.0.1', 'other.test': '127.0.0.1' }));
        const bot = boot(net({ allowedHosts: ['cdn.example.test', '*.cdn.example.test'] }));
        for (const host of ['cdn.example.test', 'img.cdn.example.test', 'cdn.example.test.']) {
            const r = await bot.run(`$loadImage[a;http://${host}:${img.port}/ok.png]ok`);
            assert.equal(r.value, 'ok', `${host}: ${r.error}`);
        }
        assert.equal((await bot.run(`$loadImage[a;http://other.test:${img.port}/ok.png]`)).error, NOT_ALLOWED);
    });

    await t.test('network.enabled false refuses every URL', async () => {
        assert.equal((await boot(net({ enabled: false })).run(`$loadImage[a;${img.url('/ok.png')}]`)).error, NOT_ALLOWED);
    });

    await t.test('a pattern:// style goes through the same checks', async () => {
        const before = img.hits.length;
        const r = await strict.run(`$createCanvas[c;8;8;$drawRect[c;fill;pattern://${img.url('/ok.png')};0;0;8;8;0]]`);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before);
    });

    await t.test('$newGIFDecoder, $imageSize and $createFrame use the same checks', async () => {
        const before = img.hits.length;
        for (const code of [`$newGIFDecoder[g;${img.url('/x.gif')}]`, `$imageSize[${img.url('/ok.png')}]`, `$createFrame[f;${img.url('/ok.png')}]`])
            assert.equal((await strict.run(code)).error, NOT_ALLOWED, code);
        assert.equal(img.hits.length, before);
        const slow = await boot(net({ timeout: 300 })).run(`$newGIFDecoder[g;${img.url('/hang')}]`, { timeout: 3000 });
        assert.equal(slow.timedOut, false);
        assert.equal(slow.ok, false);
    });

    await t.test('users get a generic error; the log has the detail, and $try catches it', async () => {
        const blocked = await strict.run(`$loadImage[a;${internal.url('/secret.png')}]`);
        assert.equal(blocked.error, NOT_ALLOWED);
        assert.ok(blocked.logs.some((l) => l.includes('[ReForgeCanvas]') && l.includes('127.0.0.2')), blocked.logs.join('\n'));
        const bad = await local.run('$loadImage[a;data:image/png\\;base64,AAAA]');
        assert.equal(bad.error, 'Failed to load an image');
        const caught = await strict.run(`$try[$loadImage[a;${internal.url('/secret.png')}];caught: $env[e];e]`);
        assert.match(String(caught.value), /^caught: .*This source is not allowed/);
    });
});

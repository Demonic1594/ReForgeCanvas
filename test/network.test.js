'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { png, makeBot, makeCtx, call, server, fakeDns, captureLog, NOT_ALLOWED, TOO_LARGE } = require('./helpers');

const IMG = png();
const LOCAL = { network: { allowPrivateNetwork: ['127.0.0.1'] } };

test('network', async t => {
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

    await t.test('an allowed source still loads', async () => {
        const ctx = makeCtx(makeBot(LOCAL));
        const r = await call('image/loadImage.js', ctx, ['a', img.url('/ok.png')]);
        assert.equal(r.ok, true, r.error);
        assert.equal(ctx.imageManager.get('a').width, 4);
    });

    await t.test('loopback is refused by default, before connecting', async () => {
        const before = img.hits.length;
        const r = await call('image/loadImage.js', makeCtx(makeBot()), ['a', img.url('/ok.png')]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before, 'the server must not be contacted');
    });

    await t.test('a name that resolves to loopback (localhost) is refused', async () => {
        const before = img.hits.length;
        const r = await call('image/loadImage.js', makeCtx(makeBot()), ['a', `http://localhost:${img.port}/ok.png`]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before);
    });

    await t.test('other spellings of loopback are refused', async () => {
        for (const host of [`[::ffff:127.0.0.1]`, `2130706433`, `0x7f000001`, `127.1`, `[::ffff:7f00:1]`]) {
            const before = img.hits.length;
            const r = await call('image/loadImage.js', makeCtx(makeBot()), ['a', `http://${host}:${img.port}/ok.png`]);
            assert.equal(r.error, NOT_ALLOWED, host);
            assert.equal(img.hits.length, before, host);
        }
    });

    await t.test('a redirect to a private address is refused', async () => {
        const target = encodeURIComponent(internal.url('/secret.png'));
        const r = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', img.url(`/to/${target}`)]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(internal.hits.length, 0);
    });

    await t.test('a redirect to a name that resolves to a private address is refused', async t2 => {
        const undo = fakeDns({ 'internal.test': '127.0.0.2' });
        t2.after(undo);
        const target = encodeURIComponent(`http://internal.test:${internal.port}/secret.png`);
        const r = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', img.url(`/to/${target}`)]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(internal.hits.length, 0);
    });

    await t.test('redirects are capped (5 by default)', async () => {
        const ok = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', img.url('/hop/5')]);
        assert.equal(ok.ok, true, ok.error);
        const r = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', img.url('/hop/8')]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('$loadImageOptions cannot raise the redirect cap', async () => {
        const ctx = makeCtx(makeBot(LOCAL));
        await call('image/loadImageOptions.js', ctx, [false, null, 50, null]);
        const r = await call('image/loadImage.js', ctx, ['a', img.url('/hop/8')]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('a slow server times out', async () => {
        const started = Date.now();
        const r = await call('image/loadImage.js', makeCtx(makeBot({ network: { ...LOCAL.network, timeout: 300 } })), ['a', img.url('/hang')], 3000);
        assert.equal(r.timedOut, undefined, 'the load must end by itself');
        assert.equal(r.ok, false);
        assert.ok(Date.now() - started < 2000);
    });

    await t.test('a declared size over maxBytes is refused', async () => {
        const r = await call('image/loadImage.js', makeCtx(makeBot({ network: { ...LOCAL.network, maxBytes: 1024 * 1024 } })), ['a', img.url('/big')]);
        assert.equal(r.error, TOO_LARGE);
    });

    await t.test('a body without a size is cut off at maxBytes', async () => {
        const r = await call('image/loadImage.js', makeCtx(makeBot({ network: { ...LOCAL.network, maxBytes: 1024 * 1024 } })), ['a', img.url('/stream')]);
        assert.equal(r.error, TOO_LARGE);
    });

    await t.test('allowedHosts limits which hosts are fetched (exact and *.)', async t2 => {
        t2.after(fakeDns({ 'cdn.example.test': '127.0.0.1', 'img.cdn.example.test': '127.0.0.1', 'other.test': '127.0.0.1' }));
        const bot = makeBot({ network: { ...LOCAL.network, allowedHosts: ['cdn.example.test', '*.cdn.example.test'] } });
        for (const host of ['cdn.example.test', 'img.cdn.example.test']) {
            const r = await call('image/loadImage.js', makeCtx(bot), ['a', `http://${host}:${img.port}/ok.png`]);
            assert.equal(r.ok, true, `${host}: ${r.error}`);
        }
        const r = await call('image/loadImage.js', makeCtx(bot), ['a', `http://other.test:${img.port}/ok.png`]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('network.enabled false refuses every URL', async () => {
        const r = await call('image/loadImage.js', makeCtx(makeBot({ network: { ...LOCAL.network, enabled: false } })), ['a', img.url('/ok.png')]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('a pattern:// style goes through the same checks', async () => {
        const { CanvasBuilder } = require('./helpers').mod;
        const ctx = makeCtx(makeBot());
        ctx.canvasManager = { getOrCurrent: () => new CanvasBuilder(8, 8) };
        const before = img.hits.length;
        const r = await call('drawing/drawRect.js', ctx, [null, 0, `pattern://${img.url('/ok.png')}`, 0, 0, 8, 8, []]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before);
    });

    await t.test('$newGIFDecoder uses the same checks', async () => {
        const before = img.hits.length;
        const r = await call('gif/newGIFDecoder.js', makeCtx(makeBot()), ['g', img.url('/x.gif'), null]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before);
        const slow = await call('gif/newGIFDecoder.js', makeCtx(makeBot({ network: { ...LOCAL.network, timeout: 300 } })), ['g', img.url('/hang'), null], 3000);
        assert.equal(slow.timedOut, undefined);
        assert.equal(slow.ok, false);
    });

    await t.test('$imageSize uses the same checks', async () => {
        const before = img.hits.length;
        const r = await call('image/imageSize.js', makeCtx(makeBot()), [img.url('/ok.png'), null]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(img.hits.length, before);
    });

    await t.test('users get a generic error; the log has the detail', async () => {
        const log = captureLog();
        try {
            const r = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', img.url('/missing-answer-404?x=1')]);
            assert.equal(r.ok, true); // our server answers 200 with a PNG for any path
            const bad = await call('image/loadImage.js', makeCtx(makeBot(LOCAL)), ['a', 'data:image/png;base64,AAAA']);
            assert.equal(bad.error, 'Failed to load an image');
            const blocked = await call('image/loadImage.js', makeCtx(makeBot()), ['a', internal.url('/secret.png')]);
            assert.equal(blocked.error, NOT_ALLOWED);
            assert.ok(!/127\.0\.0\.2|secret/.test(blocked.error));
            assert.ok(log.lines.some(l => l.includes('[ReForgeCanvas]') && l.includes('127.0.0.2')), log.lines.join('\n'));
        } finally { log.restore() }
    });
});

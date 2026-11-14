'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');
const { png, makeBot, makeCtx, call, server, mod, hardened, NOT_ALLOWED } = require('./helpers');

const LOCAL = { allowPrivateNetwork: ['127.0.0.1'] };
const TWEMOJI = path.join(__dirname, '..', 'assets', 'Twemoji.ttf');

test('fonts', async t => {
    let base = '';
    const srv = await server((req, res) => {
        if (req.url.startsWith('/loop')) { // a stylesheet naming another stylesheet, forever
            const n = Number(req.url.split('/')[2] ?? 0) + 1;
            res.writeHead(200, { 'content-type': 'text/css' });
            return res.end(`/* latin */ @font-face { font-family: 'Loop'; src: url(${base}/loop/${n}); }`);
        }
        if (req.url === '/many.css') {
            res.writeHead(200, { 'content-type': 'text/css' });
            return res.end(Array.from({ length: 150 }, (_, i) => `/* s${i} */ @font-face { font-family: 'Many'; src: url(${base}/font/${i}.ttf); }`).join('\n'));
        }
        if (req.url === '/local.css') { // names a file on the bot's disk
            res.writeHead(200, { 'content-type': 'text/css' });
            return res.end(`/* latin */ @font-face { font-family: 'Evil'; src: url(${TWEMOJI}); }`);
        }
        if (req.url.startsWith('/font/')) { res.writeHead(200, { 'content-type': 'font/ttf' }); return res.end(require('node:fs').readFileSync(TWEMOJI)) }
        res.writeHead(404); res.end();
    });
    base = srv.url('').replace(/\/$/, '');
    t.after(() => srv.close());

    await t.test('nested stylesheets stop at fonts.maxDepth', async () => {
        const r = await call('text/registerFont.js', makeCtx(makeBot({ network: LOCAL })), [srv.url('/loop/0'), null, false], 3000);
        assert.equal(r.timedOut, undefined, 'registration must end by itself');
        assert.equal(r.error, NOT_ALLOWED);
        assert.ok(srv.hits.filter(h => h.startsWith('/loop')).length <= 4, `hits: ${srv.hits.length}`);
    });

    await t.test('one registration loads at most fonts.maxFiles files', async () => {
        const before = srv.hits.length;
        const r = await call('text/registerFont.js', makeCtx(makeBot({ network: LOCAL, fonts: { maxFiles: 20 } })), [srv.url('/many.css'), null, false], 3000);
        assert.equal(r.error, NOT_ALLOWED);
        assert.ok(srv.hits.length - before <= 21, `fetched ${srv.hits.length - before}`);
    });

    await t.test('a stylesheet cannot make the bot read its own disk', async () => {
        const r = await call('text/registerFont.js', makeCtx(makeBot({ network: LOCAL })), [srv.url('/local.css'), null, false], 3000);
        assert.equal(r.ok, false);
        assert.equal(GlobalFonts.has('Evil-latin'), false);
        assert.ok(srv.hits.includes(TWEMOJI), 'the url() is resolved against the stylesheet and fetched from it');
    });

    await t.test('$registerFont with a local path follows files.read', async () => {
        const r = await call('text/registerFont.js', makeCtx(makeBot()), [TWEMOJI, 'UserTwemoji', false]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(GlobalFonts.has('UserTwemoji'), false);
        const ok = await call('text/registerFont.js', makeCtx(makeBot({ files: { read: path.dirname(TWEMOJI) } })), [TWEMOJI, 'AllowedTwemoji', false]);
        assert.equal(ok.ok, true, ok.error);
        assert.equal(GlobalFonts.has('AllowedTwemoji'), true);
    });

    await t.test('registerFonts() from the bot owner\'s JavaScript still reads local files', async () => {
        await mod.registerFonts([{ src: TWEMOJI, name: 'OwnerTwemoji' }]);
        assert.equal(GlobalFonts.has('OwnerTwemoji'), true);
    });
});

test('image cache', async t => {
    const img = png();
    const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(img) });
    t.after(() => srv.close());

    await t.test('automatic cache entries are capped (cache.maxImages)', async () => {
        const bot = makeBot({ network: LOCAL, cache: { maxImages: 10 } });
        const { Image } = require('@napi-rs/canvas');
        const kept = new Image(); kept.src = img;
        bot.preloadImages.set('owner-logo', kept);
        for (let i = 0; i < 30; i++)
            await bot.preloadImages.tryGet(`cache_emoji_${i}`, srv.url(`/e/${i}.png`));
        assert.ok(bot.preloadImages.map.size <= 11, `size ${bot.preloadImages.map.size}`);
        assert.ok(bot.preloadImages.get('owner-logo'), 'images set by name are never evicted');
        assert.ok(bot.preloadImages.get('cache_emoji_29'), 'the newest stay');
    });

    await t.test('$imageSize with many URLs does not grow the cache past the cap', async () => {
        const ctx = makeCtx(makeBot({ network: LOCAL, cache: { maxImages: 5 } }));
        for (let i = 0; i < 20; i++) {
            const r = await call('image/imageSize.js', ctx, [srv.url(`/s/${i}.png`), null]);
            assert.equal(r.ok, true, r.error);
        }
        assert.ok(ctx.imageManager.map.size <= 5, `size ${ctx.imageManager.map.size}`);
    });
});

test('kept behaviour', async t => {
    await t.test('data: URLs and inline SVG still load with the defaults', async () => {
        const ctx = makeCtx(makeBot());
        const data = `data:image/png;base64,${png().toString('base64')}`;
        assert.equal((await call('image/loadImage.js', ctx, ['a', data])).ok, true);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><rect width="6" height="3" fill="red"/></svg>';
        assert.equal((await call('image/loadImage.js', ctx, ['b', svg])).ok, true);
        assert.equal(ctx.imageManager.get('b').width, 6);
    });

    await t.test('images://, preload:// and canvas:// sources still work', async () => {
        const ctx = makeCtx(makeBot());
        const data = `data:image/png;base64,${png().toString('base64')}`;
        await call('image/preloadImage.js', ctx, ['logo', data]);
        assert.equal((await call('image/loadImage.js', ctx, ['a', 'preload://logo'])).ok, true);
        assert.equal((await call('image/loadImage.js', ctx, ['b', 'images://a'])).ok, true);
        const c = new mod.CanvasBuilder(3, 3);
        ctx.canvasManager = { get: () => c, getOrCurrent: () => c };
        assert.equal((await call('image/loadImage.js', ctx, ['c', 'canvas://x'])).ok, true);
    });

    await t.test('inline SVG does not fetch what it links to (checked in @napi-rs/canvas 1.1.1)', async t2 => {
        const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()) });
        t2.after(() => srv.close());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4" height="4"><image href="${srv.url('/x.png')}" xlink:href="${srv.url('/y.png')}" width="4" height="4"/></svg>`;
        const r = await call('image/loadImage.js', makeCtx(makeBot()), ['a', svg]);
        assert.equal(r.ok, true, r.error);
        await new Promise(r2 => setTimeout(r2, 100));
        assert.deepEqual(srv.hits, []);
    });

    await t.test('$createFrame from a URL goes through the loader', async t2 => {
        const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()) });
        t2.after(() => srv.close());
        const r = await call('gif/createFrame.js', makeCtx(makeBot()), ['f', srv.url('/f.png'), null, null]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.deepEqual(srv.hits, []);
        const ok = await call('gif/createFrame.js', makeCtx(makeBot({ network: LOCAL })), ['f', srv.url('/f.png'), null, null]);
        assert.equal(ok.ok, true, ok.error);
    });

    await t.test('$drawImage with a colour still fills the area', async () => {
        const ctx = makeCtx(makeBot());
        const c = new mod.CanvasBuilder(4, 4);
        ctx.canvasManager = { get: () => c, getOrCurrent: () => c };
        const r = await call('drawing/drawImage.js', ctx, [null, '#ff0000', 0, 0, 4, 4, [0]]);
        assert.equal(r.ok, true, r.error);
        assert.deepEqual(Array.from(c.ctx.getImageData(1, 1, 1, 1).data), [255, 0, 0, 255]);
    });
});

test('rename', { skip: !hardened && 'the original build is not renamed' }, async t => {
    const pkg = require('../package.json');
    await t.test('package, class and extension names', () => {
        assert.equal(pkg.name, '@tryforge/reforge.canvas');
        assert.equal(typeof mod.ReForgeCanvas, 'function');
        assert.equal(mod.ForgeCanvas, undefined, 'ForgeCanvas is no longer exported');
        assert.equal(new mod.ReForgeCanvas().name, 'reforge.canvas');
        assert.equal(mod.version, pkg.version);
    });

    await t.test('ForgeCanvas next to ReForgeCanvas is reported and not started', () => {
        const { Logger } = require('@tryforge/forgescript');
        const lines = []; const saved = Logger.error; Logger.error = (...a) => lines.push(a.join(' '));
        try {
            let upstreamStarted = false;
            const upstream = { name: 'forge.canvas', init: () => { upstreamStarted = true } };
            const ext = new mod.ReForgeCanvas();
            ext.load = () => {};
            const client = { options: { extensions: [ext, upstream] } };
            ext.init(client);
            upstream.init(client);
            assert.equal(upstreamStarted, false);
            assert.ok(lines.some(l => l.includes('[ReForgeCanvas]') && l.includes('forge.canvas')));
        } finally { Logger.error = saved }
    });

    await t.test('defaults are the documented ones', () => {
        const p = new mod.ReForgeCanvas().policy;
        assert.deepEqual(
            { ...p.network, allowedHosts: [...p.network.allowedHosts], privateAddresses: [...p.network.privateAddresses] },
            { enabled: true, timeout: 10000, maxBytes: 10485760, maxRedirects: 5, allowedHosts: [], allowPrivateNetwork: false, privateAddresses: [] }
        );
        assert.deepEqual({ ...p.files }, { read: null, write: null });
        assert.deepEqual({ ...p.fonts }, { maxDepth: 3, maxFiles: 100 });
        assert.deepEqual({ ...p.cache }, { maxImages: 500 });
    });

    await t.test('address checks', () => {
        for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
            '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:0101::1', '224.0.0.1'])
            assert.equal(mod.isBlockedAddress(a), true, a);
        for (const a of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:1.1.1.1'])
            assert.equal(mod.isBlockedAddress(a), false, a);
    });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');
const { boot, png, server, dataUri, esc, mod, hardened, NOT_ALLOWED } = require('./harness');

const LOCAL = { network: { allowPrivateNetwork: ['127.0.0.1'] } };
const TWEMOJI = path.join(__dirname, '..', 'assets', 'Twemoji.ttf');

test('fonts', async (t) => {
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
        if (req.url.startsWith('/font/')) { res.writeHead(200, { 'content-type': 'font/ttf' }); return res.end(fs.readFileSync(TWEMOJI)) }
        res.writeHead(404); res.end();
    });
    base = srv.url('').replace(/\/$/, '');
    t.after(() => srv.close());

    await t.test('nested stylesheets stop at fonts.maxDepth', async () => {
        const r = await boot(LOCAL).run(`$registerFont[${srv.url('/loop/0')}]`, { timeout: 3000 });
        assert.equal(r.timedOut, false, 'registration must end by itself');
        assert.equal(r.error, NOT_ALLOWED);
        assert.ok(srv.hits.filter((h) => h.startsWith('/loop')).length <= 4, `hits: ${srv.hits.length}`);
    });

    await t.test('one registration loads at most fonts.maxFiles files', async () => {
        const before = srv.hits.length;
        const r = await boot({ ...LOCAL, fonts: { maxFiles: 20 } }).run(`$registerFont[${srv.url('/many.css')}]`, { timeout: 5000 });
        assert.equal(r.error, NOT_ALLOWED);
        assert.ok(srv.hits.length - before <= 21, `fetched ${srv.hits.length - before}`);
    });

    await t.test('a stylesheet cannot make the bot read its own disk', async () => {
        const r = await boot(LOCAL).run(`$registerFont[${srv.url('/local.css')}]`, { timeout: 3000 });
        assert.equal(r.ok, false);
        assert.equal(GlobalFonts.has('Evil-latin'), false);
        assert.ok(srv.hits.includes(TWEMOJI), 'the url() is resolved against the stylesheet and fetched from it');
    });

    await t.test('$registerFont with a local path follows files.read', async () => {
        assert.equal((await boot().run(`$registerFont[${TWEMOJI};UserTwemoji]`)).error, NOT_ALLOWED);
        assert.equal(GlobalFonts.has('UserTwemoji'), false);
        const ok = await boot({ files: { read: path.dirname(TWEMOJI) } }).run(`$registerFont[${TWEMOJI};AllowedTwemoji]ok`);
        assert.equal(ok.value, 'ok', ok.error);
        assert.equal(GlobalFonts.has('AllowedTwemoji'), true);
    });

    await t.test('registerFonts() from the bot owner\'s JavaScript still reads local files', async () => {
        await mod.registerFonts([{ src: TWEMOJI, name: 'OwnerTwemoji' }]);
        assert.equal(GlobalFonts.has('OwnerTwemoji'), true);
    });
});

test('image cache', async (t) => {
    const img = png();
    const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(img) });
    t.after(() => srv.close());

    await t.test('automatic cache entries are capped (cache.maxImages); named images are never evicted', async () => {
        const bot = boot({ ...LOCAL, cache: { maxImages: 10 } });
        assert.equal((await bot.run(`$preloadImage[owner-logo;${dataUri(img)}]ok`)).value, 'ok');
        for (let i = 0; i < 30; i++) await bot.client.preloadImages.tryGet(`cache_emoji_${i}`, srv.url(`/e/${i}.png`));
        assert.ok(bot.client.preloadImages.map.size <= 11, `size ${bot.client.preloadImages.map.size}`);
        assert.equal((await bot.run('$imageSize[images://preload://owner-logo;width]')).value, '4');
        assert.ok(bot.client.preloadImages.get('cache_emoji_29'), 'the newest stay');
    });

    await t.test('URLs given straight to $imageSize are cached per command, capped', async () => {
        const bot = boot({ ...LOCAL, cache: { maxImages: 5 } });
        const urls = Array.from({ length: 8 }, (_, i) => srv.url(`/s/${i}.png`));
        const code = urls.map((u) => `$imageSize[${u};width]`).join(',');
        const r = await bot.run(`${code}|$imageSize[images://${urls[7]};width]`);
        assert.equal(r.value, '4,4,4,4,4,4,4,4|4', r.error);
        const evicted = await bot.run(`${code}$imageSize[images://${urls[0]};width]`);
        assert.equal(evicted.ok, false, 'the oldest entry was evicted');
    });
});

test('kept behaviour', async (t) => {
    const bot = boot();

    await t.test('data: URLs and inline SVG still load with the defaults', async () => {
        assert.equal((await bot.run(`$loadImage[a;${dataUri(png())}]$imageSize[images://a;width]`)).value, '4');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><rect width="6" height="3" fill="red"/></svg>';
        assert.equal((await bot.run(`$loadImage[b;${esc(svg)}]$imageSize[images://b;width]`)).value, '6');
    });

    await t.test('inline SVG does not fetch what it links to', async (t2) => {
        const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()) });
        t2.after(() => srv.close());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4" height="4"><image href="${srv.url('/x.png')}" xlink:href="${srv.url('/y.png')}" width="4" height="4"/></svg>`;
        const r = await bot.run(`$loadImage[a;${esc(svg)}]ok`);
        assert.equal(r.value, 'ok', r.error);
        await new Promise((r2) => setTimeout(r2, 100));
        assert.deepEqual(srv.hits, []);
    });

    await t.test('images://, preload:// and canvas:// sources still work', async () => {
        const r = await bot.run(`$preloadImage[logo;${dataUri(png())}]$loadImage[a;preload://logo]$loadImage[b;images://a]$createCanvas[c;3;3]$loadImage[d;canvas://c]$imageSize[images://d;width]`);
        assert.equal(r.value, '3', r.error);
    });

    await t.test('$drawImage with a colour still fills the area', async () => {
        const r = await bot.run('$createCanvas[c;4;4;$drawImage[c;#ff0000;0;0;4;4;0]]$getPixels[c;1;1;1;1]');
        assert.match(String(r.value), /#F00|#FF0000/i, r.error ?? '');
    });
});

test('fixed bugs of 1.3.1', async (t) => {
    const bot = boot();

    await t.test('$imageSize[preload://name] finds a preloaded image', async () => {
        assert.equal((await bot.run(`$preloadImage[logo;${dataUri(png(7, 2))}]$imageSize[preload://logo;width]`)).value, '7');
    });

    await t.test('$imageBuffer[var;preload://name] finds it too', async () => {
        assert.equal((await bot.run(`$preloadImage[logo2;${dataUri(png(7, 2))}]$imageBuffer[buf;preload://logo2]ok`)).value, 'ok');
    });

    await t.test('$saveCanvas works (1.3.1 always failed with "image/png is not valid format")', async () => {
        assert.equal((await bot.run('$createCanvas[c;5;5]$saveCanvas[c;images://snap]$imageSize[images://snap;width]')).value, '5');
    });

    await t.test('$imageSize with a data URL works as the first image of a command', async () => {
        assert.equal((await bot.run(`$imageSize[${dataUri(png(9, 9))};width]`)).value, '9');
    });
});

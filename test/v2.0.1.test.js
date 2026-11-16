'use strict';
// Fixes in 2.0.1. Each test fails on 2.0.0 (REFORGE_DIST=<2.0.0 dist> npm test shows it).
//  - an SVG whose size is written in other units or in scientific notation got past limits.maxImagePixels,
//    and a frame made from it allocated a bitmap of that size (1.1 GB for a 120-byte file at 8e3 x 8e3)
//  - frames typed in a command (rgba://, hex://, rgb://, indexed://) that @gifsx/gifsx rejects escaped $try
//  - $setColorOutput with Hex, or a number, escaped $try
//  - a redirect to another host was sent the headers the bot set with $loadImageOptions

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, png, server, esc, TOO_LARGE } = require('./harness');

const LOCAL = { network: { allowPrivateNetwork: ['127.0.0.1'] } };
const svg = (w, h = w) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="10" height="10" fill="red"/></svg>`;
const rssMB = () => process.memoryUsage().rss / 1048576;

test('2.0.1', async (t) => {
    const bot = boot(LOCAL);
    const svgs = await server((req, res) => {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        res.end(svg(decodeURIComponent(req.url.slice(1))));
    });
    t.after(() => svgs.close());

    await t.test('an SVG sized in inches, centimetres, points or scientific notation is checked at its real size', async () => {
        // each is 6000 x 6000 = 36 Mpx, over the 25 Mpx default; 2.0.0 read them as 6, 63, 159, 4500 and 375 pixels
        for (const size of ['6e3', '62.5in', '158.75cm', '4500pt', '375pc']) {
            const r = await bot.run(`$loadImage[x;${esc(svg(size))}]loaded`);
            assert.equal(r.error, TOO_LARGE, `${size}: ${r.error ?? r.value}`);
        }
        // the same forms under the limit still load
        for (const size of ['4e3', '40in']) {
            const r = await bot.run(`$loadImage[x;${esc(svg(size))}]$imageSize[images://x;width]`);
            assert.ok(r.ok, `${size}: ${r.error}`);
        }
    });

    await t.test('a GIF frame from such an SVG is refused before its bitmap is made', async () => {
        const before = rssMB();
        const r = await bot.run(`$newGIFEncoder[g;100;100]$try[$addFrame[g;${svgs.url('/8e3')}]added;$env[e;message];e]`, { timeout: 20000 });
        const grew = rssMB() - before;
        assert.ok(String(r.value).includes(TOO_LARGE), `${r.error ?? r.value} (+${grew | 0} MB)`);
        assert.equal(r.raw, false, 'no error escaped the function');
        assert.ok(grew < 200, `memory grew ${grew | 0} MB (2.0.0: about 1 GB)`);
    });

    await t.test('a frame typed in a command that the GIF library rejects is a normal error that $try catches', async () => {
        const frames = [
            'rgba://2x2:1,2,3',                 // 3 values for 4 pixels
            'rgba://2x2',                       // no data
            'rgba://100000x100000:1',           // over the GIF size limit of the format
            'rgba://NaNxNaN:1',
            'hex://2x2:zz,1,2,3',               // not hex
            'hex://0x0:',
            'rgb://3x1:1,2,3',
            'indexed://2x2:9,9,9,9',            // indexed without a palette
            'rgba://1x1:255,0,0,255'            // a 1x1 frame for a 2x2 GIF
        ];
        for (const frame of frames) {
            const r = await bot.run(`$newGIFEncoder[g;2;2]$try[$addFrame[g;${frame}]added;caught;e]`);
            assert.equal(r.value, 'caught', `${frame}: ${r.error ?? r.value}`);
            assert.equal(r.raw, false, `${frame}: escaped as ${r.error}`);
        }
        // a good frame still goes in
        const ok = await bot.run(`$newGIFEncoder[g;2;2]$addFrame[g;rgba://2x2:${Array(16).fill(255).join(',')}]added`);
        assert.equal(ok.value, 'added', ok.error);
        const pal = await bot.run(`$try[$createFrame[f;rgba://1x1:1,2,3,4;{"palette":[1,2]}]made;caught;e]`);
        assert.equal(pal.raw, false, `palette: escaped as ${pal.error}`);
    });

    await t.test('$setColorOutput takes Rgba and IndexedPixels, and refuses Hex with a normal error', async () => {
        for (const output of ['Rgba', 'IndexedPixels', '0', '1']) {
            const r = await bot.run(`$setColorOutput[;${output}]set`);
            assert.equal(r.value, 'set', `${output}: ${r.error}`);
        }
        const hex = await bot.run('$try[$setColorOutput[;Hex]set;$env[e;message];e]');
        assert.match(String(hex.value), /GIF decoding supports the color outputs Rgba and IndexedPixels/, hex.error ?? hex.value);
        assert.equal(hex.raw, false);
    });

    await t.test('headers the bot set are not sent to another host after a redirect', async () => {
        const IMG = png();
        const seen = [];
        const other = await server((req, res) => { seen.push({ host: 'other', key: req.headers['x-api-key'] }); res.writeHead(200, { 'content-type': 'image/png' }); res.end(IMG) });
        const first = await server((req, res) => {
            seen.push({ host: 'first', url: req.url, key: req.headers['x-api-key'] });
            if (req.url === '/same') { res.writeHead(302, { location: '/img.png' }); return res.end() }
            if (req.url === '/away') { res.writeHead(302, { location: other.url('/img.png') }); return res.end() }
            res.writeHead(200, { 'content-type': 'image/png' }); res.end(IMG);
        });
        t.after(() => Promise.all([other.close(), first.close()]));
        const opts = `$loadImageOptions[false;;;${esc('{"headers":{"x-api-key":"secret"}}')}]`;

        const same = await bot.run(`${opts}$loadImage[a;${first.url('/same')}]ok`);
        assert.equal(same.value, 'ok', same.error);
        assert.deepEqual(seen.map((s) => s.key), ['secret', 'secret'], 'same host: the header is kept');

        seen.length = 0;
        const away = await bot.run(`${opts}$loadImage[a;${first.url('/away')}]ok`);
        assert.equal(away.value, 'ok', away.error);
        assert.deepEqual(seen, [{ host: 'first', url: '/away', key: 'secret' }, { host: 'other', key: undefined }]);
    });
});

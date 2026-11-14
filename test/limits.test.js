'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { boot, pngBomb, dataUri, esc, mod, hardened } = require('./harness');

/** An encoded image of another format whose header is then edited to claim a huge size. */
function hugeHeader(format) {
    const small = createCanvas(4, 4).toBuffer(format === 'jpeg' ? 'image/jpeg' : 'image/webp');
    const b = Buffer.from(small);
    if (format === 'jpeg') {
        for (let i = 2; i < b.length - 9; i++) {
            if (b[i] === 0xff && b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) { b.writeUInt16BE(60000, i + 5); b.writeUInt16BE(60000, i + 7); return b }
        }
        throw new Error('no SOF marker');
    }
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8 ') { b.writeUInt16LE(0x3fff, 26); b.writeUInt16LE(0x3fff, 28) }
    else if (kind === 'VP8L') b.writeUInt32LE((b.readUInt32LE(21) & 0xf0000000) | 0x0fffffff, 21);
    else if (kind === 'VP8X') { b.writeUIntLE(0xffffff, 24, 3); b.writeUIntLE(0xffffff, 27, 3) }
    return b;
}

function gifHeader(w, h) {
    const b = Buffer.alloc(13);
    b.write('GIF89a', 0, 'latin1');
    b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8);
    return Buffer.concat([b, Buffer.from([0x3b])]);
}

const rssMB = () => process.memoryUsage().rss / 1048576;

test('resource limits', async (t) => {
    const bot = boot();

    await t.test('a 190 KB PNG that decodes to 40000x40000 is refused before decoding', async () => {
        const bomb = dataUri(pngBomb(40000, 40000));
        const before = rssMB();
        const r = await bot.run(`$loadImage[x;${bomb}]$createCanvas[c;500;500;$drawImage[c;images://x;0;0;500;500;0]]ok`, { timeout: 30000 });
        const grew = rssMB() - before;
        assert.equal(r.error, 'This source is too large', `${r.error ?? r.value}, ${r.ms} ms, +${grew | 0} MB`);
        assert.ok(r.ms < 1000, `${r.ms} ms`);
        assert.ok(grew < 200, `memory grew ${grew | 0} MB`);
    });

    await t.test('JPEG, WebP, GIF and SVG headers are read the same way', async () => {
        for (const [label, code] of [
            ['jpeg', `$loadImage[x;${dataUri(hugeHeader('jpeg'), 'image/jpeg')}]`],
            ['webp', `$loadImage[x;${dataUri(hugeHeader('webp'), 'image/webp')}]`],
            ['gif', `$loadImage[x;${dataUri(gifHeader(65000, 65000), 'image/gif')}]`],
            ['svg', `$loadImage[x;${esc('<svg xmlns="http://www.w3.org/2000/svg" width="90000" height="90000"></svg>')}]`]
        ]) {
            const r = await bot.run(code, { timeout: 30000 });
            assert.equal(r.error, 'This source is too large', `${label}: ${r.error ?? r.value} (${r.ms} ms)`);
        }
    });

    await t.test('images of a normal size still load', async () => {
        assert.equal((await bot.run(`$loadImage[x;${dataUri(pngBomb(2000, 1000))}]$imageSize[images://x;width]`)).value, '2000');
    });

    await t.test('$createCanvas, $resizeCanvas and $newGIFEncoder are capped (limits.maxCanvasPixels)', async () => {
        assert.equal((await bot.run('$createCanvas[c;16000;16000]')).error, 'This canvas is too large');
        assert.equal((await bot.run('$createCanvas[c;100000;1000]')).error, 'This canvas is too large');
        assert.equal((await bot.run('$createCanvas[c;10;10]$resizeCanvas[c;20000;20000]')).error, 'This canvas is too large');
        assert.equal((await bot.run('$newGIFEncoder[g;20000;20000]')).error, 'This GIF is too large');
        assert.equal((await bot.run('$createCanvas[c;4000;3000]$canvasSize[c;width]')).value, '4000');
        const small = boot({ limits: { maxCanvasPixels: 100 } });
        if (hardened) assert.equal((await small.run('$createCanvas[c;11;10]')).error, 'This canvas is too large');
    });

    await t.test('a GIF stops at limits.maxGifFrames and limits.maxGifPixels', async () => {
        const few = boot({ limits: { maxGifFrames: 3 } });
        const frames = (n) => Array.from({ length: n }, () => '$addFrame[g;canvas://c]').join('');
        assert.equal((await few.run(`$createCanvas[c;10;10]$newGIFEncoder[g;10;10;;${frames(3)}]ok`)).value, 'ok');
        assert.equal((await few.run(`$createCanvas[c;10;10]$newGIFEncoder[g;10;10;;${frames(4)}]`)).error, 'This GIF is too large');
        const pixels = boot({ limits: { maxGifPixels: 250 } });
        assert.equal((await pixels.run(`$createCanvas[c;10;10]$newGIFEncoder[g;10;10;;${frames(3)}]`)).error, 'This GIF is too large');
    });

    await t.test('the 200-frame 1000x1000 GIF (1.7 GB and 5 s on 1.3.1) stops at the default 100 megapixels', async () => {
        const before = rssMB();
        const frames = Array.from({ length: 200 }, () => '$addFrame[g;canvas://c]').join('');
        const r = await bot.run(`$createCanvas[c;1000;1000]$newGIFEncoder[g;1000;1000;;${frames}]ok`, { timeout: 60000 });
        assert.equal(r.error, 'This GIF is too large', `${r.error ?? r.value} in ${r.ms} ms`);
        assert.ok(rssMB() - before < 1200, `memory grew ${(rssMB() - before) | 0} MB`);
    });

    await t.test('one $drawText loads at most limits.maxEmojisPerText emoji images', async (t2) => {
        await mod.registerFonts([{ src: path.join(__dirname, '..', 'assets', 'Twemoji.ttf'), name: 'TestFont' }]);
        let lookups = 0;
        const real = dns.lookup;
        dns.lookup = function (host, options, cb) {
            if (typeof options === 'function') { cb = options; options = {} }
            if (host === 'cdn.discordapp.com') { lookups++; return process.nextTick(() => options?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) }
            return real.call(dns, host, options, cb);
        };
        t2.after(() => { dns.lookup = real });
        const emojis = Array.from({ length: 60 }, (_, i) => `<:e:${100000000000000000n + BigInt(i)}>`).join(' ');
        const capped = boot({ network: { allowPrivateNetwork: ['127.0.0.1'], timeout: 2000 }, limits: { maxEmojisPerText: 10 } });
        await capped.run(`$createCanvas[c;200;50;$drawText[c;fill;${esc(emojis)};20px TestFont;#ffffff;0;20;;;;;;true]]`, { timeout: 10000 });
        assert.ok(lookups <= 10, `${lookups} emoji requests for 60 emojis`);
    });
});

'use strict';

// Many loads at once, spam, and memory that must stay bounded.

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, png, server, NOT_ALLOWED } = require('./harness');

const rssMB = () => process.memoryUsage().rss / 1048576;
const settle = async () => { for (let i = 0; i < 3; i++) { global.gc?.(); await new Promise((r) => setTimeout(r, 20)) } };

test('concurrency, spam and memory', async (t) => {
    const img = png(32, 32);
    const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(img) });
    t.after(() => srv.close());
    const local = boot({ network: { allowPrivateNetwork: ['127.0.0.1'] } });
    const strict = boot();

    await t.test('100 loads at once all succeed', async () => {
        const runs = await Promise.all(Array.from({ length: 100 }, (_, i) => local.run(`$imageSize[${srv.url(`/a/${i}.png`)};width]`, { timeout: 20000 })));
        assert.deepEqual([...new Set(runs.map((r) => r.value))], ['32'], runs.find((r) => !r.ok)?.error ?? '');
    });

    await t.test('200 refused loads at once: all refused, none reaches the network', async () => {
        const before = srv.hits.length;
        const runs = await Promise.all(Array.from({ length: 200 }, (_, i) => strict.run(`$imageSize[${srv.url(`/b/${i}.png`)}]`)));
        assert.deepEqual([...new Set(runs.map((r) => r.error))], [NOT_ALLOWED]);
        assert.equal(srv.hits.length, before);
    });

    await t.test('1000 refusals in a row stay fast and do not grow memory', async () => {
        await settle();
        const before = rssMB();
        const started = Date.now();
        for (let i = 0; i < 1000; i++) await strict.run(`$try[$loadImage[x;http://169.254.169.254/${i}];no]`);
        await settle();
        const grew = rssMB() - before;
        assert.ok(Date.now() - started < 20000, `${Date.now() - started} ms`);
        assert.ok(grew < 100, `memory grew ${grew | 0} MB`);
    });

    await t.test('canvases are freed after each command (300 commands with a 1000x1000 canvas)', async () => {
        await settle();
        const before = rssMB();
        for (let i = 0; i < 300; i++) {
            const r = await local.run('$createCanvas[c;1000;1000;$drawRect[c;fill;#ff0000;0;0;1000;1000;0]]$attachCanvas[c]ok');
            assert.equal(r.value, 'ok', r.error);
        }
        await settle();
        const grew = rssMB() - before;
        assert.ok(grew < 400, `memory grew ${grew | 0} MB for 300 x 4 MB canvases`);
    });

    await t.test('GIF encoders are freed: memory levels off instead of growing (4 rounds of 60 commands with 20 frames)', async () => {
        // the first commands raise RSS by a few hundred MB that the native allocator keeps (measured: about
        // +400 MB after 60 commands, then flat up to 480); a leak would keep growing round after round
        const frames = Array.from({ length: 20 }, () => '$addFrame[g;canvas://c]').join('');
        const after = [];
        for (let round = 0; round < 4; round++) {
            for (let i = 0; i < 60; i++) assert.equal((await local.run(`$createCanvas[c;200;200]$newGIFEncoder[g;200;200;;${frames}]$attachGIF[g]ok`)).value, 'ok');
            await settle();
            after.push(rssMB());
        }
        assert.ok(after[3] - after[1] < 100, `RSS after each round: ${after.map((x) => x | 0).join(', ')} MB`);
    });

    await t.test('the global image cache stays at cache.maxImages under a flood of distinct emojis', async () => {
        const bot = boot({ network: { allowPrivateNetwork: ['127.0.0.1'] }, cache: { maxImages: 50 } });
        await Promise.all(Array.from({ length: 1000 }, (_, i) => bot.client.preloadImages.tryGet(`cache_emoji_${i}`, srv.url(`/e/${i}.png`))));
        assert.ok(bot.client.preloadImages.map.size <= 50, `size ${bot.client.preloadImages.map.size}`);
    });
});

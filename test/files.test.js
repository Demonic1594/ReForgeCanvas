'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { png, makeBot, makeCtx, call, tmpdir, mod, NOT_ALLOWED } = require('./helpers');

function lottie(u, p) {
    return JSON.stringify({
        v: '5.7.0', fr: 1, ip: 0, op: 1, w: 4, h: 4,
        assets: u === undefined ? [] : [{ id: 'i', w: 4, h: 4, u, p, e: 0 }],
        layers: u === undefined ? [] : [{ ty: 2, refId: 'i', ind: 1, ip: 0, op: 1, st: 0,
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } } }]
    });
}

function canvasCtx(bot) {
    const ctx = makeCtx(bot);
    const canvas = new mod.CanvasBuilder(4, 4);
    ctx.canvasManager = { getOrCurrent: () => canvas, get: () => canvas };
    return ctx;
}

test('local files', async t => {
    const root = tmpdir();
    const assets = path.join(root, 'assets');
    const outside = path.join(root, 'private');
    const out = path.join(root, 'out');
    for (const d of [assets, outside, out]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(assets, 'bg.png'), png());
    fs.writeFileSync(path.join(outside, 'secret.png'), png());
    fs.writeFileSync(path.join(outside, 'anim.json'), lottie());
    fs.writeFileSync(path.join(assets, 'anim.json'), lottie());
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(assets, 'link.png'));
    const victim = path.join(outside, 'victim.png');
    fs.writeFileSync(victim, 'keep');
    fs.symlinkSync(victim, path.join(out, 'link.png'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const readBot = () => makeBot({ files: { read: assets } });

    await t.test('local reads are off by default', async () => {
        const r = await call('image/loadImage.js', makeCtx(makeBot()), ['a', path.join(assets, 'bg.png')]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('files.read allows that folder only', async () => {
        const ok = await call('image/loadImage.js', makeCtx(readBot()), ['a', path.join(assets, 'bg.png')]);
        assert.equal(ok.ok, true, ok.error);
        for (const p of [path.join(outside, 'secret.png'), path.join(assets, '..', 'private', 'secret.png'), path.join(assets, 'link.png')]) {
            const r = await call('image/loadImage.js', makeCtx(readBot()), ['a', p]);
            assert.equal(r.error, NOT_ALLOWED, p);
        }
    });

    await t.test('a missing file and a refused file look the same to the user outside the folder', async () => {
        const r = await call('image/loadImage.js', makeCtx(readBot()), ['a', path.join(outside, 'nope.png')]);
        assert.equal(r.error, NOT_ALLOWED);
    });

    await t.test('$imageSize, $newGIFDecoder and $drawImage use the same rule', async () => {
        const p = path.join(outside, 'secret.png');
        assert.equal((await call('image/imageSize.js', makeCtx(readBot()), [p, null])).error, NOT_ALLOWED);
        assert.equal((await call('gif/newGIFDecoder.js', makeCtx(readBot()), ['g', p, null])).error, NOT_ALLOWED);
        assert.equal((await call('drawing/drawImage.js', canvasCtx(readBot()), [null, p, 0, 0, null, null, []])).error, NOT_ALLOWED);
    });

    await t.test('$loadLottieAnimation reads paths only inside files.read', async () => {
        const off = await call('lottie/loadLottieAnimation.js', makeCtx(makeBot()), ['l', path.join(outside, 'anim.json'), null]);
        assert.equal(off.error, NOT_ALLOWED);
        const ok = await call('lottie/loadLottieAnimation.js', makeCtx(readBot()), ['l', path.join(assets, 'anim.json'), null]);
        assert.equal(ok.ok, true, ok.error);
        const json = await call('lottie/loadLottieAnimation.js', makeCtx(makeBot()), ['l', lottie(), null]);
        assert.equal(json.ok, true, json.error);
    });

    await t.test('$loadLottieAnimation keeps resourcePath and its assets inside files.read', async () => {
        const out1 = await call('lottie/loadLottieAnimation.js', makeCtx(readBot()), ['l', lottie('', 'bg.png'), outside]);
        assert.equal(out1.error, NOT_ALLOWED);
        const escape = await call('lottie/loadLottieAnimation.js', makeCtx(readBot()), ['l', lottie('../private/', 'secret.png'), assets]);
        assert.equal(escape.error, NOT_ALLOWED);
        const ok = await call('lottie/loadLottieAnimation.js', makeCtx(readBot()), ['l', lottie('', 'bg.png'), assets]);
        assert.equal(ok.ok, true, ok.error);
    });

    await t.test('writes are off by default', async () => {
        const target = path.join(out, 'a.png');
        const r = await call('canvas/saveCanvas.js', canvasCtx(makeBot()), [null, target, null]);
        assert.equal(r.error, NOT_ALLOWED);
        assert.equal(fs.existsSync(target), false);
    });

    await t.test('files.write allows that folder only, and never follows a link', async () => {
        const bot = makeBot({ files: { write: out } });
        const ok = await call('canvas/saveCanvas.js', canvasCtx(bot), [null, path.join(out, 'a.png'), null]);
        assert.equal(ok.ok, true, ok.error);
        assert.ok(fs.statSync(path.join(out, 'a.png')).size > 0);

        const escape = path.join(out, '..', 'private', 'x.png');
        assert.equal((await call('canvas/saveCanvas.js', canvasCtx(bot), [null, escape, null])).error, NOT_ALLOWED);
        assert.equal(fs.existsSync(escape), false);

        assert.equal((await call('canvas/saveCanvas.js', canvasCtx(bot), [null, path.join(out, 'link.png'), null])).error, NOT_ALLOWED);
        assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
    });

    await t.test('$saveCanvas to images:// still works without files.write', async () => {
        const ctx = canvasCtx(makeBot());
        const r = await call('canvas/saveCanvas.js', ctx, [null, 'images://snap', null]);
        assert.equal(r.ok, true, r.error);
        assert.equal(ctx.imageManager.get('snap').width, 4);
    });

    await t.test('$saveEncoder follows files.write too', async () => {
        const { Encoder } = require('@gifsx/gifsx');
        const ctx = makeCtx(makeBot());
        ctx.gifManager = { getEncoderOrCurrent: () => new Encoder(4, 4) };
        const target = path.join(out, 'a.gif');
        assert.equal((await call('gif/saveEncoder.js', ctx, [null, target])).error, NOT_ALLOWED);
        assert.equal(fs.existsSync(target), false);
    });
});

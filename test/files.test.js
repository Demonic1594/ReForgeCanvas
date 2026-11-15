'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, png, tmpdir, esc, hardened, NOT_ALLOWED } = require('./harness');

function lottie(u, p) {
    return JSON.stringify({
        v: '5.7.0', fr: 1, ip: 0, op: 1, w: 4, h: 4,
        assets: u === undefined ? [] : [{ id: 'i', w: 4, h: 4, u, p, e: 0 }],
        layers: u === undefined ? [] : [{ ty: 2, refId: 'i', ind: 1, ip: 0, op: 1, st: 0,
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } } }]
    });
}

test('local files in a folder', async (t) => {
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

    const off = boot();
    const reader = boot({ files: { read: assets } });
    const writer = boot({ files: { write: out } });

    await t.test('local reads are off by default, and the log says how to turn them on', async () => {
        const r = await off.run(`$loadImage[a;${path.join(assets, 'bg.png')}]`);
        assert.equal(r.error, NOT_ALLOWED);
        if (hardened) assert.ok(r.logs.some((l) => l.includes('files: { read: "./assets" }')), r.logs.join('\n'));
    });

    await t.test('files.read allows that folder only', async () => {
        assert.equal((await reader.run(`$loadImage[a;${path.join(assets, 'bg.png')}]$imageSize[images://a;width]`)).value, '4');
        for (const p of [path.join(outside, 'secret.png'), path.join(assets, '..', 'private', 'secret.png'), path.join(assets, 'link.png'), path.join(outside, 'nope.png')])
            assert.equal((await reader.run(`$loadImage[a;${p}]`)).error, NOT_ALLOWED, p);
    });

    await t.test('$imageSize, $newGIFDecoder and $drawImage follow the same rule', async () => {
        const p = path.join(outside, 'secret.png');
        assert.equal((await reader.run(`$imageSize[${p}]`)).error, NOT_ALLOWED);
        assert.equal((await reader.run(`$newGIFDecoder[g;${p}]`)).error, NOT_ALLOWED);
        assert.equal((await reader.run(`$createCanvas[c;4;4;$drawImage[c;${p};0;0;4;4;0]]`)).error, NOT_ALLOWED);
    });

    await t.test('$loadLottieAnimation reads paths only inside files.read', async () => {
        assert.equal((await off.run(`$loadLottieAnimation[l;${path.join(outside, 'anim.json')}]`)).error, NOT_ALLOWED);
        assert.equal((await reader.run(`$loadLottieAnimation[l;${path.join(assets, 'anim.json')}]ok`)).value, 'ok');
        assert.equal((await off.run(`$loadLottieAnimation[l;${esc(lottie())}]ok`)).value, 'ok');
    });

    await t.test('$loadLottieAnimation keeps resourcePath and its assets inside files.read', async () => {
        assert.equal((await reader.run(`$loadLottieAnimation[l;${esc(lottie('', 'bg.png'))};${outside}]`)).error, NOT_ALLOWED);
        assert.equal((await reader.run(`$loadLottieAnimation[l;${esc(lottie('../private/', 'secret.png'))};${assets}]`)).error, NOT_ALLOWED);
        assert.equal((await reader.run(`$loadLottieAnimation[l;${esc(lottie('', 'bg.png'))};${assets}]ok`)).value, 'ok');
    });

    await t.test('writes are off by default', async () => {
        const target = path.join(out, 'a.png');
        assert.equal((await off.run(`$createCanvas[c;4;4]$saveCanvas[c;${target}]`)).error, NOT_ALLOWED);
        assert.equal(fs.existsSync(target), false);
    });

    await t.test('files.write allows that folder only, and never follows a link', async () => {
        assert.equal((await writer.run(`$createCanvas[c;4;4]$saveCanvas[c;${path.join(out, 'a.png')}]ok`)).value, 'ok');
        assert.ok(fs.statSync(path.join(out, 'a.png')).size > 0);
        const escape = path.join(out, '..', 'private', 'x.png');
        assert.equal((await writer.run(`$createCanvas[c;4;4]$saveCanvas[c;${escape}]`)).error, NOT_ALLOWED);
        assert.equal(fs.existsSync(escape), false);
        assert.equal((await writer.run(`$createCanvas[c;4;4]$saveCanvas[c;${path.join(out, 'link.png')}]`)).error, NOT_ALLOWED);
        assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
    });

    await t.test('$saveCanvas to images:// works without files.write', async () => {
        assert.equal((await off.run('$createCanvas[c;4;4]$saveCanvas[c;images://snap]$imageSize[images://snap;width]')).value, '4');
    });

    await t.test('$saveEncoder follows files.write too', async () => {
        const target = path.join(out, 'a.gif');
        assert.equal((await off.run(`$newGIFEncoder[g;4;4]$saveEncoder[g;${target}]`)).error, NOT_ALLOWED);
        assert.equal(fs.existsSync(target), false);
    });
});

test('files.read: true and files.write: true (the bot folder, guarded)', { skip: !hardened && 'ReForgeCanvas option' }, async (t) => {
    const bot = tmpdir('rfc-bot-');
    const outside = tmpdir('rfc-out-');
    fs.mkdirSync(path.join(bot, 'assets'));
    fs.mkdirSync(path.join(bot, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(bot, '.git'));
    fs.writeFileSync(path.join(bot, 'assets', 'bg.png'), png());
    fs.writeFileSync(path.join(bot, 'top.png'), png());
    fs.writeFileSync(path.join(bot, '.env'), 'DISCORD_TOKEN=secret');
    fs.writeFileSync(path.join(bot, 'node_modules', 'pkg', 'logo.png'), png());
    fs.writeFileSync(path.join(bot, '.git', 'x.png'), png());
    fs.writeFileSync(path.join(bot, 'index.js'), 'console.log(1)');
    fs.writeFileSync(path.join(bot, 'a.png.db'), png());
    fs.writeFileSync(path.join(bot, 'data.png'), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]));
    fs.writeFileSync(path.join(outside, 'secret.png'), png());
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(bot, 'assets', 'out.png'));
    fs.symlinkSync(path.join(bot, '.env'), path.join(bot, 'assets', 'env.png'));
    const cwd = process.cwd();
    process.chdir(bot);
    t.after(() => { process.chdir(cwd); fs.rmSync(bot, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }) });

    const { logs } = require('./harness');
    const from = logs.length;
    const guarded = boot({ files: { read: true, write: true } });

    await t.test('a one-time warning recommends a folder of its own', () => {
        const warned = logs.slice(from).filter((l) => l.text.includes('files.read: true'));
        assert.equal(warned.length, 1);
        assert.match(warned[0].text, /^\[ReForgeCanvas\] .*files: \{ read: "\.\/assets"/);
        boot({ files: { read: true } });
        assert.equal(logs.slice(from).filter((l) => l.text.includes('files.read: true')).length, 1, 'only once per process');
    });

    await t.test('images in the bot folder load', async () => {
        assert.equal((await guarded.run('$imageSize[./assets/bg.png;width]')).value, '4');
        assert.equal((await guarded.run('$imageSize[./top.png;width]')).value, '4');
    });

    await t.test('the guards refuse what the folder must not give away', async () => {
        for (const p of ['./.env', './index.js', './node_modules/pkg/logo.png', './.git/x.png', './a.png.db', './data.png',
            './assets/out.png', './assets/env.png', '../' + path.basename(outside) + '/secret.png', path.join(outside, 'secret.png')]) {
            const r = await guarded.run(`$imageSize[${p}]`);
            assert.equal(r.error, NOT_ALLOWED, p);
        }
    });

    await t.test('writes: images only, never hidden files or node_modules', async () => {
        assert.equal((await guarded.run('$createCanvas[c;4;4]$saveCanvas[c;./card.png]ok')).value, 'ok');
        assert.ok(fs.existsSync(path.join(bot, 'card.png')));
        for (const p of ['./index.js', './.hidden.png', './node_modules/x.png', './x.db', '../x.png']) {
            assert.equal((await guarded.run(`$createCanvas[c;4;4]$saveCanvas[c;${p}]`)).error, NOT_ALLOWED, p);
        }
        assert.equal(fs.readFileSync(path.join(bot, 'index.js'), 'utf8'), 'console.log(1)');
    });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ForgeClient, ForgeExtension } = require('@tryforge/forgescript');
const { boot, png, server, mod, hardened, logs } = require('./harness');

test('extension', { skip: !hardened && 'the original build is not renamed' }, async (t) => {
    const pkg = require('../package.json');

    await t.test('package, class and extension names', () => {
        assert.equal(pkg.name, '@tryforge/reforge.canvas');
        assert.equal(typeof mod.ReForgeCanvas, 'function');
        assert.equal(mod.ForgeCanvas, undefined, 'ForgeCanvas is no longer exported');
        assert.equal(new mod.ReForgeCanvas().name, 'reforge.canvas');
        assert.equal(mod.version, pkg.version);
        assert.equal(pkg.engines.node, '>=18.17');
    });

    await t.test('no public export, type or option keeps a ForgeCanvas-only name', () => {
        // everything a TypeScript or JavaScript user can name: runtime exports and the declarations in dist/
        const fs = require('node:fs'), path = require('node:path');
        const names = new Set(Object.keys(mod));
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
            const f = path.join(dir, e.name);
            if (e.isDirectory()) return walk(f);
            if (!f.endsWith('.d.ts')) return;
            const src = fs.readFileSync(f, 'utf8');
            for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:const\s+enum|enum|class|interface|type|function|const|let|var|abstract\s+class)\s+(\w+)/g)) names.add(m[1]);
            for (const m of src.matchAll(/^\s+(\w+)\??:/gm)) names.add(m[1]); // option and member names
        });
        walk(require('./harness').DIST);
        assert.ok(names.has('ReForgeCanvas') && names.has('ReForgeCanvasError') && names.has('IReForgeCanvasOptions'));
        assert.deepEqual([...names].filter((n) => /forge_?canvas/i.test(n) && !/^(I)?ReForgeCanvas/.test(n)), []);
    });

    await t.test('ForgeCanvas next to ReForgeCanvas stops the client at start-up, in either order', () => {
        class StandIn extends ForgeExtension { name = 'forge.canvas'; description = ''; version = '1.3.1'; init() {} }
        for (const extensions of [[new mod.ReForgeCanvas(), new StandIn()], [new StandIn(), new mod.ReForgeCanvas()]])
            assert.throws(() => new ForgeClient({ intents: ['Guilds'], extensions }), /^Error: \[ReForgeCanvas\] ForgeCanvas \(@tryforge\/forge\.canvas\) cannot be loaded next to ReForgeCanvas/);
    });

    await t.test('wrong options throw from the constructor, with the prefix', () => {
        for (const options of [{ logLevel: 'loud' }, { files: { read: 5 } }, { network: { timeout: -1 } }, { network: { allowPrivateNetwork: ['not-an-ip'] } },
            { network: { allowedHosts: 'example.com' } }, { limits: { maxCanvasPixels: 'big' } }, { cache: { maxImages: -5 } }])
            assert.throws(() => new mod.ReForgeCanvas(options), /^TypeError: \[ReForgeCanvas\] /, JSON.stringify(options));
    });

    await t.test('the documented defaults', () => {
        const env = process.env.REFORGECANVAS_LOG_LEVEL;
        delete process.env.REFORGECANVAS_LOG_LEVEL;
        let p;
        try { p = new mod.ReForgeCanvas().policy } finally { if (env !== undefined) process.env.REFORGECANVAS_LOG_LEVEL = env }
        assert.deepEqual({ ...p.network, allowedHosts: [...p.network.allowedHosts], privateAddresses: [...p.network.privateAddresses] },
            { enabled: true, timeout: 10000, maxBytes: 10485760, maxRedirects: 5, allowedHosts: [], allowPrivateNetwork: false, privateAddresses: [] });
        assert.deepEqual({ ...p.files }, { read: null, write: null, readGuarded: false, writeGuarded: false });
        assert.deepEqual({ ...p.fonts }, { maxDepth: 3, maxFiles: 100 });
        assert.deepEqual({ ...p.cache }, { maxImages: 500 });
        assert.deepEqual({ ...p.limits }, { maxCanvasPixels: 25000000, maxImagePixels: 25000000, maxGifFrames: 300, maxGifPixels: 100000000, maxEmojisPerText: 50 });
        assert.equal(p.logLevel, 'info', 'the same default as ReForgeDB, ReForgeTopGG and ReForgeGiveaways');
    });
});

test('logging', { skip: !hardened && 'ReForgeCanvas option' }, async (t) => {
    const srv = await server((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png()) });
    t.after(() => srv.close());
    const local = { allowPrivateNetwork: ['127.0.0.1'] };

    await t.test('debug shows each load (host and path, bytes, ms) and a cache hit, never the query string', async () => {
        const bot = boot({ logLevel: 'debug', network: local });
        const r = await bot.run(`$imageSize[${srv.url('/card.png?token=SECRET123')};width]`);
        assert.equal(r.value, '4', r.error);
        const line = r.logs.find((l) => l.includes('fetched'));
        assert.match(line, /\[ReForgeCanvas\] fetched http:\/\/127\.0\.0\.1:\d+\/card\.png: \d+ bytes in \d+ ms/);
        assert.ok(!r.logs.join('\n').includes('SECRET123'), 'no query string in the log');
        await bot.client.preloadImages.tryGet('cache_emoji_1', srv.url('/e.png?token=SECRET123'));
        const from = logs.length;
        await bot.client.preloadImages.tryGet('cache_emoji_1', srv.url('/e.png?token=SECRET123'));
        assert.ok(logs.slice(from).some((l) => l.text === '[ReForgeCanvas] cache hit: cache_emoji_1'));
    });

    await t.test('at the default level (info): one start-up line, nothing for successful image commands, one warn line for a refusal', async () => {
        const env = process.env.REFORGECANVAS_LOG_LEVEL;
        delete process.env.REFORGECANVAS_LOG_LEVEL;
        try {
            let from = logs.length;
            const bot = boot({ network: local });
            const ours = () => logs.slice(from).filter((l) => l.text.startsWith('[ReForgeCanvas]'));
            const start = ours();
            assert.equal(start.length, 1, JSON.stringify(start));
            assert.equal(start[0].level, 'info');
            assert.match(start[0].text, /^\[ReForgeCanvas\] \d+\.\d+\.\d+ started: network on \(10000 ms, 10485760 bytes, 5 redirects.*files\.read off, files\.write off, log level info$/);
            from = logs.length;
            assert.equal((await bot.run(`$preloadImage[bg;${srv.url('/bg.png')}]`)).error, null);
            for (let i = 0; i < 5; i++) {
                const r = await bot.run(`$createCanvas[c;64;64;$drawImage[c;${srv.url(`/a${i}.png`)};0;0;64;64;0]$drawImage[c;preload://bg;0;0;8;8;0]]$attachCanvas[c]ok`);
                assert.equal(r.value, 'ok', r.error);
            }
            assert.deepEqual(ours().map((l) => l.text), [], 'nothing per image or per command');
            from = logs.length;
            await bot.run('$try[$loadImage[x;http://169.254.169.254/x];no]');
            assert.deepEqual(ours().map((l) => `${l.level}: ${l.text}`), ['warn: [ReForgeCanvas] $loadImage: NOT_ALLOWED 169.254.169.254 is a non-public address']);
        } finally { if (env !== undefined) process.env.REFORGECANVAS_LOG_LEVEL = env }
    });

    await t.test('silent prints nothing; REFORGECANVAS_LOG_LEVEL is the default when logLevel is not given', async () => {
        const quiet = boot({ logLevel: 'silent' });
        const r = await quiet.run('$try[$loadImage[x;http://127.0.0.1/a.png];no]');
        assert.deepEqual(r.logs.filter((l) => l.includes('[ReForgeCanvas]')), []);
        process.env.REFORGECANVAS_LOG_LEVEL = 'error';
        try { assert.equal(new mod.ReForgeCanvas().policy.logLevel, 'error') } finally { delete process.env.REFORGECANVAS_LOG_LEVEL }
        assert.equal(new mod.ReForgeCanvas({ logLevel: 'info' }).policy.logLevel, 'info');
    });

    await t.test('every line ReForgeCanvas printed during the tests starts with [ReForgeCanvas]', () => {
        // ForgeScript's own lines: errors it formats, extension loading, and its notice that a second client re-registers the functions
        const ours = logs.filter((l) => !/^> \*\*`/.test(l.text) && !/^Extension .* has been loaded!/.test(l.text) && !/^\S+ \| Attempted to override/.test(l.text));
        const bad = ours.filter((l) => !l.text.startsWith('[ReForgeCanvas]'));
        assert.deepEqual(bad.map((l) => l.text).slice(0, 5), []);
        assert.ok(ours.length > 0);
    });

    await t.test('component files are logged with the prefix', () => {
        assert.throws(() => mod.ReForgeCanvas.components.load('/no/such/folder', true), /\[ReForgeCanvas\] Component \/no\/such\/folder does not exist/);
    });
});

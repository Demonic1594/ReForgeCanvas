'use strict';

// Inputs on which @gifsx/gifsx's Rust code panics or tries a huge allocation. Either one aborts the whole
// Node.js process (the bot goes offline, $try cannot help), so each case runs in a child process: the test
// checks that the process survives and that $try catches the error.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DIST, boot } = require('./harness');

function runIsolated(code) {
    const script = `const { boot } = require(${JSON.stringify(path.join(__dirname, 'harness.js'))});
boot().run(${JSON.stringify(code)}, { timeout: 15000 }).then((r) => { process.stdout.write('RESULT ' + JSON.stringify(r)); process.exit(0) });`;
    const p = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000, env: { ...process.env, REFORGE_DIST: DIST } });
    const out = /RESULT (.*)$/s.exec(p.stdout);
    const why = /panicked at [^\n]*\n([^\n]*)/.exec(p.stderr)?.[1] ?? /memory allocation[^\n]*/.exec(p.stderr)?.[0] ?? '';
    return { died: !out, signal: p.signal, why, result: out ? JSON.parse(out[1]) : null };
}

const cases = [
    ['$newNeuQuant with 0 colors', '$newNeuQuant[n;1;0;[1,2,3,4\\]]'],
    ['$newNeuQuant with sample factor 0', '$newNeuQuant[n;0;256;[1,2,3,4,5,6,7,8\\]]'],
    ['$newNeuQuant with -1 colors (a 137 GB allocation)', '$newNeuQuant[n;1;-1;[1,2,3,4\\]]'],
    ['$newNeuQuant with sample factor 4294967296', '$newNeuQuant[n;4294967296;256;[1,2,3,4\\]]'],
    ['$indexedToRgba with a pixel outside the palette', '$indexedToRgba[[1,2,3\\];0;9]'],
    ['$indexedToRgba with a palette that is not RGB triples', '$indexedToRgba[[1,2\\];0;0]'],
    ['$indexedToHex with an empty palette', '$indexedToHex[[\\];0;false;false;0]'],
    ['drawing an indexed frame that has no palette', '$createFrame[f;indexed://1x1:0]$createCanvas[c;4;4;$drawImage[c;frame://f;0;0]]'],
];

test('native panics in @gifsx/gifsx are refused before they abort the process', async (t) => {
    for (const [name, code] of cases) {
        await t.test(name, () => {
            const r = runIsolated(`$try[${code};CAUGHT]`);
            assert.equal(r.died, false, `the bot process died (${r.signal}): ${r.why}`);
            assert.equal(r.result.value, 'CAUGHT', JSON.stringify(r.result));
        });
    }
});

test('the quantizer and indexed colours still work with valid input', async (t) => {
    const bot = boot();
    await t.test('$newNeuQuant with 256 colors, then $NQindexOf', async () => {
        assert.equal((await bot.run('$newNeuQuant[n;10;256;[1,2,3,4\\]]$NQindexOf[n;1;2;3;4]')).value, '1');
    });
    await t.test('$newNeuQuant with more than 256 colors is refused (65536 took 19 s of CPU on 100,000 pixels)', async () => {
        const r = await bot.run('$newNeuQuant[n;1;65536;[1,2,3,4\\]]');
        assert.match(r.error ?? '', /from 1 to 256/);
    });
    await t.test('$indexedToRgba maps indexes through the palette', async () => {
        assert.equal((await bot.run('$indexedToRgba[[255,0,0,0,0,255\\];0;0;1]')).value, '[255, 0, 0, 255, 0, 0, 255, 255]');
    });
    await t.test('$indexedToHex and $indexedToRgba with the optional arguments left empty (1.3.1: "Failed to convert napi value")', async () => {
        // with no transparent index gifsx itself returns alpha 0 for every pixel (kept as it is)
        const hex = await bot.run('$indexedToHex[[255,0,0\\];;;;0]');
        assert.equal(hex.value, '["#FF000000"]', hex.error ?? '');
        const rgba = await bot.run('$indexedToRgba[[255,0,0\\];;0]');
        assert.equal(rgba.value, '[255, 0, 0, 0]', rgba.error ?? '');
    });
});

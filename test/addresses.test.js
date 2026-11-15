'use strict';

// The address check, cross-checked against ipaddr.js (a dev dependency only) over a fixed list of
// special addresses and a seeded random sample of every special range.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mod, hardened } = require('./harness');

test('address check against ipaddr.js', { skip: !hardened && 'ReForgeCanvas function' }, async (t) => {
    const ipaddr = require('ipaddr.js');
    // categories ipaddr.js blocks as a whole; ReForgeCanvas looks at the IPv4 address inside instead
    const EMBEDDED = new Set(['ipv4Mapped', 'rfc6052', '6to4']);

    function embeddedV4(a) {
        const p = ipaddr.parse(a);
        const range = p.range();
        if (range === 'ipv4Mapped') return p.toIPv4Address().toString();
        const parts = p.parts;
        if (range === 'rfc6052') return ipaddr.fromByteArray([parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255]).toString();
        if (range === '6to4') return ipaddr.fromByteArray([parts[1] >> 8, parts[1] & 255, parts[2] >> 8, parts[2] & 255]).toString();
        return null;
    }

    function check(a) {
        const range = ipaddr.parse(a).range();
        const mine = mod.isBlockedAddress(a);
        if (range === 'unicast') return mine ? `${a}: ReForgeCanvas blocks, ipaddr.js says public` : null;
        if (EMBEDDED.has(range)) {
            const v4 = embeddedV4(a);
            const v4Blocked = ipaddr.parse(v4).range() !== 'unicast';
            return mine === v4Blocked ? null : `${a} (${range}, inside ${v4}): ReForgeCanvas ${mine ? 'blocks' : 'allows'}`;
        }
        return mine ? null : `${a}: ipaddr.js says ${range}, ReForgeCanvas allows`;
    }

    await t.test('fixed list', () => {
        const list = ['127.0.0.1', '0.0.0.0', '0.1.2.3', '10.0.0.5', '100.64.0.1', '100.127.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
            '192.168.1.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
            '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '64:ff9b::808:808',
            '64:ff9b:1::1', '2002:7f00:1::', '2002:808:808::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '100::1',
            '1.1.1.1', '8.8.8.8', '93.184.215.14', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'];
        assert.deepEqual(list.map(check).filter(Boolean), []);
    });

    await t.test('the old IPv4-compatible form of 127.0.0.1 is blocked (ipaddr.js calls it public)', () => {
        assert.equal(mod.isBlockedAddress('::7f00:1'), true);
        assert.equal(ipaddr.parse('::7f00:1').range(), 'unicast');
    });

    await t.test('a seeded sample of every special range (FUZZ_SEED to replay)', () => {
        let seed = Number(process.env.FUZZ_SEED ?? 20261114) >>> 0;
        const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 };
        const v4 = [[0, 8], [10, 8], [100 << 24 | 64 << 16, 10], [127, 8], [169 << 24 | 254 << 16, 16], [172 << 24 | 16 << 16, 12], [192 << 24 | 168 << 16, 16], [224, 4], [240, 4]];
        const problems = [];
        for (let i = 0; i < 3000; i++) {
            const [base, bits] = v4[i % v4.length];
            const net = base < 256 ? base << 24 : base;
            const ip = ((net >>> 0) + Math.floor(rand() * 2 ** (32 - bits))) >>> 0;
            const a = [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.');
            const p = check(a); if (p) problems.push(p);
            const mapped = `::ffff:${a}`; const q = check(mapped); if (q) problems.push(q);
        }
        for (let i = 0; i < 2000; i++) {
            const rnd = () => Math.floor(rand() * 65536).toString(16);
            const pick = ['fc', 'fd', 'fe8', 'fe9', 'fea', 'feb', 'ff0', '2001:db8', '64:ff9b:1'][i % 9];
            const a = pick.length <= 3 ? `${pick}${rnd().padStart(4, '0').slice(pick.length)}:${rnd()}::${rnd()}` : `${pick}::${rnd()}`;
            const p = check(a); if (p) problems.push(p);
        }
        for (let i = 0; i < 2000; i++) { // public-looking random addresses: both must agree too
            const a = Array.from({ length: 4 }, () => Math.floor(rand() * 256)).join('.');
            const p = check(a); if (p) problems.push(p);
        }
        assert.deepEqual(problems.slice(0, 10), []);
    });
});

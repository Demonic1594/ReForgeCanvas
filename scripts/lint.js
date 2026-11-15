#!/usr/bin/env node
/*
 * Project lint (no extra dependencies). Fails when:
 *  - a source file lacks the SPDX licence header;
 *  - code outside src/structures/loader.ts loads images, fetches or touches files directly,
 *    so every source a user can name goes through the one shared loader;
 *  - undici is imported (it is not a declared dependency; the loader uses node:http/https);
 *  - an en dash, em dash or horizontal bar (U+2013 to U+2015) appears in sources, tests or docs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const problems = [];

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const rel = f => path.relative(root, f).split(path.sep).join('/');
const src = walk(path.join(root, 'src')).filter(f => f.endsWith('.ts'));

// Files allowed to do their own I/O: the loader itself, the component loader (bot owner's own
// command files), build scripts and the manual Discord test bot.
const IO_ALLOWED = new Set(['src/structures/loader.ts', 'src/classes/manager.ts', 'src/@build/license.ts', 'src/docgen.ts']);
const DIRECT_IO = [
    [/\bfrom ['"]undici['"]|require\(['"]undici['"]\)/, 'imports undici (not a dependency; use the loader)'],
    [/\bimport\s*\{[^}]*\bloadImage\b[^}]*\}\s*from\s*['"]@napi-rs\/canvas['"]/, 'imports loadImage from @napi-rs/canvas (use loadImageFrom / ImageManager.load)'],
    [/\b(readFileSync|writeFileSync|readFile|writeFile|createReadStream|createWriteStream|existsSync|readdirSync)\s*\(/, 'touches the file system directly (use readLocal / writeLocal)'],
    [/\bfetch\s*\(|\bhttps?\.(get|request)\s*\(/, 'makes a network request directly (use fetchBytes / loadSource)']
];

for (const file of src) {
    const name = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    if (!/^\/\*\s*\n\* SPDX-License-Identifier: LGPL-3\.0-or-later/.test(text)) problems.push(`${name}: missing SPDX licence header`);
    if (IO_ALLOWED.has(name) || name.startsWith('src/__tests__/')) continue;
    // saveCanvas legitimately calls loadImage on a canvas it just encoded (bytes, not user text)
    for (const [re, why] of DIRECT_IO) {
        if (name === 'src/functions/canvas/saveCanvas.ts' && why.startsWith('imports loadImage')) continue;
        if (re.test(text)) problems.push(`${name}: ${why}`);
    }
}

const textFiles = [
    ...src, ...walk(path.join(root, 'test')), ...walk(path.join(root, 'scripts')),
    path.join(root, 'README.md'), path.join(root, 'CHANGELOG.md'), path.join(root, 'package.json'),
    ...(fs.existsSync(path.join(root, '.github')) ? walk(path.join(root, '.github')) : [])
].filter(f => fs.existsSync(f));
for (const file of textFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (/[\u2013\u2014\u2015]/.test(line)) problems.push(`${rel(file)}:${i + 1}: en dash, em dash or horizontal bar (U+2013, U+2014, U+2015)`);
    });
}

if (problems.length) {
    console.error(problems.map(p => `✗ ${p}`).join('\n'));
    console.error(`\n${problems.length} problem(s)`);
    process.exit(1);
}
console.log(`✓ lint: ${src.length} source files, ${textFiles.length} text files checked`);

<div align="center">

<img height="128" width="128" src="https://raw.githubusercontent.com/Demonic1594/ReForgeCanvas/main/assets/forgecanvas.png" alt="ReForgeCanvas logo">

# ReForgeCanvas
ReForgeCanvas is a hardened canvas extension for ForgeScript. Create beautiful images with simple canvas functions, and let users supply image sources without exposing the machine your bot runs on.

<a href="https://github.com/Demonic1594/ReForgeCanvas/"><img src="https://img.shields.io/github/package-json/v/Demonic1594/ReForgeCanvas/main?label=@tryforge/reforge.canvas&color=5c16d4" alt="@tryforge/reforge.canvas"></a>
<a href="https://github.com/tryforge/ForgeScript/"><img src="https://img.shields.io/github/package-json/v/tryforge/ForgeScript/main?label=@tryforge/forgescript&color=5c16d4" alt="@tryforge/forgescript"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-LGPL--3.0-5c16d4" alt="License: LGPL-3.0"></a>

</div>

---

## Contents

1. [Why ReForgeCanvas](#why-reforgecanvas)
2. [Installation](#installation)
3. [Options](#options)
4. [What changed compared to ForgeCanvas](#what-changed-compared-to-forgecanvas)
5. [Who is affected](#who-is-affected)
6. [Switching from ForgeCanvas](#switching-from-forgecanvas)
7. [Notes and limits](#notes-and-limits)
8. [Development](#development)
9. [Credits and license](#credits-and-license)

<h3 align="center">Why ReForgeCanvas</h3><hr>

ReForgeCanvas is a fork of [ForgeCanvas](https://github.com/tryforge/ForgeCanvas) 1.3.1 with the same functions and the same drawing code. What changed is how sources are loaded. In ForgeCanvas, any text passed to `$loadImage`, `$drawImage`, a `pattern://` style, `$newGIFDecoder`, `$registerFont` or `$loadLottieAnimation` could make the bot fetch any URL (including `localhost` and your cloud provider's metadata address), wait forever, download without a size limit, or read a file from its disk. `$saveCanvas` could write anywhere.

In ReForgeCanvas, every one of those goes through **one loader** with limits that you set:

- **Network:** a time limit, a size limit and a redirect cap. Loopback, private, link-local and other non-public addresses are blocked, also after a redirect and after DNS resolution. An optional host allowlist.
- **Local files:** off by default, or limited to one folder (paths are normalised, `..` and symbolic links cannot leave it).
- **Writes:** `$saveCanvas` and `$saveEncoder` write only inside a folder you choose.
- **Fonts:** a depth and a count limit for stylesheets (Google Fonts and the like). A downloaded stylesheet can never point at a file on your disk.
- **Cache:** the automatic image cache (emojis, URLs, patterns) has a size cap.
- **Size limits:** a canvas, a GIF and a decoded image have a pixel limit, read from the image's header before it is decoded (a 190 KB PNG can otherwise decode to 6 GB).
- **Errors:** users see a generic message (`This source is not allowed`, `This source is too large`, `Failed to load an image`). The detail (address, path, library error) goes to your log with the prefix `[ReForgeCanvas]`; `logLevel` chooses how much.

<h3 align="center">Installation</h3><hr>

1. Install from GitHub (ReForgeCanvas is not published on npm):
    ```bash
    npm i github:Demonic1594/ReForgeCanvas
    ```

    > ℹ️ **Note**\
    > The compiled code (`dist/`) and `metadata/` are committed, so no build step is needed. The command above follows `main`. To pin a release, add its tag, for example `npm i github:Demonic1594/ReForgeCanvas#v2.0.0`. All releases are listed under [tags](https://github.com/Demonic1594/ReForgeCanvas/tags).

2. Add it to your client:
    ```js
    const { ForgeClient } = require("@tryforge/forgescript")
    const { ReForgeCanvas } = require("@tryforge/reforge.canvas")

    const client = new ForgeClient({
        ...options, // the options you already have
        extensions: [
            new ReForgeCanvas({
                files: { read: "./assets" }   // only if your commands draw local files
            })
        ]
    })
    ```

Do not install `@tryforge/forge.canvas` next to it: both define the same functions, so a client with both in its extensions does not start (`[ReForgeCanvas] ForgeCanvas (@tryforge/forge.canvas) cannot be loaded next to ReForgeCanvas`).

Node.js: `engines` says 18.17 or newer, like the other ReForge extensions, but ForgeScript 2.8 itself needs Node.js 22, and versions below 22 are not tested (CI runs Node 22 and 24, and ForgeScript 2.5.0).

<h3 align="center">Options</h3><hr>

Every option is optional. Each `ForgeClient` gets its own `ReForgeCanvas` instance, so each bot has its own settings.

| Option | Default | What it does |
|---|---|---|
| `network.enabled` | `true` | `false` refuses every http(s) source. |
| `network.timeout` | `10000` (ms) | Time limit for one load, all redirects and the body included. |
| `network.maxBytes` | `10485760` (10 MiB) | Largest response accepted. Also the largest local file, font or GIF read. |
| `network.maxRedirects` | `5` | Redirects followed (301, 302, 303, 307, 308). `$loadImageOptions` can lower it, not raise it. |
| `network.allowedHosts` | `[]` (any public host) | Only these hosts may be fetched: `"cdn.example.com"`, or `"*.example.com"` for its subdomains. Discord's emoji CDN stays allowed for emojis in `$drawText`. |
| `network.allowPrivateNetwork` | `false` | `true` allows every non-public address. A list (`["10.0.0.5"]`) allows only those addresses, for example a local image server. |
| `files.read` | `null` (no local reads) | A folder that ForgeScript functions may read images, GIFs, fonts and Lottie files from (recommended). Relative paths in your code still start at the working directory, so `files: { read: "./assets" }` allows `./assets/bg.png`. `true` allows the bot's working folder with guards: only image, font, GIF and Lottie files; never hidden files or folders (`.env`, `.git`), `node_modules` or databases (`*.db`, `*.sqlite`, `-wal`, `-shm`, or a SQLite file renamed to `.png`); no link that leaves the folder. A one-time warning recommends a folder of its own. |
| `files.write` | `null` (no writes) | A folder that `$saveCanvas` and `$saveEncoder` may write to; it must exist. `true` allows the working folder with the same guards (images only). |
| `fonts.maxDepth` | `3` | How deep stylesheets and font folders may nest. |
| `fonts.maxFiles` | `100` | Font files one registration may load. |
| `cache.maxImages` | `500` | Images kept per image manager by the automatic cache. Oldest first out. Images you name with `$loadImage` or `$preloadImage` are never evicted. |
| `limits.maxCanvasPixels` | `25000000` (e.g. 5000x5000) | Largest `$createCanvas`, `$resizeCanvas` and `$newGIFEncoder`. Encoding a 16000x16000 canvas took 7 s of CPU in 1.3.1. |
| `limits.maxImagePixels` | `25000000` | Largest image decoded, read from the PNG, JPEG, GIF, WebP, BMP, AVIF or SVG header before decoding. |
| `limits.maxGifFrames` / `limits.maxGifPixels` | `300` / `100000000` | Frames one GIF encoder may hold, and all their pixels together (200 frames of 1000x1000 took 1.7 GB and 5 s in 1.3.1). |
| `limits.maxEmojisPerText` | `50` | Emoji images one `$drawText` loads; the rest stay text. Each emoji is a request to Discord's CDN. |
| `logLevel` | `REFORGECANVAS_LOG_LEVEL`, else `info` (as in the other ReForge extensions) | `silent`, `error`, `warn`, `info`, `debug` or `trace` (see the table below). `debug` shows each load (host and path, bytes, ms) and cache hits; query strings, tokens and file contents are never printed. One level for the whole process (the last ReForgeCanvas created sets it). |

What each level prints (every line starts with `[ReForgeCanvas]`; a level also prints everything above it):

| Level | What | Example |
|---|---|---|
| `error` | a component file that does not exist or fails to load | `Component ./card.json does not exist` |
| `warn` | a refused or failed load, one line with the reason (the user only sees the generic error); a font name registered twice; the one-time `files: true` notice | `$drawImage: NOT_ALLOWED 169.254.169.254 is a non-public address` |
| `info` (default) | one line at start-up with the settings in force; fonts and components when you ask for them (`registerFonts(fonts, true)`, `components.load(path, true)`) | `2.0.0 started: network on (10000 ms, 10485760 bytes, 5 redirects), files.read ./assets, files.write off, log level info` |
| `debug` | each load (host and path, bytes, ms), each file read or written, each cache hit | `fetched https://cdn.example.org/bg.png: 48213 bytes in 112 ms` |
| `trace` | the same as `debug` for now | |

A command that loads images successfully prints nothing at the default level. Query strings, tokens and file contents are never printed at any level.

A wrong option (a negative number, `files.read: 5`, an unknown `logLevel`) throws from `new ReForgeCanvas(...)`, so the bot does not start with a broken setup.

`registerFonts()` called from your own JavaScript (at start-up) trusts you: it reads local paths anywhere, as before, with the network limits. Pass a policy as the third argument to change that: `registerFonts(fonts, true, resolvePolicy({ ... }))`.

<h3 align="center">What changed compared to ForgeCanvas</h3><hr>

Each row was checked in ForgeCanvas 1.3.1's source (and in @napi-rs/canvas 1.1.1 and undici 7.30, which it uses), reproduced on the 1.3.1 build, and has a test in `test/`. The tests boot a real ForgeScript client (never logged in) and run ForgeScript code through its own compiler and interpreter. Run against the 1.3.1 build, 54 of the 67 tests that apply fail there (8 of them because the bot process aborts); the 13 that pass check kept behaviour (see `CHANGELOG.md`).

| Problem in ForgeCanvas 1.3.1 | Where | ReForgeCanvas 2.0.0 | Default |
|---|---|---|---|
| Image sources (URL, path, data URI) went straight to `loadImage`, which reads any existing path and fetches any URL | `structures/util.ts` `resolveImage`; `$loadImage`, `$preloadImage`, `$drawImage`, `$drawImageArea`, `$imageSize`, `$imageBuffer`, `$createFrame`, `$addFrame` | One loader; @napi-rs/canvas only receives bytes or a data URI | |
| A `pattern://URL` style fetched the URL | `resolveStyle`; `$fill`, `$stroke`, `$drawRect`, `$drawText`, `$drawProgressBar`, `$drawImage` | Same loader | |
| No time limit (@napi-rs/canvas has none; undici waits 300 s for headers and 300 s between body chunks) | all fetches | One limit for the whole load | 10 s |
| No size limit | all fetches | Declared size checked first, body cut off when over | 10 MiB |
| Up to 20 redirects (the option text said "unlimited") | `$loadImageOptions`, `$newGIFDecoder` (undici `fetch`: 20) | Capped; `$loadImageOptions` can only lower it | 5 |
| `localhost`, `127.0.0.1`, `10.x`, `169.254.169.254` and others could be fetched, directly or through a redirect | all fetches | Blocked before connecting; checked again on each redirect and on the resolved address (DNS) | blocked |
| `$loadImageOptions` passed any JSON to `http.get` as request options (`socketPath`, `host`, ...) | `$loadImageOptions` | Only `headers` is used | |
| `$newGIFDecoder` used undici `fetch` with no limits, and `readFile` on any path | `functions/gif/newGIFDecoder.ts` | Same loader | |
| `$loadLottieAnimation` read any existing path; `resourcePath` and `../` in asset paths read files anywhere (Skia resolves `resourcePath + u + p`) | `functions/lottie/loadLottieAnimation.ts` | Path, `resourcePath` and every external asset must be inside `files.read` | no reads |
| Local images, fonts and GIFs were read from any path | `resolveImage`, `registerFonts`, `$newGIFDecoder` | Only inside `files.read`, after resolving `..` and links | no reads |
| `$saveCanvas` and `$saveEncoder` wrote to any path | `functions/canvas/saveCanvas.ts`, `functions/gif/saveEncoder.ts` | Only inside `files.write`; never through a symbolic link | no writes |
| Font stylesheets were followed without a depth or count limit, and a stylesheet's `url()` could name a local file | `registerFonts` | Depth and count limits; `url()` is resolved against the stylesheet and fetched | 3 levels, 100 files |
| The automatic cache (`cache_emoji_<id>`, URLs passed to `$imageSize`, `pattern://` images) grew without limit | `ImageManager` | Oldest automatic entries removed first | 500 |
| The library's error text was shown to users (for example `connect EAFNOSUPPORT ::ffff:7f00:1:37389`) | `resolveImage` | Generic text for users, detail in the log | |
| `undici` was imported but not a dependency (it came with discord.js) | `registerFonts`, `$newGIFDecoder` | Not used; the loader is `node:http`/`node:https` | |
| A small image could decode to a huge bitmap: a 190 KB PNG claiming 40000x40000, drawn at 500x500, took 3.2 GB and 6 s | every image source | The header's size is checked before decoding | 25 MP |
| No limit on canvas or GIF size: a 16000x16000 canvas took 7 s of CPU to encode; 200 frames of 1000x1000 took 1.7 GB and 5 s | `$createCanvas`, `$resizeCanvas`, `$newGIFEncoder`, `$addFrame` | Pixel limits | 25 MP; 300 frames, 100 MP per GIF |
| Every emoji in a `$drawText` was fetched at once, with no limit | `parseText` | At most 50 per text | 50 |
| `localhost.` and `*.localhost` depended on the machine's DNS | all fetches | Refused by name (RFC 6761) | |
| Some arguments made @gifsx/gifsx's Rust code panic or try a huge allocation, which aborts the whole Node.js process (the bot goes offline; `$try` cannot catch it): `$newNeuQuant` with 0 or -1 colours or a sample factor of 0; `$indexedToRgba`/`$indexedToHex` with a pixel outside the palette; drawing an indexed `frame://` that has no palette. Found by the fuzz test | `functions/neuquant/newNeuQuant.ts`, `functions/util/indexedToRgba.ts`, `indexedToHex.ts`, `resolveImage` | Checked before the call (`structures/native.ts`); a normal error instead | |
| `$newNeuQuant` accepted any number of colours: 65536 took 19 s of CPU on 100,000 pixels (256: 62 ms) | `$newNeuQuant` | 1 to 256, the most a GIF palette holds | 256 |
| ForgeCanvas loaded next to it replaced functions depending on the order | extensions | The client does not start, with a clear error | |
| `$imageSize[preload://name]` and `$imageBuffer[var;preload://name]` never found the image | `functions/image/imageSize.ts`, `imageBuffer.ts` | Fixed | |
| A cached image was decoded again on every use (`$drawImage` of `preload://bg`: about 1.0 ms) | `resolveImage` | Used as it is (about 0.22 ms) | |

Also fixed on the way, because the tests reached them: `$saveCanvas` always failed (`image/png is not valid format`); `$imageSize` and `$imageBuffer` with a URL failed when no image had been loaded before in that command; the build failed with @napi-rs/canvas 1.1 typings (`createPattern` can return `null`); `$indexedToRgba` and `$indexedToHex` failed when an optional argument was left empty (`Failed to convert napi value`).

<h3 align="center">Who is affected</h3><hr>

The risk depends on whether your bot passes **user text** to these functions, for example `$drawImage[;$message;...]`, an avatar URL a user can pick, or a "background" option. A bot whose sources are fixed in its own code (your logo URL, `$userAvatar`, files you ship) was not exposed in the first place, and switching changes little for it beyond the defaults below.

**Behaviour that changes with the defaults** (set the option to get the old behaviour back):

| What | Before | Now | To keep the old behaviour |
|---|---|---|---|
| Local files in ForgeScript (`$drawImage[;./bg.png]`) | read from anywhere | refused; the log says which option to set | `files: { read: "./assets" }` (the folder they are in), or `files: { read: true }` for the bot folder with guards |
| `$saveCanvas` / `$saveEncoder` to a path | written anywhere | refused | `files: { write: "./output" }` |
| URLs on your own machine or network | fetched | refused | `network: { allowPrivateNetwork: ["10.0.0.5"] }` (or `true`) |
| Slow or big downloads | waited, downloaded | 10 s, 10 MiB | `network: { timeout, maxBytes }` |
| More than 5 redirects | followed (up to 20) | refused | `network: { maxRedirects: 20 }` |
| Canvases, GIFs and images over 25 megapixels | allowed | refused | `limits: { maxCanvasPixels, maxImagePixels }` (`Infinity` for no limit) |
| More than 50 emojis in one `$drawText` | all fetched | the rest stay text | `limits: { maxEmojisPerText }` |
| ForgeCanvas in the same extensions list | both loaded | the client does not start | remove ForgeCanvas |
| `$newNeuQuant` with more than 256 colours | allowed (slow) | refused | none (a GIF palette holds at most 256) |
| `$loadImageOptions` request options | passed as is | only `headers` | none |
| A failed image in `$drawImage` | a black rectangle, no error | an error | none (colours, `gradient://` and `pattern://` still draw as styles) |
| Error text | the library's message | a generic message, detail in the log | read the log |
| The package, class and error enum | `@tryforge/forge.canvas`, `ForgeCanvas`, `ForgeCanvasError` | `@tryforge/reforge.canvas`, `ReForgeCanvas`, `ReForgeCanvasError` (no alias for the old names) | see below |

Unchanged: data URIs, inline `<svg>` (checked: @napi-rs/canvas 1.1.1 does not fetch what an SVG links to), `images://`, `preload://`, `canvas://`, `frame://`, `rgba://`, `hex://`, every drawing function, GIF encoding and components.

<h3 align="center">Switching from ForgeCanvas</h3><hr>

1. `npm uninstall @tryforge/forge.canvas` and `npm i github:Demonic1594/ReForgeCanvas#v2.0.0`.
2. Change the require: `const { ReForgeCanvas } = require("@tryforge/reforge.canvas")`, and `new ForgeCanvas()` to `new ReForgeCanvas({ ... })`. `ForgeCanvas` is not exported (there is no alias), so code that does `new ForgeCanvas()` must change to `new ReForgeCanvas()`, and its import to `@tryforge/reforge.canvas`. `ForgeCanvas.components` is now `ReForgeCanvas.components`, and TypeScript code that imports the `ForgeCanvasError` enum uses `ReForgeCanvasError`.
3. If your commands draw local files, set `files.read` (a folder, or `true` for the bot folder with guards); if they save files, set `files.write`. Without it, each refused path is logged with the option to set.
4. Commands stay the same. The extension registers as `reforge.canvas`, and its log lines start with `[ReForgeCanvas]`.

<h3 align="center">Notes and limits</h3><hr>

- What was verified: every row of the tables above has a test (local test servers, temporary folders, a fake DNS answer for the "resolves to a private address" cases), plus a seeded fuzz test (every function with hostile arguments: no crash, no request or file read where blocked; run with seeds 1 to 8 and the default 1337, 5,400 calls) and concurrency and memory tests. The address check is cross-checked against ipaddr.js (a dev dependency) over a fixed list and a random sample of every special range; it blocks everything ipaddr.js does, except public IPv4 addresses inside IPv6 forms (`::ffff:8.8.8.8`), and also blocks `::7f00:1`, which ipaddr.js calls public. What was not verified: real public hosts, IPv6 networks, Windows paths and Windows symbolic links, and HTTP proxies (neither ForgeCanvas nor ReForgeCanvas uses `HTTP(S)_PROXY`).
- A link created inside `files.read` after a Lottie animation was checked, but before Skia reads it, is not caught (Lottie assets are checked by path, since Skia opens them itself). Keep `files.read` a folder only you write to.
- Image formats whose header is not read (for example ICO) are checked after decoding: the limit still applies, but the memory is used first. Lottie animations were measured cheap even with a declared 100000x100000 size and 10^8 frames (they render into a canvas of your size), and long text too (200,000 characters in one `$drawText`: 0.35 s in 1.3.1, 0.05 s here), so neither has its own limit.
- After the first GIF commands, the process keeps about 400 MB more resident memory that the native allocator does not return; it stays flat afterwards (measured over 480 commands), so it is not a leak.
- `$registerFont` registers fonts for the whole process (that is how @napi-rs/canvas works), so a user-supplied font affects every bot in it. Prefer registering fonts at start-up.

<h3 align="center">Performance</h3><hr>

Measured on the same machine, 3 runs of 200 operations each, through the real interpreter (average ms per operation):

| Operation | ForgeCanvas 1.3.1 | ReForgeCanvas 2.0.0 |
|---|---|---|
| Load an 800x250 PNG from a local server | 1.17 / 1.09 / 0.92 | 1.54 / 1.48 / 1.43 |
| Draw a cached image (`preload://bg`) on an 800x250 canvas | 1.07 / 1.16 / 0.99 | 0.22 / 0.22 / 0.22 |
| A typical card (canvas, background, shape, text, `$attachCanvas`) | 6.96 / 6.94 / 7.34 | 6.86 / 6.37 / 6.43 |

A network load costs about 0.4 ms more (the address check on the resolved address, the header check and a copy); a cached image is no longer decoded again on every use.

<h3 align="center">Development</h3><hr>

```bash
npm install
npm run build      # tsc: src/ to dist/
npm run lint       # type check + scripts/lint.js (one loader, licence headers, no long dashes)
npm test           # node:test against dist/: a real ForgeScript client, seeded fuzz (FUZZ_SEED, FUZZ_RUNS)
npm run docgen     # metadata/ from dist/functions
```

`REFORGE_DIST=/path/to/other/dist npm test` runs the same tests against another build (this is how the ForgeCanvas 1.3.1 results were produced). CI checks that the committed `dist/` and `metadata/` match the sources.

<h3 align="center">Credits and license</h3><hr>

ReForgeCanvas is a fork of [ForgeCanvas](https://github.com/tryforge/ForgeCanvas) by the BotForge team, licensed under the GNU LGPL v3 (see [LICENSE](LICENSE)). All of the drawing code is theirs.

Contributor|Contribution|Contact
-|-|-
Aggelos|ForgeCanvas founder|[Discord](https://discord.com/users/637648484979441706) [GitHub](https://github.com/aggelos-007)
Lordex|ForgeCanvas developer|[Discord](https://discord.com/users/1096717977304453160) [GitHub](https://github.com/devlordduck)
Aurea|ForgeCanvas readme editor|[Discord](https://discord.com/users/976413539076026388) [GitHub](https://github.com/aurea6)
Aditya|ForgeCanvas readme editor|[Discord](https://discord.com/users/903681538842054686) [GitHub](https://github.com/Clyders)

ForgeCanvas documentation: https://docs.botforge.org/p/ForgeCanvas/. Every function there exists in ReForgeCanvas with the same arguments. For help with ForgeScript, join the [BotForge Discord](https://botforge.org/discord); questions about the hardening belong in this repository's issues.

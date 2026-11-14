# Changelog

## 2.0.0 (November 2026)

First release of ReForgeCanvas, a fork of ForgeCanvas 1.3.1. The version jumps to 2.0.0 because defaults change: see "Changed".

Renamed to ReForgeCanvas: package `@tryforge/reforge.canvas`, class `ReForgeCanvas` (`ForgeCanvas` is no longer exported), extension name `reforge.canvas`, options type `IReForgeCanvasOptions`, log prefix `[ReForgeCanvas]`. Installed from GitHub: `npm i github:Demonic1594/ReForgeCanvas#v2.0.0`.

Every fix below was found in the 1.3.1 source (or in @napi-rs/canvas 1.1.1 and undici 7.30.2, which it uses) and has a test in `test/`. The suite has 43 tests. Run against the 1.3.1 build, 33 of the 39 that apply fail and 6 pass (those 6 check behaviour that is kept, such as data URIs, inline SVG and `registerFonts()` from JavaScript); the 4 rename tests are skipped there.

### Security
- **One loader for every source a user can name.** Images (`$loadImage`, `$preloadImage`, `$drawImage`, `$drawImageArea`, `$imageSize`, `$imageBuffer`, `$createFrame`, `$addFrame`), `pattern://` styles (`$fill`, `$stroke`, `$drawRect`, `$drawText`, `$drawProgressBar`), `$newGIFDecoder`, `$registerFont`, `$loadLottieAnimation`, emojis in `$drawText`, and `ImageManager.load`/`tryGet` all go through `src/structures/loader.ts`. @napi-rs/canvas now only receives bytes or a data URI, never a path or a URL.
- **Non-public addresses are blocked**: loopback, private (RFC 1918), carrier-grade NAT, link-local (including `169.254.169.254`), multicast, documentation and reserved ranges, IPv6 unique-local and link-local, and IPv4 inside IPv6 (mapped, NAT64, 6to4). The check runs on IP literals in any spelling the URL parser accepts (`2130706433`, `0x7f000001`, `127.1`, `[::ffff:7f00:1]`), on every redirect, and on the address DNS returns, which is the address the connection then uses.
- **Time limit** for a whole load (redirects and body included), 10 s by default. Before: none in @napi-rs/canvas; undici's 300 s header and 300 s idle-body timeouts in `$newGIFDecoder` and fonts.
- **Size limit**, 10 MiB by default: a larger declared `content-length` is refused before reading, and a body without one is cut off.
- **Redirect cap**, 5 by default (301, 302, 303, 307, 308). Before: 20 in @napi-rs/canvas (only 301 and 302), 20 in undici `fetch`, while `$loadImageOptions` said "unlimited".
- `$loadImageOptions` request options are no longer passed to `http.get` as they are (they could set `socketPath`, `host` or an agent); only `headers` is used, without `Host`.
- **Local reads are off by default** (`files.read`). With a folder set, paths are resolved, `..` cannot leave it, and symbolic links are followed before checking. Before: `$loadImage[x;/any/path]`, `$newGIFDecoder`, `$registerFont` and `$loadLottieAnimation` read any existing file.
- `$loadLottieAnimation`'s `resourcePath`, and each external asset in the animation, must be inside `files.read`. Skia resolves assets as `resourcePath + u + p`; checked with @napi-rs/canvas 1.1.1 that `../` in `u` or `p` reads outside `resourcePath`.
- **Writes are off by default** (`files.write`). `$saveCanvas` and `$saveEncoder` write only inside that folder, and not through a symbolic link at the target (`O_NOFOLLOW` where the OS has it).
- **Fonts**: stylesheet and folder nesting limited (`fonts.maxDepth`, 3) and font files per registration limited (`fonts.maxFiles`, 100). Before, a stylesheet naming itself looped until the server stopped. A stylesheet's `url()` is resolved against the stylesheet's URL and fetched; before, `url(/path/on/disk.ttf)` registered a local file.
- **Cache cap**: automatic entries (emojis, URLs passed to `$imageSize`/`$imageBuffer`, `pattern://` images) are capped per manager (`cache.maxImages`, 500); before, every distinct emoji ID in user text added an image to the global cache for good.
- **Generic errors for users**: `This source is not allowed`, `This source is too large`, or the function's own failure text (`Failed to load an image`, `Failed to load the GIF`, ...). The detail goes to the log as `[ReForgeCanvas] $function: CODE detail`. Before, the library's error text was shown, including addresses and paths.

### Changed
- Defaults that change behaviour: no local reads, no writes, private addresses blocked, 10 s, 10 MiB, 5 redirects (see the README's "Who is affected" table for the option that restores each).
- `$drawImage` and `$drawImageArea` treat a source as a style only when it is a colour, `gradient://` or `pattern://`. Before, any failed image fell back to a style and drew a black rectangle with no error; now the error is returned.
- `registerFonts()` from JavaScript accepts a policy as its third argument. Without one it trusts the caller (local paths anywhere) but uses the network limits.
- `ImageManager` takes a policy (`new ImageManager(policy)`) and has `cache(name, image)` for capped entries; `set()` entries are never evicted.
- ForgeCanvas loaded next to ReForgeCanvas: an error is logged, ForgeCanvas is not started, and ReForgeCanvas keeps its functions.
- Node 22 or newer (`engines`): ForgeScript 2.8.0 depends on chalk 6, which requires Node 22, and `npm test` relies on Node 22's test-file globs.
- `undici` is no longer used (it was imported without being a dependency).
- Added `npm test` (node:test, 43 tests in 6 groups, also passing on ForgeScript 2.5.0), `npm run lint` (`tsc --noEmit` and `scripts/lint.js`), and CI on Node 22 and 24 that also checks `dist/` and `metadata/` are up to date.

### Fixed
- `$saveCanvas` always failed with `image/png is not valid format` (it passed a MIME type where the format name was expected).
- `$imageSize` and `$imageBuffer` with a URL or path failed when no image had been loaded before in the same command.
- `registerFonts()` stopped at the first missing font when logging was off (`return` instead of `continue`), and font folders were registered without waiting.
- The build failed with @napi-rs/canvas 1.1 typings (`createPattern` may return `null`); a `null` pattern is now an error.

## 1.3.1 and earlier

See [ForgeCanvas](https://github.com/tryforge/ForgeCanvas) for the history before the fork.

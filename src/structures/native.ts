/*
* SPDX-License-Identifier: LGPL-3.0-or-later
* Copyright © 2026 BotForge
*/

/*
 * Checks that run before calls into @gifsx/gifsx. On the inputs below its Rust code panics or tries a
 * huge allocation, and either one aborts the whole Node.js process: $try cannot catch it and the bot
 * goes offline. Measured with @gifsx/gifsx 1.0.15:
 *   new NeuQuant(1, 0, px)       index out of bounds (color_quant lib.rs:296)
 *   new NeuQuant(0, 256, px)     divide by zero (lib.rs:312); 0.5, NaN and 2^32 become 0 too
 *   new NeuQuant(1, -1, px)      allocation of 137 GB fails (-1 becomes 2^32 - 1 colours)
 *   new NeuQuant(1, 65536, px)   19 s of CPU on 100,000 pixels, blocking the event loop (256: 62 ms)
 *   indexedToRgba(px, palette)   index out of bounds when a pixel is outside the palette or the
 *                                palette is empty or not RGB triples (gifsx src/util.rs:157)
 */

/** A GIF palette holds at most 256 colours, so a quantizer never needs more. */
export const NEUQUANT_MAX_COLORS = 256;

/** Why `new NeuQuant(sample, maxColors, ...)` would abort the process, or null when it is safe. */
export function neuQuantProblem(sample: unknown, maxColors: unknown): string | null {
    if (typeof sample !== 'number' || !Number.isInteger(sample) || sample < 1 || sample > 0xffffffff)
        return 'The sample factor must be a whole number of at least 1';
    if (typeof maxColors !== 'number' || !Number.isInteger(maxColors) || maxColors < 1 || maxColors > NEUQUANT_MAX_COLORS)
        return `The maximum number of colors must be a whole number from 1 to ${NEUQUANT_MAX_COLORS}`;
    return null;
}

/** Why `indexedToRgba(pixels, palette)` (or indexedToHex) would abort the process, or null when it is safe. */
export function indexedProblem(pixels: ArrayLike<number>, palette: ArrayLike<number> | null | undefined): string | null {
    if (!palette || palette.length < 3 || palette.length % 3 !== 0)
        return 'Indexed pixels need a palette of RGB colors (3 numbers per color)';
    const colors = palette.length / 3;
    for (let i = 0; i < pixels.length; i++)
        if (pixels[i] >= colors) return `Pixel ${i} uses color ${pixels[i]}, but the palette has ${colors}`;
    return null;
}

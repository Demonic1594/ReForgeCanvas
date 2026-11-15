/** A GIF palette holds at most 256 colours, so a quantizer never needs more. */
export declare const NEUQUANT_MAX_COLORS = 256;
/** Why `new NeuQuant(sample, maxColors, ...)` would abort the process, or null when it is safe. */
export declare function neuQuantProblem(sample: unknown, maxColors: unknown): string | null;
/** Why `indexedToRgba(pixels, palette)` (or indexedToHex) would abort the process, or null when it is safe. */
export declare function indexedProblem(pixels: ArrayLike<number>, palette: ArrayLike<number> | null | undefined): string | null;

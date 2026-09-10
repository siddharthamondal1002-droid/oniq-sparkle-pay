/**
 * Types for the mirror script, so `mirror.test.ts` can import its closure
 * computation rather than reimplementing it. A test that recomputed the
 * closure its own way would pass while the script mirrored the wrong files.
 */
export declare const ENTRY: string;
/** Every `../oqca/...` specifier under the runtime, rebased onto `src/oqca`. */
export declare function entrypoints(dir?: string): string[];
export declare function closure(entry?: string | null, seen?: Set<string>): Set<string>;

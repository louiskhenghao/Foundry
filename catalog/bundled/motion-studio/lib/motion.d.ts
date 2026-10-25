// Types of motion.js, for the tests and for a TypeScript film; the script itself stays plain JavaScript so index.html loads it over file://.
export const clamp: (x: number, a?: number, b?: number) => number;
export const lerp: (a: number, b: number, u: number) => number;
export const unit: (t: number, t0: number, t1: number) => number;
export const smooth: (u: number) => number;
export function spring(t: number, k?: number, d?: number): number;
export const SPRINGS: Record<'snappy' | 'default' | 'heavy' | 'playful', { k: number; d: number }>;
export function track(t: number, keys: [number, number][], k?: number, d?: number): number;
export function stretch(t: number, stops: [number, number][], width?: number): { left: number; right: number };
export const swapAlpha: (t: number, tIn: number, tOut: number) => number;
export const loopT: (t: number, dur: number) => number;
export function rng(seed: number): () => number;
export const stagger: (i: number, gap?: number, jitter?: number, seed?: number) => number;
export const beats: (bpm: number, phase?: number) => { period: number; at: (n: number) => number; index: (t: number) => number; nearest: (t: number) => number };

// Motion helpers for a film that is a pure function of time (ADR-0077). Everything here is deterministic: the same t
// gives the same value, so any frame can be rendered alone and two renders are identical. No timers, no state.
// A classic script (index.html loads it with a plain <script> over file://, where module imports are refused) that
// also exports for Node and the tests: in the page it is window.Motion.

(() => {
/** clamp x into [a, b] (0..1 by default) */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** linear blend of a and b by u */
const lerp = (a, b, u) => a + (b - a) * u;
/** where t sits between t0 and t1, clamped to 0..1 */
const unit = (t, t0, t1) => (t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));
/** smoothstep: eased 0..1 */
const smooth = (u) => { const x = clamp(u); return x * x * (3 - 2 * x); };

/**
 * A closed-form damped spring from 0 to 1, started at t = 0: stiffness k, damping d. Underdamped springs overshoot a
 * little and settle; critically or overdamped ones never overshoot. A pure function of t, so no simulation is needed to
 * know frame 812.
 */
function spring(t, k = 170, d = 26) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k);
  const z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s1 = -w0 * (z - Math.sqrt(z * z - 1));
  const s2 = -w0 * (z + Math.sqrt(z * z - 1));
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

/** named spring feels: UI edges snap, cards and the camera settle, big type and logos are heavy, mascots overshoot */
const SPRINGS = {
  snappy: { k: 320, d: 30 },
  default: { k: 170, d: 26 },
  heavy: { k: 90, d: 22 },
  playful: { k: 200, d: 14 },
};

/**
 * A value that changes target several times: keys are [[time, value], ...] sorted by time. One spring per change,
 * each starting at its own time and summed, so the motion stays continuous and still needs no history.
 */
function track(t, keys, k = 170, d = 26) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
  return v;
}

/** a tab indicator or a bar that stretches: its leading edge is stiffer than its trailing edge */
function stretch(t, stops, width = 120) {
  const lead = track(t, stops, 320, 30);
  const trail = track(t, stops, 140, 22);
  return { left: Math.min(lead, trail), right: Math.max(lead, trail) + width };
}

/** text inside a morphing box: in shortly after the morph starts, out shortly before the next one */
const swapAlpha = (t, tIn, tOut) => Math.min(clamp((t - tIn - 0.08) / 0.12), clamp((tOut - 0.1 - t) / 0.1));

/** a seamless loop: t folded into [0, dur) */
const loopT = (t, dur) => ((t % dur) + dur) % dur;

/** seeded noise (mulberry32): the same seed gives the same sequence every render; never Math.random */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** a stagger: the i-th of n things starts `gap` later, with a touch of seeded jitter */
const stagger = (i, gap = 0.03, jitter = 0, seed = 7) => i * gap + (jitter ? rng(seed + i)() * jitter : 0);

/** a beat grid: which beat t is on (fractional), and the time of beat n, for bpm with a first beat at `phase` seconds */
const beats = (bpm, phase = 0) => {
  const period = 60 / bpm;
  return { period, at: (n) => phase + n * period, index: (t) => (t - phase) / period, nearest: (t) => phase + Math.round((t - phase) / period) * period };
};

const Motion = { clamp, lerp, unit, smooth, spring, SPRINGS, track, stretch, swapAlpha, loopT, rng, stagger, beats };
if (typeof module !== 'undefined' && module.exports) module.exports = Motion;
if (typeof window !== 'undefined') window.Motion = Motion;
})();

/**
 * The colour arithmetic a Theme needs: mixing two colours the way the eye sees them (OKLab), WCAG contrast, and moving a
 * colour lighter or darker until text in it reads. Colours are #rrggbb strings in and out.
 */

type Rgb = [number, number, number];
type Lab = [number, number, number];

export function parseHex(hex: string): Rgb {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);

function toLab(hex: string): Lab {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** linear sRGB channels, unclamped: a channel outside 0–1 means the colour is outside the screen's gamut */
function labToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const fromLab = (lab: Lab) => toHex(labToLinear(lab).map(toGamma) as Rgb);

/** `t` of the way from `a` to `b` (0 = a, 1 = b), mixed in OKLab so the halfway point looks halfway */
export function mix(a: string, b: string, t: number): string {
  const x = toLab(a);
  const y = toLab(b);
  return fromLab([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Lab);
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const isDark = (hex: string) => luminance(hex) < 0.18;

/**
 * `hex` as text on every one of `backgrounds`: unchanged when it already reads (contrast ≥ `min`), otherwise moved
 * darker (on light backgrounds) or lighter (on dark ones) with its hue kept, until it does. Signal yellow on white becomes
 * ochre; the same yellow on graphite stays yellow.
 */
export function readable(hex: string, backgrounds: string[], min = 4.5): string {
  const worst = (c: string) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(hex) >= min) return hex;
  const [L, a, b] = toLab(hex);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);
  const step = isDark(backgrounds[0]!) ? 0.01 : -0.01;
  let best = hex;
  for (let l = L + step; l > 0 && l < 1; l += step) {
    // keep the hue; give up chroma until the colour fits on screen
    let c = chroma;
    let lin = labToLinear([l, c * Math.cos(hue), c * Math.sin(hue)]);
    while (c > 0.001 && lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) {
      c *= 0.94;
      lin = labToLinear([l, c * Math.cos(hue), c * Math.sin(hue)]);
    }
    best = toHex(lin.map(toGamma) as Rgb);
    if (worst(best) >= min) return best;
  }
  return best;
}

/** of `candidates`, the one that reads best on `fill`: the text and icons drawn on a filled sign or button */
export function bestOn(fill: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (contrast(c, fill) > contrast(best, fill) ? c : best));
}

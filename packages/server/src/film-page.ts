/**
 * The scrubber page of a motion-studio film (ADR-0086): Foundry's own page, served at /api/goals/:id/film/:slug, with
 * the film's index.html in a sandboxed iframe (an opaque origin: the film's code never runs as Foundry) opened with
 * `?render=1` so its own play loop stays off. A slider, Play and the arrow keys drive `window.seek(t)` by message; the
 * listener below is appended to the film's page when it is served.
 */
import { servedType } from './files.ts';

export interface FilmPageInput {
  goalId: string;
  film: { slug: string; title: string; duration: number; fps: number; formats: string[] };
}

/** appended to a film's index.html as it is served: the scrubber page's `{seek: t}` messages reach `window.seek` */
export const SEEK_LISTENER = `\n<script>/* Foundry's Editor (ADR-0086): the scrubber page drives the film by message */addEventListener('message',function(e){var d=e.data;if(d&&typeof d.seek==='number'&&typeof window.seek==='function'){window.seek(d.seek);}});</script>\n`;

const SIZES: Record<string, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** the type a film's own file is served with: its scripts run (the page is sandboxed), everything else as the files view serves it */
export function filmFileType(rel: string): string {
  if (/\.(m?js)$/i.test(rel)) return 'text/javascript; charset=utf-8';
  if (/\.css$/i.test(rel)) return 'text/css; charset=utf-8';
  if (/\.json$/i.test(rel)) return 'application/json; charset=utf-8';
  if (/\.(woff2?|ttf|otf)$/i.test(rel)) return /woff2$/i.test(rel) ? 'font/woff2' : /woff$/i.test(rel) ? 'font/woff' : /ttf$/i.test(rel) ? 'font/ttf' : 'font/otf';
  return servedType(rel);
}

export function filmPage({ goalId, film }: FilmPageInput): string {
  const formats = (film.formats.length ? film.formats : ['16x9']).filter((f) => SIZES[f]);
  const first = formats[0] ?? '16x9';
  const base = `/api/goals/${encodeURIComponent(goalId)}/motion/${encodeURIComponent(film.slug)}/index.html`;
  const data = JSON.stringify({ base, duration: film.duration, fps: film.fps, formats, sizes: Object.fromEntries(formats.map((f) => [f, SIZES[f]])) });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(film.title)} · Foundry</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #141413; color: #f0eee6; font: 13px/1.4 system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #2a2a28; flex-wrap: wrap; }
  header h1 { font-size: 14px; margin: 0; font-weight: 700; }
  header .meta { color: #9a9890; font-variant-numeric: tabular-nums; }
  header select, header button { font: inherit; background: #26262a; color: inherit; border: 1px solid #3a3a3e; border-radius: 6px; padding: 4px 10px; }
  header button { cursor: pointer; min-width: 5.5em; }
  main { flex: 1; min-height: 0; display: grid; place-items: center; padding: 12px; overflow: hidden; }
  #stage { position: relative; overflow: hidden; background: #000; }
  #stage iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: #000; }
  footer { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid #2a2a28; }
  footer input[type=range] { flex: 1; accent-color: #d97757; }
  footer .time { font-variant-numeric: tabular-nums; color: #9a9890; min-width: 8em; text-align: right; }
  footer a { color: #9a9890; }
</style>
</head>
<body>
<header>
  <h1>${esc(film.title)}</h1>
  <span class="meta">${esc(film.slug)} · ${film.duration} s · ${film.fps} fps</span>
  <label>Format <select id="format">${formats.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></label>
  <button id="play" type="button" aria-label="Play or pause (space)">Play</button>
  <span class="meta">space: play · ← →: one frame · Home/End</span>
</header>
<main><div id="stage"><iframe id="film" title="${esc(film.title)}" sandbox="allow-scripts" src="${esc(`${base}?format=${encodeURIComponent(first)}&render=1`)}"></iframe></div></main>
<footer>
  <input id="t" type="range" min="0" max="${film.duration}" step="${1 / (film.fps || 60)}" value="0" aria-label="Time">
  <span class="time" id="time">0.00 / ${film.duration.toFixed(2)} s</span>
  <a id="alone" href="${esc(`${base}?format=${encodeURIComponent(first)}`)}" target="_blank" rel="noreferrer">film page alone ↗</a>
</footer>
<script id="data" type="application/json">${data.replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var frame = document.getElementById('film'), stage = document.getElementById('stage'), slider = document.getElementById('t');
  var timeEl = document.getElementById('time'), play = document.getElementById('play'), fmt = document.getElementById('format'), alone = document.getElementById('alone');
  var t = 0, playing = false, t0 = 0, raf = 0, loaded = false;
  var step = 1 / (D.fps || 60);
  function size() { return D.sizes[fmt.value] || [1920, 1080]; }
  function fit() {
    var s = size(), main = stage.parentElement;
    var k = Math.min((main.clientWidth - 24) / s[0], (main.clientHeight - 24) / s[1], 1);
    stage.style.width = Math.round(s[0] * k) + 'px'; stage.style.height = Math.round(s[1] * k) + 'px';
    frame.style.width = s[0] + 'px'; frame.style.height = s[1] + 'px'; frame.style.transform = 'scale(' + k + ')';
  }
  function show() { timeEl.textContent = t.toFixed(2) + ' / ' + D.duration.toFixed(2) + ' s'; slider.value = String(t); }
  function seek(v) {
    t = Math.max(0, Math.min(D.duration, v));
    if (loaded && frame.contentWindow) frame.contentWindow.postMessage({ seek: t }, '*');
    show();
  }
  function tick(now) {
    if (!playing) return;
    seek(((now - t0) / 1000) % D.duration);
    raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    playing = on; play.textContent = on ? 'Pause' : 'Play';
    if (on) { t0 = performance.now() - t * 1000; raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  }
  play.addEventListener('click', function () { setPlaying(!playing); });
  slider.addEventListener('input', function () { if (playing) setPlaying(false); seek(Number(slider.value)); });
  fmt.addEventListener('change', function () {
    loaded = false; fit();
    var src = D.base + '?format=' + encodeURIComponent(fmt.value) + '&render=1';
    alone.href = D.base + '?format=' + encodeURIComponent(fmt.value);
    frame.src = src;
  });
  frame.addEventListener('load', function () { loaded = true; seek(t); });
  document.addEventListener('keydown', function (e) {
    if (e.target === slider || e.target === fmt) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') { setPlaying(false); seek(t + step * (e.shiftKey ? 10 : 1)); }
    else if (e.key === 'ArrowLeft') { setPlaying(false); seek(t - step * (e.shiftKey ? 10 : 1)); }
    else if (e.key === 'Home') { setPlaying(false); seek(0); }
    else if (e.key === 'End') { setPlaying(false); seek(D.duration - step); }
  });
  window.addEventListener('resize', fit);
  fit(); show();
})();
</script>
</body>
</html>
`;
}

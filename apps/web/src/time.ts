/**
 * Times as the person's computer shows them. Events carry UTC ISO timestamps; cutting the text of one (`ts.slice(11,
 * 19)`) shows UTC, hours off from the clock on the wall.
 */
const two = (n: number) => String(n).padStart(2, '0');

/** `16:08:53`, in this computer's time zone */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** `2026-10-09 16:08`, in this computer's time zone */
export function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

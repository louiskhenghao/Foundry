/**
 * Prefixed, time-sortable ids: `<prefix>_<timestamp base36><random>`.
 * Sortable by creation time within a process; unique enough for a single-user system.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
let lastTime = 0;
let counter = 0;

function randomPart(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function newId(prefix: string): string {
  const now = Date.now();
  if (now === lastTime) counter++;
  else {
    lastTime = now;
    counter = 0;
  }
  const time = now.toString(36).padStart(9, '0');
  const seq = counter.toString(36).padStart(2, '0');
  return `${prefix}_${time}${seq}${randomPart(8)}`;
}

export const IdPrefix = {
  goal: 'g',
  task: 't',
  attempt: 'a',
  check: 'chk',
  checkResult: 'cr',
  escalation: 'esc',
  event: 'evt',
  brief: 'b',
  attachment: 'att',
  /** a round of review comments on a pull request (ADR-0053) */
  review: 'rev',
  /** a Schedule (ADR-0054) */
  schedule: 'sch',
  /** a Revert of a merged delivery (ADR-0059) */
  revert: 'rvt',
  /** a coding agent's sign-in beside the machine's own (ADR-0065) */
  account: 'acc',
  /** a Conversation on a goal's page and one of its messages (ADR-0073) */
  conversation: 'conv',
  message: 'msg',
  /** what the Explainer proposed (ADR-0075) */
  proposal: 'prop',
} as const;

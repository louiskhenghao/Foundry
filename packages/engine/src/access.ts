/**
 * Access (ADR-0061): who may use this Foundry from elsewhere. Each person has a token of their own; once anyone has
 * one, every request must carry one — a bearer header (the CLI's `FOUNDRY_TOKEN`) or the cookie the login page sets —
 * and what a person does (a goal asked for, a Brief approved, an Inbox item answered) is recorded under their name.
 * With no one on the list, nothing changes: the loopback-only Foundry of a single person needs no login. Tokens are
 * kept hashed in `access.json` beside the data; they are never in the event log and never travel with a Transfer.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Person {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
type Stored = Person & { hash: string };

export class AccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const FILE = 'access.json';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const valid = (p: unknown): p is Stored => !!p && typeof p === 'object' && typeof (p as Stored).id === 'string' && typeof (p as Stored).name === 'string' && typeof (p as Stored).hash === 'string';
const strip = ({ hash: _h, ...person }: Stored): Person => person;

export class Access {
  private people: Stored[] = [];
  private readonly file: string;
  constructor(dataDir: string) {
    this.file = join(dataDir, FILE);
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { people?: unknown[] };
      this.people = Array.isArray(j.people) ? j.people.filter(valid) : [];
    } catch {
      this.people = [];
    }
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ people: this.people }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  /** Access is on once anyone has a token: every request must then carry one */
  enabled(): boolean {
    return this.people.length > 0;
  }
  list(): Person[] {
    return this.people.map(strip);
  }
  /** a new person and their token, shown once: only its hash is kept */
  add(nameIn: string): { person: Person; token: string } {
    const name = nameIn.trim().slice(0, 60);
    if (!name) throw new AccessError('a name is needed');
    if (this.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new AccessError(`${name} already has a token; revoke it first`, 409);
    const token = `fnd_${randomBytes(24).toString('base64url')}`;
    const stored: Stored = { id: `p_${randomBytes(6).toString('hex')}`, name, createdAt: new Date().toISOString(), lastUsedAt: null, hash: hash(token) };
    this.people.push(stored);
    this.save();
    return { person: strip(stored), token };
  }
  revoke(id: string): Person {
    const i = this.people.findIndex((p) => p.id === id);
    if (i < 0) throw new AccessError('no such person', 404);
    const [gone] = this.people.splice(i, 1);
    this.save();
    return strip(gone!);
  }
  /** the person a token belongs to, or null; a use is remembered, once a minute at most */
  verify(token: string | null | undefined): Person | null {
    if (!token) return null;
    const given = Buffer.from(hash(token));
    for (const p of this.people) {
      const mine = Buffer.from(p.hash);
      if (mine.length !== given.length || !timingSafeEqual(mine, given)) continue;
      const now = Date.now();
      if (!p.lastUsedAt || now - Date.parse(p.lastUsedAt) > 60_000) {
        p.lastUsedAt = new Date(now).toISOString();
        this.save();
      }
      return strip(p);
    }
    return null;
  }
}

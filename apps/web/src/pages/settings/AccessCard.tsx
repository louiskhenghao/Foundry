import { KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Person } from '../../api.ts';
import { Button, Card, ConfirmDialog, CopyButton, Input, Modal, ago } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SettingsTitle } from './sections.tsx';

/** The people with a token, each with when they last used it, and a Revoke. */
export function PeopleList({ people, busy, onRevoke }: { people: Person[]; busy?: boolean; onRevoke: (p: Person) => void }) {
  if (!people.length) return <p className="text-sm text-ink-faint">No one has a token: Access is off, and anyone who can reach this address is let in. Add the first person to turn it on.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {people.map((p) => (
        // a token in use has a green key; one never used yet is not set, so plain
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <KeyRound size={13} className={p.lastUsedAt ? 'text-ok-ink' : 'text-ink-faint'} />
          <span className="font-bold text-ink">{p.name}</span>
          <span className="text-xs text-ink-faint">since {p.createdAt.slice(0, 10)} · {p.lastUsedAt ? <span className="font-semibold text-ok-ink">last used {ago(p.lastUsedAt)}</span> : 'never used'}</span>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => onRevoke(p)} title={`Take ${p.name}'s token back: it stops working at once`}>
            <Trash2 size={13} /> Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Settings → Access (ADR-0061): who may use this Foundry from elsewhere; each person a token, shown once. */
export function AccessCard() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ person: Person; token: string } | null>(null);
  const [revoking, setRevoking] = useState<Person | null>(null);
  const load = () => api.accessPeople().then((r) => setPeople(r.people)).catch((e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);
  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      setMade(await api.accessAdd(name.trim()));
      setName('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setErr(null);
    try {
      await api.accessRevoke(revoking.id);
      setRevoking(null);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const on = !!people?.length;
  return (
    <Card id="access" title={<SettingsTitle id="access">Access<HelpLink to="settings#access" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
      <div className="space-y-3">
        <p className="text-xs text-ink-faint">
          Who may use this Foundry from another device. Each person gets a token, shown once: pasted on the login page it signs a browser in; set as <span className="mono">FOUNDRY_TOKEN</span> it signs the CLI in. Once anyone has a token, every request needs one — on this computer too — and a goal, a Brief approval or an Inbox answer is recorded under the person's name. Revoke everyone's to turn Access off again.
        </p>
        {people ? <PeopleList people={people} busy={busy} onRevoke={setRevoking} /> : <p className="text-sm text-ink-faint">Reading…</p>}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="A name, e.g. Ada" maxLength={60} />
          <Button size="sm" type="submit" disabled={busy || !name.trim()} title={on ? 'Make a token for one more person' : 'Make the first token: Access turns on, and this browser is signed in with it'}>
            {on ? 'Add person' : 'Add the first person'}
          </Button>
          {err && <span className="text-xs text-bad-ink">{err}</span>}
        </form>
      </div>
      <Modal open={!!made} title={made ? `${made.person.name}'s token` : ''} onClose={() => setMade(null)}>
        {made && (
          <div className="space-y-3 text-sm">
            <p className="text-ink-soft">Shown once. Copy it now and hand it over in private; Foundry keeps only a fingerprint of it.</p>
            <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
              <code className="mono font-semibold text-ink break-all">{made.token}</code>
              <CopyButton text={made.token} />
            </div>
            <p className="text-xs text-ink-faint">On a phone or laptop: open this Foundry's address, paste the token on the sign-in page. For the CLI: <span className="mono">FOUNDRY_TOKEN={made.token.slice(0, 8)}…</span></p>
            <Button size="sm" onClick={() => setMade(null)}>Done</Button>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!revoking} title={revoking ? `Revoke ${revoking.name}'s token?` : ''} confirmLabel="Revoke" danger busy={busy} onConfirm={() => void revoke()} onClose={() => setRevoking(null)}>
        <p className="text-sm text-ink-soft">Their token stops working at once, on every device. {people?.length === 1 ? 'It is the last one: Access turns off and anyone who can reach this address is let in again.' : ''}</p>
      </ConfirmDialog>
    </Card>
  );
}

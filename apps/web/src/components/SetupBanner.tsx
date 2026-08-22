import type { DoctorReport } from '@ai-engine/engine/skills-types';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';

/** Persistent banner shown while any required check fails. Polls the doctor every 60s. */
export function SetupBanner() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  useEffect(() => {
    const load = () => api.doctor().then(setReport).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!report || report.ok) return null;
  const errors = report.checks.filter((c) => !c.ok && c.severity === 'error');
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-4 py-2.5 flex items-center gap-3 text-sm mb-4">
      <CircleAlert size={16} className="text-rose-400 shrink-0" />
      <div className="flex-1">
        <span className="text-zinc-100">Setup incomplete:</span> <span className="text-zinc-300">{errors.map((e) => e.label).join(' · ')}</span>
      </div>
      <Link to="/setup" className="underline text-rose-300 whitespace-nowrap">
        Fix in Setup →
      </Link>
    </div>
  );
}

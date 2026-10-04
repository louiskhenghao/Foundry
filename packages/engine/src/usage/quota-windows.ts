import type { CodexQuota, CodexQuotaWindow } from './types.ts';

type Bucket = Extract<CodexQuota, { state: 'available' }>['buckets'][number];

/** Native slots describe order, not duration or entitlement. Never infer a missing account window. */
export function codexQuotaWindows(bucket: Pick<Bucket, 'primary' | 'secondary'>) {
  return (['primary', 'secondary'] as const).flatMap(slot => {
    const window = bucket[slot];
    return window ? [{ slot, window, label: quotaWindowLabel(window, slot) }] : [];
  });
}

function quotaWindowLabel(window: CodexQuotaWindow, slot: 'primary' | 'secondary'): string {
  const mins = window.windowDurationMins;
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return `${slot === 'primary' ? 'Primary' : 'Secondary'} window · duration unknown`;
  if (mins === 10080) return 'Weekly limit';
  if (mins === 1440) return 'Daily limit';
  if (mins % 1440 === 0) return `${mins / 1440}-day limit`;
  if (mins % 60 === 0) return `${mins / 60}-hour limit`;
  return `${mins}-minute limit`;
}

/** Compact header text stays account-derived, even when quota is absent or has several named buckets. */
export function codexQuotaSummary(quota?: CodexQuota): string {
  if (!quota || quota.state !== 'available') return 'quota unavailable';
  const windows = quota.buckets.flatMap(codexQuotaWindows);
  let summary = 'quota windows unavailable';
  if (windows.length === 1) {
    const { label, window } = windows[0]!;
    const percent = window.usedPercent;
    summary = `${label.replace(/ limit$/, '')} ${percent == null || !Number.isFinite(percent) ? 'usage unknown' : `${Math.round(percent * 10) / 10}% used`}`;
  } else if (windows.length > 1) {
    const label = windows[0]!.label;
    summary = label.endsWith(' limit') && windows.every(window => window.label === label)
      ? `${windows.length} ${label.toLowerCase()}s`
      : `${windows.length} quota windows`;
  }
  return quota.ordinaryUsageAllowed === false ? `blocked · ${summary}` : summary;
}

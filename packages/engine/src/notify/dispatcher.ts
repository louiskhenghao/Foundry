import { existsSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Turns engine events into push notifications on the configured channels (Settings → Notifications).
 * Fire-and-forget: a notification is a hint, not a ledger — sends are retried a couple of times,
 * then noted as an engine.note and dropped; nothing is queued or replayed after a restart.
 */
import type { EngineEvent, Escalation, EscalationTrigger, NotificationSettings } from '@foundry/core';
import { getGoal, isHistory } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { DiscordNotifier, TelegramNotifier, type Link, type MediaFile, type Notifier } from './channels.ts';
import { DeliveryDigest } from './digest.ts';

export interface Composed {
  family: 'goalFinished' | 'delivery' | 'rateLimit' | 'updateAvailable' | 'interview' | 'milestone';
  text: string;
  /** web-UI path the message links to, on this computer and on the tailnet */
  path: string | null;
}

const TRIGGER_COPY: Record<EscalationTrigger, string> = {
  brief_question: 'the Brief has a question only you can answer',
  retries_exhausted: 'a task ran out of attempts with checks still failing',
  boundary_action: 'an action wants to leave the local workspace',
  budget_exceeded: 'the goal hit its cost or time budget',
  permission_denial: 'the coding agent refused a tool call',
  milestone: 'a milestone landed — have a look, then continue or say what to change',
  delivery_failed: 'the delivery stopped — the reason and a Retry are in the Inbox',
};

/** Event → message for the non-escalation families; null = nothing to say about this event. */
export function compose(e: EngineEvent, goalTitle: (goalId: string | null) => string, defaultProvider: 'claude' | 'codex' = 'claude'): Composed | null {
  switch (e.type) {
    case 'interview.round_asked': {
      const qs = e.payload.questions;
      return { family: 'interview', text: `❓ Round ${e.payload.round} — ${goalTitle(e.goalId)}\n${qs.length} question(s) before the plan is written. First: ${(qs[0]?.text ?? '').slice(0, 200)}`, path: `/goals/${e.goalId}` };
    }
    case 'milestone.evidence': {
      const head = `📸 What the milestone looks like — ${goalTitle(e.goalId)}`;
      const body = e.payload.summary || (e.payload.error ? `Foundry could not record a walkthrough: ${e.payload.error}` : '');
      // what went wrong next to a walkthrough that was recorded anyway (error pages left out, no plan)
      const also = e.payload.summary && e.payload.error ? `⚠️ ${e.payload.error.slice(0, 300)}` : '';
      return { family: 'milestone', text: [head, body.slice(0, 600), also].filter(Boolean).join('\n'), path: `/goals/${e.goalId}` };
    }
    case 'goal.milestone_passed':
      return { family: 'milestone', text: `👀 Milestone — ${goalTitle(e.goalId)}\n${e.payload.lookFor.slice(0, 600)}\nThe goal goes on (Have a look is off for it).`, path: `/goals/${e.goalId}` };
    case 'goal.state_changed': {
      const { to, reason } = e.payload;
      // cancelled is always the human's own act — telling them what they just did carries no information
      if (to !== 'done' && to !== 'over_delivered' && to !== 'failed') return null;
      const head = to === 'failed' ? `❌ Goal failed — ${goalTitle(e.goalId)}` : to === 'over_delivered' ? `🏆 Goal over-delivered — ${goalTitle(e.goalId)}` : `✅ Goal done — ${goalTitle(e.goalId)}`;
      return { family: 'goalFinished', text: to === 'failed' ? `${head}\n${reason.slice(0, 300)}` : head, path: e.goalId ? `/goals/${e.goalId}` : null };
    }
    case 'delivery.pr_opened':
      return { family: 'delivery', text: `🔀 PR #${e.payload.number} opened — ${e.payload.title || goalTitle(e.goalId)}\n${e.payload.url}`, path: null };
    case 'delivery.merged':
      return { family: 'delivery', text: `🎉 PR ${e.payload.prNumber != null ? `#${e.payload.prNumber} ` : ''}merged — ${goalTitle(e.goalId)}`, path: e.goalId ? `/goals/${e.goalId}` : null };
    case 'delivery.failed':
      return { family: 'delivery', text: `⚠️ Delivery failed at ${e.payload.step} — ${goalTitle(e.goalId)}\n${e.payload.reason.slice(0, 300)}`, path: e.goalId ? `/goals/${e.goalId}` : null };
    case 'rate_limit.paused': {
      const provider = e.payload.provider ?? defaultProvider;
      return { family: 'rateLimit', text: `⏸️ ${provider === 'codex' ? 'Codex' : 'Claude Code'} usage limit — new sessions paused; retry at ${e.payload.until}`, path: `/usage?provider=${provider}` };
    }
    case 'rate_limit.resumed': {
      const provider = e.payload.provider ?? defaultProvider;
      return { family: 'rateLimit', text: `▶️ ${provider === 'codex' ? 'Codex' : 'Claude Code'} session retries resume`, path: `/usage?provider=${provider}` };
    }
    case 'update.available':
      // the checker announces once per version, so this family never repeats itself
      return { family: 'updateAvailable', text: `⬆️ Foundry ${e.payload.latest} is available — you run ${e.payload.current}`, path: '/settings' };
    default:
      return null;
  }
}

/** Escalation → message ("needs you" — the one family that maps to the domain's blocked). */
export function composeEscalation(esc: Escalation, goalTitle: (goalId: string | null) => string): { text: string; path: string } {
  // a milestone is an invitation, not a problem: the whole note (what to look at, the preview link) and the goal page
  // the preview's address goes under the message as links (see links()), not in its text
  if (esc.trigger === 'milestone') return { text: `👀 Have a look — ${goalTitle(esc.goalId)}\n${esc.message.replace(/\s*Preview: \S+\s*$/, '').slice(0, 700)}`, path: `/goals/${esc.goalId}` };
  return { text: `🛑 Needs you — ${goalTitle(esc.goalId)}\n${TRIGGER_COPY[esc.trigger]}\n${(esc.message.split('\n')[0] ?? '').slice(0, 300)}`, path: '/inbox' };
}

const RETRY_DELAYS_MS = [2_000, 10_000];

export class NotificationDispatcher {
  /** a stacked delivery's PRs are told in a few messages, not one per PR */
  private digest = new DeliveryDigest((m) => {
    const s = this.settings();
    if (s.onDelivery) this.deliver(s, m.text, m.path, m.goalId);
  });

  constructor(private engine: Engine) {}

  /** Subscribe to the event log and the escalation hook; called once from the Engine constructor. */
  attach(): void {
    this.engine.store.subscribe((e) => this.onEvent(e));
    this.engine.onEscalation((esc) => this.onEscalation(esc));
  }

  /** Settings are read at send time so changes apply immediately, no config mirroring needed. */
  private settings(): NotificationSettings {
    return this.engine.settings.values().notifications;
  }

  private channels(s: NotificationSettings): Notifier[] {
    const out: Notifier[] = [];
    if (s.telegramBotToken && s.telegramChatId) out.push(new TelegramNotifier(s.telegramBotToken, s.telegramChatId));
    if (s.discordWebhookUrl) out.push(new DiscordNotifier(s.discordWebhookUrl));
    return out;
  }

  private goalTitle = (goalId: string | null): string => (goalId ? (getGoal(this.engine.store.db, goalId)?.title ?? goalId) : '');

  private onEvent(e: EngineEvent): void {
    // an Imported Goal's past, and what the Transfer wrote to close it, is not news (ADR-0030)
    const goal = e.goalId ? getGoal(this.engine.store.db, e.goalId) : null;
    if (goal && isHistory(goal)) return;
    if (this.settings().onDelivery && this.digest.take(e, this.goalTitle(e.goalId))) return;
    const c = compose(e, this.goalTitle, this.engine.config.provider);
    if (!c) return;
    const s = this.settings();
    // a milestone is the same note whether the goal pauses for it (an escalation) or goes on
    const on = { goalFinished: s.onGoalFinished, delivery: s.onDelivery, rateLimit: s.onRateLimit, updateAvailable: s.onUpdateAvailable, interview: s.onInterview, milestone: s.onEscalation }[c.family];
    if (on) this.deliver(s, c.text, c.path, e.goalId, e.type === 'milestone.evidence' && e.goalId ? this.evidenceFiles(e.goalId, e.payload) : []);
  }

  private onEscalation(esc: Escalation): void {
    const s = this.settings();
    if (!s.onEscalation) return;
    const c = composeEscalation(esc, this.goalTitle);
    // a milestone's screenshots and recording follow in their own message (milestone.evidence)
    const preview = esc.trigger === 'milestone' ? ((esc.payload as { previewUrl?: string | null }).previewUrl ?? null) : null;
    this.deliver(s, c.text, c.path, esc.goalId, [], preview);
  }

  /**
   * The links under a message: the page in Foundry (the link base URL, else this computer) and the same page on the
   * tailnet; a milestone's preview both ways too. Written as links because the apps do not linkify localhost addresses.
   */
  async links(s: NotificationSettings, path: string | null, preview: string | null = null): Promise<Link[]> {
    const out: Link[] = [];
    const { tailnet, config } = this.engine;
    if (path) {
      const base = (s.baseUrl ?? `http://localhost:${config.port}`).replace(/\/+$/, '');
      out.push({ label: 'Open in Foundry', url: `${base}${path}` });
      const ts = await tailnet.expose(config.port).catch(() => null);
      if (ts && !base.startsWith(ts)) out.push({ label: 'Open on your tailnet', url: `${ts.replace(/\/+$/, '')}${path}` });
    }
    if (preview) {
      out.push({ label: 'Open the preview', url: preview });
      const port = Number(URL.parse(preview)?.port);
      const ts = port ? await tailnet.expose(port).catch(() => null) : null;
      if (ts) out.push({ label: 'Open the preview on your tailnet', url: ts });
    }
    return out;
  }

  /** a walkthrough's screenshots and video as files; without any, the self-check's newest screenshot */
  private evidenceFiles(goalId: string, ev: { video: string | null; shots: { file: string }[] }): MediaFile[] {
    const goal = getGoal(this.engine.store.db, goalId);
    if (!goal) return [];
    const dir = screenshotsDir(this.engine.config.dataDir, goal);
    const files: MediaFile[] = [...ev.shots.map((s) => ({ path: join(dir, s.file), kind: 'photo' as const })), ...(ev.video ? [{ path: join(dir, ev.video), kind: 'video' as const }] : [])].filter((f) => existsSync(f.path));
    if (files.length) return files;
    const last = this.latestScreenshot(goalId);
    return last ? [{ path: last, kind: 'photo' }] : [];
  }

  /** the self-check's newest screenshot of a goal, as a file path, or null */
  private latestScreenshot(goalId: string): string | null {
    const goal = getGoal(this.engine.store.db, goalId);
    if (!goal) return null;
    const last = this.engine.store
      .listByGoal(goalId, 5000)
      .filter((e) => e.type === 'selfcheck.finished' && (e.payload as { screenshot: string | null }).screenshot)
      .at(-1);
    if (!last) return null;
    const p = join(screenshotsDir(this.engine.config.dataDir, goal), (last.payload as { screenshot: string }).screenshot);
    return existsSync(p) ? p : null;
  }

  private deliver(s: NotificationSettings, text: string, path: string | null, goalId: string | null, media: MediaFile[] = [], preview: string | null = null): void {
    const channels = this.channels(s);
    if (!channels.length) return;
    void this.links(s, path, preview).then((links) => {
      for (const ch of channels) void this.sendWithRetry(ch, media.length && ch.sendMedia ? () => ch.sendMedia!(text, media, links) : () => ch.send(text, links), goalId);
    });
  }

  private async sendWithRetry(ch: Notifier, send: () => Promise<void>, goalId: string | null): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await send();
        return;
      } catch (err) {
        if (i >= RETRY_DELAYS_MS.length) {
          this.engine.config.log(`[notify] ${ch.name} failed: ${String(err)}`);
          this.engine.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `notification via ${ch.name} failed after ${i + 1} tries: ${String(err).slice(0, 200)}` } });
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
    }
  }

  /** Settings page "send test": tries the draft (unsaved) credentials layered over the saved ones. */
  async test(override: Partial<NotificationSettings> = {}): Promise<{ channel: string; ok: boolean; error: string | null }[]> {
    const channels = this.channels({ ...this.settings(), ...override });
    return Promise.all(
      channels.map(async (ch) => {
        try {
          await ch.send('👋 Foundry test notification — this channel works.');
          return { channel: ch.name, ok: true, error: null };
        } catch (err) {
          return { channel: ch.name, ok: false, error: String(err).slice(0, 300) };
        }
      }),
    );
  }
}

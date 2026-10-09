/**
 * Outbound notification channels. Sending is engine code acting under the user's standing
 * authorisation (Settings), never the model — same rule as Delivery (ADR-0003).
 */

export interface Notifier {
  readonly name: string;
  /** deliver one message, its links clickable; throws on failure */
  send(text: string, links?: Link[]): Promise<void>;
  /** deliver an image with a caption (a milestone screenshot); channels without it get the text alone */
  sendPhoto?(caption: string, file: string, links?: Link[]): Promise<void>;
  /** deliver screenshots and a video with a caption; files over the channel's size limit are left out and the caption says so */
  sendMedia?(caption: string, files: MediaFile[], links?: Link[]): Promise<void>;
}

/** a link under a message: localhost addresses are not linkified from plain text by the apps, so they are sent as links */
export interface Link {
  label: string;
  url: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Whether a phone could open the address: localhost and bare host names only work on the computer Foundry runs on, and
 * Telegram drops such links, leaving their label as plain text. Set a link base URL (or use the tailnet) for links.
 */
export function reachableUrl(url: string): boolean {
  const host = URL.parse(url)?.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || host.startsWith('127.')) return false;
  return host.includes('.') || host.includes(':');
}

/**
 * Telegram HTML: the first line (the message's title) bold, the rest escaped, then each link on its own line — a named
 * anchor, or for an address only this computer can open the label and the address as code (a tap copies it).
 */
export function telegramHtml(text: string, links: Link[]): string {
  const [head = '', ...rest] = text.split('\n');
  const body = [head ? `<b>${escapeHtml(head)}</b>` : '', ...rest.map(escapeHtml)].join('\n');
  const link = (l: Link) => (reachableUrl(l.url) ? `<a href="${escapeHtml(l.url).replace(/"/g, '&quot;')}">${escapeHtml(l.label)}</a>` : `${escapeHtml(l.label)}: <code>${escapeHtml(l.url)}</code>`);
  return [body, ...links.map(link)].join('\n');
}
/** plain text with the addresses written out: what a channel gets when it refuses a link */
export function plainLinks(text: string, links: Link[]): string {
  return [text, ...links.map((l) => `${l.label}: ${l.url}`)].join('\n');
}
/** Discord markdown: the first line (the title) bold, then masked links in angle brackets so no preview card unfolds */
export function discordLinks(text: string, links: Link[]): string {
  const [head = '', ...rest] = text.split('\n');
  const escaped = head.replace(/([*_~`|\\])/g, '\\$1');
  const title = head ? `**${escaped}**` : '';
  return [[title, ...rest].join('\n'), ...links.map((l) => `[${l.label.replace(/[[\]]/g, '')}](<${l.url}>)`)].join('\n');
}

export interface MediaFile {
  path: string;
  kind: 'photo' | 'video';
}

/** files that fit a channel's limits, in order, and a note for the caption when a video did not */
export function fitting(files: MediaFile[], max: { photo: number; video: number; total: number; count: number }): { files: MediaFile[]; note: string | null } {
  const out: MediaFile[] = [];
  let total = 0;
  let droppedVideo = false;
  for (const f of files) {
    const size = Bun.file(f.path).size;
    if (out.length >= max.count || size > max[f.kind] || total + size > max.total) {
      if (f.kind === 'video') droppedVideo = true;
      continue;
    }
    out.push(f);
    total += size;
  }
  return { files: out, note: droppedVideo ? 'The recording is too large to attach here; it is on the goal page.' : null };
}

const blob = async (f: MediaFile) => new Blob([await Bun.file(f.path).arrayBuffer()], { type: f.kind === 'video' ? 'video/webm' : 'image/png' });
const fileName = (f: MediaFile) => f.path.split('/').pop() ?? (f.kind === 'video' ? 'recording.webm' : 'screenshot.png');

const TELEGRAM_API = 'https://api.telegram.org';
/** Discord caps content at 2000 chars, Telegram at 4096; stay under both */
const MAX_LEN = 1900;

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
}

export class TelegramNotifier implements Notifier {
  readonly name = 'telegram';
  constructor(
    private token: string,
    private chatId: string,
  ) {}
  async send(text: string, links: Link[] = []): Promise<void> {
    const html = { chat_id: this.chatId, text: telegramHtml(text.slice(0, MAX_LEN - 400), links), parse_mode: 'HTML', disable_web_page_preview: true };
    let res = await post(`${TELEGRAM_API}/bot${this.token}/sendMessage`, html);
    // markup or a link Telegram will not take (it is strict about some hosts): plain text, the addresses written out
    if (!res.ok && res.status === 400) res = await post(`${TELEGRAM_API}/bot${this.token}/sendMessage`, { chat_id: this.chatId, text: plainLinks(text, links).slice(0, MAX_LEN), disable_web_page_preview: true });
    if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  /** sendPhoto: multipart with the PNG bytes; captions are capped at 1024 by Telegram */
  async sendPhoto(caption: string, file: string, links: Link[] = []): Promise<void> {
    await this.upload('sendPhoto', caption, links, async (form, text, html) => {
      form.set('caption', text);
      if (html) form.set('parse_mode', 'HTML');
      form.set('photo', await blob({ path: file, kind: 'photo' }), fileName({ path: file, kind: 'photo' }));
    });
  }
  /** one photo or video as itself, several as an album (sendMediaGroup, up to 10); bots may upload 10 MB photos and 50 MB videos */
  async sendMedia(caption: string, all: MediaFile[], links: Link[] = []): Promise<void> {
    const { files, note } = fitting(all, { photo: 10e6, video: 50e6, total: 50e6, count: 10 });
    const plain = [caption, note].filter(Boolean).join('\n');
    if (!files.length) return this.send(plain, links);
    if (files.length === 1 && files[0]!.kind === 'photo') return this.sendPhoto(plain, files[0]!.path, links);
    if (files.length === 1)
      return this.upload('sendVideo', plain, links, async (form, text, html) => {
        form.set('caption', text);
        if (html) form.set('parse_mode', 'HTML');
        form.set('video', await blob(files[0]!), fileName(files[0]!));
      });
    await this.upload('sendMediaGroup', plain, links, async (form, text, html) => {
      form.set('media', JSON.stringify(files.map((f, i) => ({ type: f.kind, media: `attach://f${i}`, ...(i === 0 ? { caption: text, ...(html ? { parse_mode: 'HTML' } : {}) } : {}) }))));
      for (const [i, f] of files.entries()) form.set(`f${i}`, await blob(f), fileName(f));
    });
  }
  /** a multipart upload with a caption (1024 at most): its links as HTML, written out when Telegram refuses them */
  private async upload(method: string, caption: string, links: Link[], fill: (form: FormData, text: string, html: boolean) => Promise<void>): Promise<void> {
    const room = 1000 - links.reduce((n, l) => n + l.url.length + l.label.length + 20, 0);
    let res: Response | null = null;
    for (const html of [true, false]) {
      const form = new FormData();
      form.set('chat_id', this.chatId);
      await fill(form, html ? telegramHtml(caption.slice(0, room), links) : plainLinks(caption.slice(0, room), links), html);
      res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
      if (res.ok || res.status !== 400) break;
    }
    if (!res!.ok) throw new Error(`telegram ${res!.status}: ${(await res!.text().catch(() => '')).slice(0, 200)}`);
  }
}

export class DiscordNotifier implements Notifier {
  readonly name = 'discord';
  constructor(private webhookUrl: string) {}
  async send(text: string, links: Link[] = []): Promise<void> {
    let res = await post(this.webhookUrl, { content: discordLinks(text, links).slice(0, MAX_LEN) });
    if (!res.ok && links.length && res.status === 400) res = await post(this.webhookUrl, { content: plainLinks(text, links).slice(0, MAX_LEN) });
    if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  async sendPhoto(caption: string, file: string, links: Link[] = []): Promise<void> {
    return this.sendMedia(caption, [{ path: file, kind: 'photo' }], links);
  }
  /** attachments on the webhook message: up to 10 files, 10 MB together on servers without a boost */
  async sendMedia(caption: string, all: MediaFile[], links: Link[] = []): Promise<void> {
    const { files, note } = fitting(all, { photo: 9.5e6, video: 9.5e6, total: 9.5e6, count: 10 });
    const plain = [caption, note].filter(Boolean).join('\n');
    if (!files.length) return this.send(plain, links);
    const content = discordLinks(plain, links).slice(0, MAX_LEN);
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content }));
    for (const [i, f] of files.entries()) form.set(`files[${i}]`, await blob(f), fileName(f));
    const res = await fetch(this.webhookUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

/**
 * The classic Telegram onboarding pain: the numeric chat id is not shown anywhere in the app.
 * After the user sends the bot any message, the newest chat in getUpdates is theirs.
 */
export async function detectTelegramChatId(token: string): Promise<{ chatId: string; who: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates?limit=100`, { signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { message?: { chat?: { id: number; type: string; username?: string; first_name?: string; title?: string } } }[] } | null;
  if (!j?.ok) throw new Error(j?.description ?? `telegram ${res.status}`);
  const chat = (j.result ?? [])
    .map((u) => u.message?.chat)
    .filter((c) => c != null)
    .at(-1);
  if (!chat) throw new Error('no messages yet — open your bot in Telegram, send it any message, then detect again');
  return { chatId: String(chat.id), who: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id) };
}

/**
 * Outbound notification channels. Sending is engine code acting under the user's standing
 * authorisation (Settings), never the model — same rule as Delivery (ADR-0003).
 */

export interface Notifier {
  readonly name: string;
  /** deliver one plain-text message; throws on failure */
  send(text: string): Promise<void>;
  /** deliver an image with a caption (a milestone screenshot); channels without it get the text alone */
  sendPhoto?(caption: string, file: string): Promise<void>;
  /** deliver screenshots and a video with a caption; files over the channel's size limit are left out and the caption says so */
  sendMedia?(caption: string, files: MediaFile[]): Promise<void>;
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
  async send(text: string): Promise<void> {
    const res = await post(`${TELEGRAM_API}/bot${this.token}/sendMessage`, { chat_id: this.chatId, text: text.slice(0, MAX_LEN), disable_web_page_preview: true });
    if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  /** sendPhoto: multipart with the PNG bytes; captions are capped at 1024 by Telegram */
  async sendPhoto(caption: string, file: string): Promise<void> {
    const form = new FormData();
    form.set('chat_id', this.chatId);
    form.set('caption', caption.slice(0, 1000));
    form.set('photo', new Blob([await Bun.file(file).arrayBuffer()], { type: 'image/png' }), file.split('/').pop() ?? 'screenshot.png');
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  /** one photo or video as itself, several as an album (sendMediaGroup, up to 10); bots may upload 10 MB photos and 50 MB videos */
  async sendMedia(caption: string, all: MediaFile[]): Promise<void> {
    const { files, note } = fitting(all, { photo: 10e6, video: 50e6, total: 50e6, count: 10 });
    const text = [caption, note].filter(Boolean).join('\n').slice(0, 1000);
    if (!files.length) return this.send(text);
    if (files.length === 1 && files[0]!.kind === 'photo') return this.sendPhoto(text, files[0]!.path);
    const form = new FormData();
    form.set('chat_id', this.chatId);
    let method = 'sendMediaGroup';
    if (files.length === 1) {
      method = 'sendVideo';
      form.set('caption', text);
      form.set('video', await blob(files[0]!), fileName(files[0]!));
    } else {
      form.set('media', JSON.stringify(files.map((f, i) => ({ type: f.kind, media: `attach://f${i}`, ...(i === 0 ? { caption: text } : {}) }))));
      for (const [i, f] of files.entries()) form.set(`f${i}`, await blob(f), fileName(f));
    }
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

export class DiscordNotifier implements Notifier {
  readonly name = 'discord';
  constructor(private webhookUrl: string) {}
  async send(text: string): Promise<void> {
    const res = await post(this.webhookUrl, { content: text.slice(0, MAX_LEN) });
    if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  async sendPhoto(caption: string, file: string): Promise<void> {
    return this.sendMedia(caption, [{ path: file, kind: 'photo' }]);
  }
  /** attachments on the webhook message: up to 10 files, 10 MB together on servers without a boost */
  async sendMedia(caption: string, all: MediaFile[]): Promise<void> {
    const { files, note } = fitting(all, { photo: 9.5e6, video: 9.5e6, total: 9.5e6, count: 10 });
    const content = [caption, note].filter(Boolean).join('\n').slice(0, MAX_LEN);
    if (!files.length) return this.send(content);
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

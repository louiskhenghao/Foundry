/**
 * Outbound notification channels. Sending is engine code acting under the user's standing
 * authorisation (Settings), never the model — same rule as Delivery (ADR-0003).
 */

export interface Notifier {
  readonly name: string;
  /** deliver one plain-text message; throws on failure */
  send(text: string): Promise<void>;
}

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
}

export class DiscordNotifier implements Notifier {
  readonly name = 'discord';
  constructor(private webhookUrl: string) {}
  async send(text: string): Promise<void> {
    const res = await post(this.webhookUrl, { content: text.slice(0, MAX_LEN) });
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

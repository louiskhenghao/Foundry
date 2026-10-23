import { HindsightClient, createClient, createConfig, sdk } from '@vectorize-io/hindsight-client';
import type { KnowledgePageSpec, MemoryBackend, MemoryConnection, MemoryDocument, ReflectOptions } from './types.ts';

type BankList = { banks: { bank_id: string }[]; total: number };
type KnowledgeTree = { roots?: { kind: 'folder' | 'page'; name: string }[] };

/** Memory's server, through Hindsight's own TypeScript client (ADR-0071): the bearer token goes as `Authorization` */
export class HindsightBackend implements MemoryBackend {
  private readonly api: HindsightClient;
  /** the generated client under the typed one, for the bank list the typed one has no method for */
  private readonly raw: ReturnType<typeof createClient>;

  constructor(c: MemoryConnection) {
    const baseUrl = c.url.replace(/\/+$/, '');
    const auth = c.token ? { Authorization: `Bearer ${c.token}` } : {};
    this.api = new HindsightClient({ baseUrl, ...(c.token ? { apiKey: c.token } : {}), userAgent: 'foundry', maxAttempts: 2 });
    this.raw = createClient(createConfig({ baseUrl, headers: { 'User-Agent': 'foundry', ...auth } }));
  }

  async version(signal?: AbortSignal): Promise<string> {
    const v = await this.api.getVersion({ signal });
    return v.api_version;
  }

  async listBanks(signal?: AbortSignal): Promise<string[]> {
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const r = await sdk.listBanks({ client: this.raw, query: { limit: 200, offset }, signal, throwOnError: true });
      const page = ((r as { data?: BankList }).data ?? r) as BankList;
      const banks = page.banks ?? [];
      ids.push(...banks.map((b) => b.bank_id));
      offset += banks.length;
      if (!banks.length || ids.length >= (page.total ?? ids.length)) return ids;
    }
  }

  async createBank(bankId: string, opts: { name: string; mission: string }, signal?: AbortSignal): Promise<void> {
    await this.api.createBank(bankId, { name: opts.name, mission: opts.mission, signal });
  }

  async hasDocuments(bankId: string, signal?: AbortSignal): Promise<boolean> {
    const r = await this.api.listDocuments(bankId, { limit: 1, signal });
    return (r.total ?? 0) > 0 || r.items.length > 0;
  }

  async retain(bankId: string, doc: MemoryDocument, signal?: AbortSignal): Promise<void> {
    // async: the server takes the document and extracts in the background; a stage never waits for extraction
    await this.api.retain(bankId, doc.content, { context: doc.context, documentId: doc.documentId, tags: doc.tags, metadata: doc.metadata, updateMode: doc.updateMode, async: true, signal });
  }

  async reflect(bankId: string, query: string, opts: ReflectOptions): Promise<string> {
    const r = await this.api.reflect(bankId, query, { budget: opts.budget ?? 'low', context: opts.context, tags: opts.tags, signal: opts.signal });
    return r.text ?? '';
  }

  async recall(bankId: string, query: string, opts: { maxTokens?: number; signal?: AbortSignal }): Promise<string[]> {
    const r = await this.api.recall(bankId, query, { budget: 'low', maxTokens: opts.maxTokens ?? 500, signal: opts.signal });
    return (r.results ?? []).map((x) => x.text).filter((t) => typeof t === 'string' && t.trim());
  }

  async listKnowledgePages(bankId: string, signal?: AbortSignal): Promise<string[]> {
    const r = await sdk.getKnowledgeBaseTree({ client: this.raw, path: { bank_id: bankId }, signal, throwOnError: true });
    const tree = ((r as { data?: KnowledgeTree }).data ?? r) as KnowledgeTree;
    return (tree.roots ?? []).filter((n) => n.kind === 'page').map((n) => n.name);
  }

  async createKnowledgePage(bankId: string, page: KnowledgePageSpec, signal?: AbortSignal): Promise<void> {
    await this.api.createKnowledgePage(bankId, page.name, page.sourceQuery, { tags: page.tags, maxTokens: page.maxTokens, trigger: { refreshCron: page.trigger.refreshCron, factTypes: page.trigger.factTypes, tagsMatch: page.trigger.tagsMatch }, signal });
  }
}

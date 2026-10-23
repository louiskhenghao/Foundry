/** Test double (not exported from the package index): a Hindsight server in memory, remembering what it was asked and given. */
import type { KnowledgePageSpec, MemoryBackend, MemoryDocument, ReflectOptions } from './types.ts';

export class FakeMemoryBackend implements MemoryBackend {
  banks = new Set<string>();
  created: { id: string; mission: string }[] = [];
  docs = new Map<string, MemoryDocument[]>();
  pages = new Map<string, KnowledgePageSpec[]>();
  questions: string[] = [];
  answer: string | ((signal?: AbortSignal) => Promise<string>) = 'remember: the tests need bun install first';
  failRetain = false;
  down = false;
  async version() {
    if (this.down) throw new Error('connection refused');
    return '1.1.0-test';
  }
  async listBanks() {
    return [...this.banks];
  }
  async createBank(id: string, opts: { mission: string }) {
    this.banks.add(id);
    this.created.push({ id, mission: opts.mission });
  }
  async hasDocuments(id: string) {
    return (this.docs.get(id)?.length ?? 0) > 0;
  }
  async retain(id: string, doc: MemoryDocument) {
    if (this.failRetain) throw new Error('boom: the server refused');
    this.docs.set(id, [...(this.docs.get(id) ?? []), doc]);
  }
  async reflect(_id: string, query: string, opts: ReflectOptions) {
    this.questions.push(query);
    return typeof this.answer === 'function' ? this.answer(opts.signal) : this.answer;
  }
  async listKnowledgePages(id: string) {
    return (this.pages.get(id) ?? []).map((p) => p.name);
  }
  async createKnowledgePage(id: string, page: KnowledgePageSpec) {
    this.pages.set(id, [...(this.pages.get(id) ?? []), page]);
  }
  /** every document of every bank, newest last */
  all(): MemoryDocument[] {
    return [...this.docs.values()].flat();
  }
  /** the document with this id, wherever it is */
  find(documentId: string): MemoryDocument | undefined {
    return this.all().find((d) => d.documentId === documentId);
  }
}

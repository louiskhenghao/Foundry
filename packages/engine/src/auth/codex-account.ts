import { CodexAccountReadError, rpcObject, withCodexAccountRpc, type CodexAccountReadOptions } from './codex-app-server.ts';

export interface CodexChatGptAccount { type: 'chatgpt'; email: string | null; planType: string | null }

/** Select only account identity fields. API-key and alternative provider accounts are never accepted. */
export function parseCodexAccount(value: unknown): CodexChatGptAccount | null {
  if (!rpcObject(value) || !('account' in value)) throw new CodexAccountReadError('Codex returned an invalid account response.', 'protocol');
  if (value.account === null) return null;
  const account = value.account;
  if (!rpcObject(account)) throw new CodexAccountReadError('Codex returned an invalid account.', 'protocol');
  if (account.type !== 'chatgpt') throw new CodexAccountReadError('Sign in with ChatGPT using codex login; API-key and alternative provider accounts are not used by Foundry.', 'auth');
  if ((account.email !== null && typeof account.email !== 'string') || (account.planType !== null && typeof account.planType !== 'string')) throw new CodexAccountReadError('Codex returned invalid ChatGPT account details.', 'protocol');
  if ((account.email?.length ?? 0) > 500 || (account.planType?.length ?? 0) > 100) throw new CodexAccountReadError('Codex account details exceeded the size limit.', 'protocol');
  return { type: 'chatgpt', email: account.email as string | null, planType: account.planType as string | null };
}

/** Ask the native CLI for public account identity without requesting a token refresh or opening a thread. */
export async function readCodexAccount(bin: string, home?: string, options: CodexAccountReadOptions = {}): Promise<CodexChatGptAccount | null> {
  return withCodexAccountRpc(bin, home, options, async (request) => parseCodexAccount(await request('account/read', { refreshToken: false })));
}

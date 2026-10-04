/** initialize.userAgent uses the caller's clientInfo.name in a normal terminal, not always "Codex". */
export function codexVersionFromUserAgent(value: unknown, clientName: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const caller = clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.match(new RegExp(`^(?:codex(?:[ _-](?:desktop|cli(?:_rs)?))?|${caller})/(\\d+\\.\\d+\\.\\d+(?:[-+][\\w.+-]+)?)(?:\\s|$)`, 'i'))?.[1];
}

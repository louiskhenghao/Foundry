/** Errors that carry their own HTTP status (409/422…) instead of the default 400. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'error'));
  }
}

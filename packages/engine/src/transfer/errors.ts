/** A Transfer that cannot go on, said in words the person can act on; `status` is what the API answers with */
export class TransferError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { SealedSecrets, TransferSecrets } from '@foundry/core';
import { TransferError } from './errors.ts';

/** scrypt cost: about a tenth of a second per guess on a laptop, so a weak password still costs an attacker dearly */
const KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
const MAXMEM = 64 * 1024 * 1024;

const keyFor = (password: string, salt: Buffer, s: { N: number; r: number; p: number }) => scryptSync(password.normalize('NFC'), salt, 32, { N: s.N, r: s.r, p: s.p, maxmem: MAXMEM });

/**
 * Seal Keys & secrets with the person's password (ADR-0030). The Transfer's id is authenticated with them, so a sealed
 * block moved into another Transfer file does not open there.
 */
export function sealSecrets(secrets: TransferSecrets, password: string, transferId: string): SealedSecrets {
  if (!password) throw new TransferError('Keys & secrets need a password');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(password, salt, KDF), iv);
  cipher.setAAD(Buffer.from(transferId));
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return { kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** Open sealed Keys & secrets; a wrong password (or a tampered file) is one and the same refusal */
export function openSecrets(sealed: SealedSecrets, password: string, transferId: string): TransferSecrets {
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(password, Buffer.from(sealed.salt, 'base64'), sealed), Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(transferId));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
    return TransferSecrets.parse(JSON.parse(plain));
  } catch {
    throw new TransferError('wrong password for Keys & secrets', 422);
  }
}

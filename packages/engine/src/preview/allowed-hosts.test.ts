import { describe, expect, test } from 'bun:test';
import { VITE_ALLOWED_HOSTS, allowedHostsEnv } from './manager.ts';

describe('allowedHostsEnv', () => {
  test("the tailnet name is added to the hosts Vite answers to, beside the ones the person's Preview environment names", () => {
    expect(allowedHostsEnv({}, null)).toEqual({});
    expect(allowedHostsEnv({ [VITE_ALLOWED_HOSTS]: 'dev.example.com' }, null)).toEqual({});
    expect(allowedHostsEnv({}, 'mac.tail-1.ts.net')).toEqual({ [VITE_ALLOWED_HOSTS]: 'mac.tail-1.ts.net' });
    expect(allowedHostsEnv({ [VITE_ALLOWED_HOSTS]: 'dev.example.com' }, 'mac.tail-1.ts.net')).toEqual({ [VITE_ALLOWED_HOSTS]: 'dev.example.com,mac.tail-1.ts.net' });
    // already there: not twice
    expect(allowedHostsEnv({ [VITE_ALLOWED_HOSTS]: 'dev.example.com, mac.tail-1.ts.net' }, 'mac.tail-1.ts.net')).toEqual({ [VITE_ALLOWED_HOSTS]: 'dev.example.com,mac.tail-1.ts.net' });
  });
});

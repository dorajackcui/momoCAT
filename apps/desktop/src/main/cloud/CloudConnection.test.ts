import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudConnection } from './CloudConnection';

const harness = vi.hoisted(() => ({
  fetch: vi.fn(),
  encryptionAvailable: vi.fn(() => true),
  decrypt: vi.fn((data: Buffer) => data.toString()),
  encrypt: vi.fn((data: string) => Buffer.from(data)),
}));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: harness.encryptionAvailable,
    decryptString: harness.decrypt,
    encryptString: harness.encrypt,
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('undici', () => ({ fetch: harness.fetch }));

describe('persistent cloud account connection', () => {
  let directory: string;
  let credentials: string;
  const origin = 'https://cloud.example.test';
  const account = { id: 'alice', name: 'Alice', email: 'alice@example.test' };
  const saved = (overrides: Record<string, unknown> = {}) => ({
    origin,
    token: Buffer.from('test-encrypted-token').toString('base64'),
    account,
    ...overrides,
  });
  const store = (value = saved()) => writeFileSync(credentials, JSON.stringify(value));
  beforeEach(() => {
    vi.clearAllMocks();
    harness.encryptionAvailable.mockReturnValue(true);
    harness.fetch.mockReset();
    directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-connection-'));
    credentials = join(directory, 'session.json');
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reopens a previously authenticated account during a network outage', async () => {
    store();
    harness.fetch.mockRejectedValue(new Error('Offline'));
    const connection = new CloudConnection(origin, credentials);
    await connection.initialize();
    expect(connection.account).toEqual(account);
    expect(JSON.parse(readFileSync(credentials, 'utf8'))).toEqual(saved());
    expect(harness.fetch).toHaveBeenCalledWith(
      `${origin}/v1/me`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-encrypted-token' },
      }),
    );
  });

  it('refreshes and atomically persists account metadata while retaining encrypted credentials', async () => {
    store(saved({ account: undefined }));
    const refreshed = { ...account, name: 'Updated Alice' };
    harness.fetch.mockResolvedValue(new Response(JSON.stringify(refreshed)));
    const connection = new CloudConnection(origin, credentials);
    await connection.initialize();
    expect(connection.account).toEqual(refreshed);
    expect(JSON.parse(readFileSync(credentials, 'utf8'))).toEqual(saved({ account: refreshed }));
    expect(existsSync(`${credentials}.tmp`)).toBe(false);
  });

  it.each([401, 403])(
    'removes rejected %i credentials and temporary credentials from disk',
    async (status) => {
      store();
      writeFileSync(`${credentials}.tmp`, 'interrupted encrypted credential write');
      harness.fetch.mockResolvedValue(new Response('', { status }));
      const connection = new CloudConnection(origin, credentials);
      await connection.initialize();
      expect(connection.account).toBeNull();
      expect(existsSync(credentials)).toBe(false);
      expect(existsSync(`${credentials}.tmp`)).toBe(false);
      harness.fetch.mockResolvedValue(new Response('{}'));
      await connection.request('/probe');
      expect(harness.fetch).toHaveBeenLastCalledWith(
        `${origin}/probe`,
        expect.objectContaining({ headers: {} }),
      );
    },
  );

  it('isolates credentials from a different service origin without deleting them', async () => {
    store(saved({ origin: 'https://other.example.test' }));
    const connection = new CloudConnection(origin, credentials);
    await connection.initialize();
    expect(connection.account).toBeNull();
    expect(harness.decrypt).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(existsSync(credentials)).toBe(true);
  });

  it('logs out locally even if the sign-out request fails, clearing both credential files', async () => {
    store();
    writeFileSync(`${credentials}.tmp`, 'interrupted encrypted credential write');
    harness.fetch.mockRejectedValue(new Error('Offline'));
    const connection = new CloudConnection(origin, credentials);
    await connection.initialize();
    expect(connection.account).toEqual(account);
    await connection.logout();
    expect(connection.account).toBeNull();
    expect(existsSync(credentials)).toBe(false);
    expect(existsSync(`${credentials}.tmp`)).toBe(false);
    expect(harness.fetch).toHaveBeenLastCalledWith(
      `${origin}/api/auth/sign-out`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it.each([undefined, 123, '../outside'])(
    'does not trust an invalid cached account identity %s while offline',
    async (id) => {
      store(saved({ account: { ...account, id } }));
      harness.fetch.mockRejectedValue(new Error('Offline'));
      const connection = new CloudConnection(origin, credentials);
      await connection.initialize();
      expect(connection.account).toBeNull();
    },
  );
});

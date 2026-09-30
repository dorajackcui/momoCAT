import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';

const login = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string; emailVerified: boolean; name: string };
  },
}));
vi.mock('./auth', () => ({
  createAuth: () => ({
    api: { getSession: async () => login.session },
  }),
}));
import worker from './index';

describe('authenticated V2 Worker routing', () => {
  const env = {
    BETTER_AUTH_URL: 'https://cloud.example',
    BETTER_AUTH_SECRET: 'test-only-not-a-service-secret',
    GITHUB_CLIENT_ID: 'test-only-client',
    GITHUB_CLIENT_SECRET: 'test-only-not-a-service-secret',
    ALLOWED_EMAILS: 'alice@example.test',
  } as Env;
  const request = (path: string, method = 'GET') =>
    new Request(`https://cloud.example${path}`, { method });
  beforeEach(() => {
    login.session = null;
  });

  it.each(['/v2/projects', '/v2/resources', `/v2/blobs/${'a'.repeat(64)}`, '/v2/me'])(
    'requires a session before accessing %s',
    async (path) => {
      expect((await worker.fetch(request(path), env)).status).toBe(401);
      expect((await worker.fetch(request(path, 'POST'), env)).status).toBe(401);
    },
  );

  it('requires invited verified users for both protocol catalogs', async () => {
    login.session = {
      user: {
        id: 'alice',
        email: 'alice@example.test',
        emailVerified: false,
        name: 'Alice',
      },
    };
    expect((await worker.fetch(request('/v2/projects'), env)).status).toBe(403);
    login.session.user.emailVerified = true;
    login.session.user.email = 'other@example.test';
    expect((await worker.fetch(request('/v2/resources'), env)).status).toBe(403);
  });

  it('routes authenticated catalog requests using the account ID from the session', async () => {
    login.session = {
      user: {
        id: 'account-uuid',
        email: 'alice@example.test',
        emailVerified: true,
        name: 'Alice',
      },
    };
    const bind = vi.fn(() => ({ all: async () => ({ results: [] }) }));
    const prepare = vi.fn(() => ({ bind }));
    const configured = { ...env, DB: { prepare } as unknown as D1Database };
    for (const path of ['/v2/projects', '/v2/resources']) {
      const response = await worker.fetch(request(path), configured);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    expect(bind.mock.calls).toEqual([['account-uuid'], ['account-uuid']]);
    expect(prepare).toHaveBeenNthCalledWith(1, expect.stringContaining('cloud_v2_projects'));
    expect(prepare).toHaveBeenNthCalledWith(2, expect.stringContaining('cloud_v2_resources'));
    expect(await (await worker.fetch(request('/v2/me'), env)).json()).toMatchObject({
      id: 'account-uuid',
      email: 'alice@example.test',
    });
  });
});

import { safeStorage, shell } from 'electron';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetch } from 'undici';
import { createHash } from 'node:crypto';
import type { CloudAccount } from '../../shared/cloud';

export class CloudRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function cloudChunkHashes(bytes: Uint8Array): string[] {
  const hashes: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024)
    hashes.push(
      createHash('sha256')
        .update(bytes.subarray(offset, offset + 4 * 1024 * 1024))
        .digest('hex'),
    );
  return hashes;
}

export class CloudConnection {
  private token: string | null = null;
  private login?: { code: string; nextPoll: number; expires: number; interval: number };
  account: CloudAccount | null = null;
  readonly baseURL: string | null;
  readonly configurationError?: string;

  constructor(
    endpoint: string | undefined,
    private readonly credentialsPath: string,
  ) {
    if (!endpoint) {
      this.baseURL = null;
      return;
    }
    try {
      const url = new URL(endpoint);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('MOMOCAT_CLOUD_URL must be an HTTPS origin');
      this.baseURL = url.origin;
    } catch {
      this.baseURL = null;
      this.configurationError =
        'Cloud service address is invalid. Local projects remain available.';
    }
  }

  async initialize(): Promise<void> {
    if (!this.baseURL || !safeStorage.isEncryptionAvailable()) return;
    try {
      const saved = JSON.parse(await readFile(this.credentialsPath, 'utf8')) as {
        origin: string;
        token: string;
      };
      if (saved.origin === this.baseURL)
        this.token = safeStorage.decryptString(Buffer.from(saved.token, 'base64'));
      if (this.token) this.account = await this.json<CloudAccount>('/v1/me');
    } catch {
      this.token = null;
      this.account = null;
    }
  }

  async request(path: string, method = 'GET', body?: string | Uint8Array) {
    if (!this.baseURL) throw new Error('Cloud service is not configured');
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CloudRequestError(
        response.status,
        response.status === 409
          ? 'A newer cloud version exists. Your changes are saved on this device.'
          : response.status === 401
            ? 'Cloud login expired; sign in again'
            : response.status === 403
              ? 'This account cannot access the cloud service'
              : response.status === 413
                ? 'Experiment storage or size limit reached'
                : `Cloud request failed (${response.status})`,
      );
    }
    return response;
  }

  async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return (
      await this.request(path, method, body === undefined ? undefined : JSON.stringify(body))
    ).json() as Promise<T>;
  }

  async startLogin(): Promise<{ userCode: string }> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable');
    const data = await this.json<{
      device_code: string;
      user_code: string;
      verification_uri_complete: string;
      interval: number;
      expires_in: number;
    }>('/api/auth/device/code', 'POST', { client_id: 'momocat-desktop' });
    const verification = new URL(data.verification_uri_complete);
    if (verification.origin !== this.baseURL || verification.pathname !== '/device')
      throw new Error('Unexpected login address');
    const interval = Math.max(5, data.interval || 5) * 1000;
    this.login = {
      code: data.device_code,
      interval,
      nextPoll: Date.now() + interval,
      expires: Date.now() + Math.min(data.expires_in, 600) * 1000,
    };
    await shell.openExternal(verification.href);
    return { userCode: data.user_code };
  }

  async pollLogin(): Promise<boolean> {
    const login = this.login;
    if (!login || Date.now() > login.expires) throw new Error('Start cloud login again');
    if (Date.now() < login.nextPoll) return false;
    login.nextPoll = Date.now() + login.interval;
    if (!this.baseURL) throw new Error('Cloud service is not configured');
    const response = await fetch(`${this.baseURL}/api/auth/device/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'momocat-desktop',
        device_code: login.code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = (await response.json()) as { access_token?: string; error?: string };
    if (data.error === 'authorization_pending') return false;
    if (data.error === 'slow_down') {
      login.interval += 5000;
      return false;
    }
    if (!response.ok || !data.access_token) {
      this.login = undefined;
      throw new Error('Cloud login was denied or expired');
    }
    this.token = data.access_token;
    try {
      this.account = await this.json<CloudAccount>('/v1/me');
      await mkdir(dirname(this.credentialsPath), { recursive: true });
      await writeFile(
        `${this.credentialsPath}.tmp`,
        JSON.stringify({
          origin: this.baseURL,
          token: safeStorage.encryptString(this.token).toString('base64'),
        }),
        { mode: 0o600 },
      );
      await rename(`${this.credentialsPath}.tmp`, this.credentialsPath);
    } catch (error) {
      this.token = null;
      this.account = null;
      throw error;
    }
    this.login = undefined;
    return true;
  }

  async logout(): Promise<void> {
    if (this.token) await this.json('/api/auth/sign-out', 'POST', {});
    this.token = null;
    this.account = null;
    this.login = undefined;
    await rm(this.credentialsPath, { force: true });
  }

  async upload(bytes: Uint8Array): Promise<string[]> {
    const hashes: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
      const chunk = bytes.subarray(offset, offset + 4 * 1024 * 1024);
      const hash = createHash('sha256').update(chunk).digest('hex');
      await this.request(`/v1/blobs/${hash}`, 'PUT', chunk);
      hashes.push(hash);
    }
    return hashes;
  }

  async download(hashes: string[]): Promise<Buffer> {
    if (hashes.length > 128 || hashes.some((h) => !/^[a-f0-9]{64}$/.test(h)))
      throw new Error('Invalid cloud blob list');
    const chunks: Buffer[] = [];
    let total = 0;
    for (const hash of hashes) {
      const response = await this.request(`/v1/blobs/${hash}`);
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of response.body!) {
        size += part.length;
        if (size > 4 * 1024 * 1024) throw new Error('Cloud blob exceeds size limit');
        parts.push(Buffer.from(part));
      }
      const chunk = Buffer.concat(parts);
      total += chunk.length;
      if (total > 128 * 1024 * 1024 || createHash('sha256').update(chunk).digest('hex') !== hash)
        throw new Error('Cloud download failed integrity check');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

import { HttpError } from '@cat/cloud-contracts';
import { createAuth } from './auth';
import { handleBlob } from './blobs';
import { isAllowedEmail, type Env } from './env';
import { devicePage } from './pages';
import { handleProjects } from './projects';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET')
        return Response.json({ service: 'momocat-cloud', protocol: 1 });
      if (
        !env.BETTER_AUTH_URL ||
        !env.BETTER_AUTH_SECRET ||
        !env.GITHUB_CLIENT_ID ||
        !env.GITHUB_CLIENT_SECRET
      )
        throw new HttpError(503, 'Cloud login is not configured');
      if (url.origin !== new URL(env.BETTER_AUTH_URL).origin)
        throw new HttpError(400, 'Unexpected service origin');
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Origin not allowed');
      if ((url.pathname === '/' || url.pathname === '/device') && request.method === 'GET')
        return devicePage();
      const auth = createAuth(env);
      if (url.pathname.startsWith('/api/auth/')) return await auth.handler(request);
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) throw new HttpError(401, 'Please sign in');
      if (!session.user.emailVerified || !isAllowedEmail(env, session.user.email))
        throw new HttpError(403, 'This account is not invited');
      if (url.pathname === '/v1/me' && request.method === 'GET')
        return Response.json({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
      if (url.pathname.startsWith('/v1/blobs/'))
        return await handleBlob(
          request,
          env,
          session.user.id,
          url.pathname.slice('/v1/blobs/'.length),
        );
      if (url.pathname === '/v1/projects' || url.pathname.startsWith('/v1/projects/'))
        return await handleProjects(
          request,
          env,
          session.user.id,
          url.pathname.split('/').slice(3).filter(Boolean),
        );
      throw new HttpError(404, 'Route not found');
    } catch (error) {
      // Do not serialize exceptions, request bodies, tokens, or source text.
      return Response.json(
        { error: error instanceof HttpError ? error.message : 'Cloud service error' },
        {
          status: error instanceof HttpError ? error.status : 500,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }
  },
};

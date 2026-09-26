import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization } from 'better-auth/plugins';
import { isAllowedEmail, type Env } from './env';

export function createAuth(env: Env) {
  return betterAuth({
    telemetry: { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    appName: 'momoCAT Cloud',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    databaseHooks: {
      user: {
        create: { before: async (user) => isAllowedEmail(env, user.email) && user.emailVerified },
      },
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        verificationUri: `${env.BETTER_AUTH_URL}/device`,
        expiresIn: '10m',
        interval: '5s',
        validateClient: (clientId) => clientId === 'momocat-desktop',
      }),
    ],
  });
}

import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin, username } from 'better-auth/plugins';
import type { Bindings } from './index';

type AuthBindings = Pick<Bindings, 'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>;

export function createAuth(env: AuthBindings) {
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: ['http://localhost:4200', 'https://clessia.pages.dev'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [username(), adminPlugin()],
    user: {
      modelName: 'ba_user',
      additionalFields: {
        phone: {
          type: 'string',
          required: false,
          input: true,
        },
        orgId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    session: {
      modelName: 'ba_session',
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    account: {
      modelName: 'ba_account',
    },
    verification: {
      modelName: 'ba_verification',
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

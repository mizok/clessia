import { Pool, neonConfig } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin, username } from 'better-auth/plugins';
import type { Bindings } from './index';

type AuthBindings = Pick<Bindings, 'DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>;
type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type BetterAuthAdvancedDatabase = NonNullable<
  NonNullable<BetterAuthOptions['advanced']>['database']
>;

export function createAuth(env: AuthBindings) {
  const webSocketConstructor = WebSocket as unknown as NonNullable<
    typeof neonConfig.webSocketConstructor
  >;
  neonConfig.webSocketConstructor = webSocketConstructor;

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const advancedDatabase = { tablePrefix: 'ba_' } as BetterAuthAdvancedDatabase;

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
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    advanced: {
      database: advancedDatabase,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

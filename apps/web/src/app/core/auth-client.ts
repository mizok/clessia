import { createAuthClient } from 'better-auth/client';
import { adminClient, usernameClient } from 'better-auth/client/plugins';
import { environment } from '@env/environment';

export const authClient = createAuthClient({
  baseURL: environment.apiUrl,
  basePath: '/api/auth',
  plugins: [usernameClient(), adminClient()],
});

export type BetterAuthSession = typeof authClient.$Infer.Session;
export type BetterAuthUser = typeof authClient.$Infer.Session.user;

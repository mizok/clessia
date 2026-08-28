import { createAuthClient } from 'better-auth/client';
import { adminClient } from 'better-auth/client/plugins';
import { environment } from '@env/environment';

export const authClient = createAuthClient({
  baseURL: environment.apiUrl,
  basePath: '/api/auth',
  // username plugin 已在後端移除（它提供的 /sign-in/username 是密碼登入），
  // client 端留著只是死碼
  plugins: [adminClient()],
});

export type BetterAuthSession = typeof authClient.$Infer.Session;
export type BetterAuthUser = typeof authClient.$Infer.Session.user;

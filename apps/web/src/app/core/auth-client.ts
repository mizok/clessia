import { createAuthClient } from 'better-auth/client';
import { adminClient, usernameClient } from 'better-auth/client/plugins';
import { environment } from '@env/environment';

export const authClient = createAuthClient({
  // apiUrl 在正式站是空字串（同源）。better-auth client 需要一個絕對網址，
  // 所以退回目前的 origin —— 結果一樣，只是它自己組得出完整路徑。
  baseURL: environment.apiUrl || window.location.origin,
  basePath: '/api/auth',
  plugins: [usernameClient(), adminClient()],
});

export type BetterAuthSession = typeof authClient.$Infer.Session;
export type BetterAuthUser = typeof authClient.$Infer.Session.user;

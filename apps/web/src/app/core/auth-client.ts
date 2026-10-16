import { createAuthClient } from 'better-auth/client';
import { environment } from '@env/environment';

export const authClient = createAuthClient({
  // apiUrl 在正式站是空字串（同源）。better-auth client 需要一個絕對網址，
  // 所以退回目前的 origin —— 結果一樣，只是它自己組得出完整路徑。
  baseURL: environment.apiUrl || window.location.origin,
  basePath: '/api/auth',
  // 每次呼叫才取 globalThis.fetch（better-auth 預設在建立 client 時就抓死）。瀏覽器裡行為一樣；
  // 測試才替身得到 —— 不然 signOut 的 spec 只在 8787 剛好有人起著 API 時才綠（#1679 撞到）
  fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
  // 不掛任何 plugin。adminClient 曾經掛在這裡，但 web 端只用 getSession /
  // signIn.social / linkSocial / signOut —— 沒有一個走 admin API，
  // 新增使用者是後端 admin.createUser() 的事（憲法 c2）。
});

export type BetterAuthSession = typeof authClient.$Infer.Session;
export type BetterAuthUser = typeof authClient.$Infer.Session.user;

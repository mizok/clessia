import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { authClient } from './auth-client';
import { AuthHandoffService } from './auth-handoff.service';
import { CampusContextService } from './campus-context.service';
import { PushService } from './push.service';

export type UserRole = 'admin' | 'teacher' | 'parent' | 'kiosk';

/**
 * `auth.interceptor.ts` 也要讀這把鑰匙來組 `X-Active-Role` header —— 兩邊各寫一份
 * 字面值的話，改名時漏改一處是不會報錯的那種漂移。
 */
export const ACTIVE_ROLE_STORAGE_KEY = 'clessia:active-role';

/** index.html 先發的 `/api/me` 等這麼久還沒回就放棄、改走 HttpClient（不能卡住開站） */
export const EARLY_ME_TIMEOUT_MS = 10_000;

export interface Profile {
  id: string;
  display_name: string;
  branch_id: string | null;
}

interface MeResponse {
  userId: string;
  orgId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  roles: UserRole[];
  permissions: string[];
  /** 被指派的分校（#1607）；只拿來挑頂欄預設分校，不是權限。舊版 API 沒有這欄 */
  assignedCampusIds?: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly handoff = inject(AuthHandoffService);
  private readonly campusCtx = inject(CampusContextService);
  private readonly push = inject(PushService);

  private readonly _user = signal<{ id: string; email?: string | null; name?: string } | null>(
    null,
  );
  private readonly _profile = signal<Profile | null>(null);
  private readonly _roles = signal<UserRole[]>([]);
  private readonly _permissions = signal<string[]>([]);
  private readonly _activeRole = signal<UserRole | null>(null);
  private readonly _loading = signal(true);
  private readonly _connectionError = signal(false);

  readonly user = this._user.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly activeRole = this._activeRole.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user());

  /**
   * `/api/me` 失敗，但不是 401/403 —— 5xx、逾時、連線中斷。**不代表沒登入**，
   * 只是不知道。guard 靠這個訊號決定要不要把人彈去 /login：401/403 才彈，
   * 這個是 true 的話要留在原地顯示「連線異常，請重試」（見 auth.guard.ts）。
   */
  readonly connectionError = this._connectionError.asReadonly();

  /**
   * 首次載入完成的訊號。**guard 靠它取代輪詢** —— 在這之前 `isAuthenticated()` 還是
   * 初始值，誰讀誰得到錯的答案（已登入的人會被判定成沒登入、彈去 /login）。
   *
   * 一定會 resolve，連線失敗也一樣：卡住的話整個 app 就進不去了。
   */
  readonly ready: Promise<void>;

  private readonly shellMap: Record<UserRole, string> = {
    admin: '/admin',
    teacher: '/teacher',
    parent: '/parent',
    // 機台沒有 shell：登入後直接是打卡頁（#1127）
    kiosk: '/kiosk/checkin',
  };

  constructor() {
    this.ready = this.init();
  }

  /**
   * 開站只打**一趟** `/api/me`：200 就是已登入（身分、角色、權限一次拿齊），
   * 401 就是未登入。
   *
   * 原本是先 `getSession()` 再 `await loadProfile()` 兩趟**序列**往返，而 guard 在
   * 期間用 50ms 輪詢空轉、路由不放行 —— 每一趟都是 Worker → 東京 Postgres，
   * 已登入的人開站看到一兩秒白畫面。`/api/me` 本來就會驗 session，多問一次沒有換到
   * 任何資訊。
   */
  private async init(): Promise<void> {
    // 只用一次：之後的 refreshRoles() 要的是「現在」的身分，不是開站那一份
    const w = window as { __clessiaEarlyMe?: Promise<Response> };
    const early = w.__clessiaEarlyMe ?? null;
    delete w.__clessiaEarlyMe;
    try {
      if (!(await this.loadProfile(early))) {
        this._user.set(null);
      }
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * guard 專用：等首次載入完成之後才回報登入狀態。
   *
   * 存在的理由是「先等再讀」這個順序很容易被寫掉 —— 兩個 guard 各自 `await` 再各自
   * 讀 signal 的話，哪天有人少寫一行 await 也不會有人發現，症狀是偶發的登出彈跳。
   */
  async isAuthenticatedWhenReady(): Promise<boolean> {
    await this.ready;
    return this.isAuthenticated();
  }

  /**
   * 讀取 `/api/me`。**回傳「有沒有讀到」**，呼叫端要靠它區分兩件不同的事：
   * 讀不到（連線失敗、session 失效）vs 讀到了但這個帳號真的沒有角色。
   *
   * 原本這裡把 `catch` 吞掉、一律把 roles 設成空陣列，於是跨站 cookie 沒送出去
   * 造成的 401 被顯示成「此帳號尚未被指派角色」—— 排查方向一度指向 bootstrap
   * 沒寫 user_roles。訊息說錯地方比沒有訊息更糟。
   *
   * **500 不等於未登入。** 原本 catch 不分青紅皂白一律清空 profile/roles，
   * 於是後端偶發 5xx 會讓行政人員被彈去 /login，以為自己被登出。現在只有
   * 401/403 才當成「確定沒登入」清空狀態；其他失敗（5xx、逾時、斷線）只設
   * `connectionError`，保留現有 profile/roles —— `refreshRoles()` 是在已登入
   * 狀態下被叫的（見 account-settings-dialog），一次暫時性的 500 不該把
   * 正在編輯的人踢出畫面。
   */
  private async loadProfile(early: Promise<Response> | null = null): Promise<boolean> {
    try {
      const me =
        (early && (await this.takeEarlyMe(early))) ??
        (await firstValueFrom(
          this.http.get<MeResponse>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
        ));

      this._connectionError.set(false);
      this._user.set({ id: me.userId, email: me.email, name: me.displayName });
      this._profile.set({
        id: me.userId,
        display_name: me.displayName,
        branch_id: null,
      });
      this._roles.set(me.roles);
      this._permissions.set(me.permissions);
      this.campusCtx.setAssigned(me.assignedCampusIds ?? []);

      if (me.roles.length === 1) {
        this._activeRole.set(me.roles[0]);
      } else {
        const savedRole = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY) as UserRole | null;
        if (savedRole && me.roles.includes(savedRole)) {
          this._activeRole.set(savedRole);
        }
      }

      return true;
    } catch (err) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      const confirmedUnauthenticated = status === 401 || status === 403;

      this._connectionError.set(!confirmedUnauthenticated);

      if (confirmedUnauthenticated) {
        this._profile.set(null);
        this._roles.set([]);
        this._permissions.set([]);
        this.campusCtx.setAssigned([]);
      }

      return false;
    }
  }

  /**
   * 接手 index.html 先發的 `/api/me`（#1595 P3a）。回 null＝這份不能用，呼叫端退回
   * HttpClient 原流程：連線失敗、逾時、5xx、回的不是 JSON 都算。
   * **401/403 是伺服器的確定答案**，照原流程的語意丟出去（＝未登入），不再多問一趟。
   */
  private async takeEarlyMe(early: Promise<Response>): Promise<MeResponse | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        early,
        new Promise<never>((_, reject) => (timer = setTimeout(reject, EARLY_ME_TIMEOUT_MS))),
      ]);
      if (res.status === 401 || res.status === 403) {
        throw new HttpErrorResponse({ status: res.status, url: res.url });
      }
      if (!res.ok) return null;
      return (await res.json()) as MeResponse;
    } catch (err) {
      if (err instanceof HttpErrorResponse) throw err;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  setActiveRole(role: UserRole) {
    this._activeRole.set(role);
    localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role);
  }

  hasPermission(permission: string): boolean {
    return this.permissions().includes(permission) || this.permissions().includes('*');
  }

  /** 回傳有沒有讀到 —— 呼叫端要區分「讀不到」和「沒有角色」時會用到 */
  async refreshRoles(): Promise<boolean> {
    return this.loadProfile();
  }

  /**
   * 把使用者交給 LINE。成功的話瀏覽器會被導走，這個 Promise 不會 resolve 到有意義的東西。
   *
   * 回傳非 null 表示**還沒離開這一頁就失敗了** —— 最常見的原因是 API 沒設定
   * `LINE_CLIENT_ID` / `LINE_CLIENT_SECRET`，那時 provider 根本沒掛上。
   */
  async signInWithLine(): Promise<string | null> {
    // iOS 主畫面 PWA：授權完會落在 Safari（cookie 不共用），改走交接碼（#2027）
    const handoff = this.handoff.isStandalonePwa() ? await this.handoff.start() : null;
    const { error } = await authClient.signIn.social({
      provider: 'line',
      callbackURL: handoff ?? `${window.location.origin}/select-role`,
      // 失敗時導回登入頁並帶 ?error= —— 不設的話會落在 Better Auth 的預設頁面，
      // 使用者看到一個不屬於這個系統的畫面
      errorCallbackURL: `${window.location.origin}/login`,
    });

    if (error) {
      return 'LINE 登入失敗，請稍後再試或聯繫補習班';
    }

    return null;
  }

  /**
   * 把目前登入的帳號跟 LINE 綁在一起。之後這個人就能直接用 LINE 登入。
   *
   * 前提是**已經登入** —— 使用者是點一次性連結進來的。
   */
  async linkLine(): Promise<string | null> {
    const { error } = await authClient.linkSocial({
      provider: 'line',
      callbackURL: `${window.location.origin}/select-role`,
    });

    if (error) {
      return '綁定 LINE 失敗，請稍後再試';
    }

    return null;
  }

  navigateToRoleShell(role: UserRole) {
    this.setActiveRole(role);
    this.router.navigate([this.shellMap[role]]);
  }

  async signOut() {
    // **先刪這台裝置的推播訂閱，再登出**（#1663）：不刪的話，上一個人的繳費提醒會繼續跳到
    // 這台裝置上 —— 換手機給家人用、補習班櫃台的共用平板都會遇到。DELETE 要帶登入 cookie，
    // 所以一定排在 signOut 之前；它自己最多等 3 秒，失敗也不擋登出。
    await this.push.forgetThisDevice();
    await authClient.signOut({ fetchOptions: { credentials: 'include' } });
    this._user.set(null);
    this._profile.set(null);
    this._roles.set([]);
    this._permissions.set([]);
    this.campusCtx.setAssigned([]);
    this._activeRole.set(null);
    localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY);
    this.router.navigate(['/login']);
  }
}

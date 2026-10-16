import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ReferenceDataService } from './reference-data.service';

/** 最後一次的選擇（沒有 key＝全部分校） */
const STORAGE_KEY = 'clessia.campusContext';
/** 最後一次選的**單一**分校（#1607）：報表選了全部之後，日常頁靠它回到原本那間 */
const SINGLE_KEY = 'clessia.campusContext.single';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // 便利而已：存不了就只在這次瀏覽有效
  }
}

/**
 * 「這一頁要看哪一間分校」—— 頂欄分校下拉寫它、已接上的頁面讀它（#1138 H2，計畫席裁 Q1 A）。
 *
 * **這是偏好，不是權限**：分校範圍由後端 `getCampusScope` 決定（c1），選項清單來自
 * `ReferenceDataService.campuses()`（已是授權過的）。`null`＝全部分校。
 * 記在 localStorage 只是便利（讀寫都包 try/catch）。
 *
 * **「全部分校」只有報表頁有**（#1607，使用者 10-15 裁定）：日常頁（名冊、課表、帳單…）一次只看
 * 一間；儀表板、營收報表、人員管理宣告 `use({ allowAll: true })` 保留全部。日常頁遇到 `null`
 * 不改掉它（回報表還是全部），而是顯示 {@link fallback}。
 *
 * 頂欄**只在有頁面接上時**才出現下拉 —— 不然使用者會看到「頂欄選了 A、這頁還是 B」。
 */
@Injectable({ providedIn: 'root' })
export class CampusContextService {
  private readonly refData = inject(ReferenceDataService);
  private readonly selected = signal<string | null>(read(STORAGE_KEY));
  // 舊使用者只有 STORAGE_KEY：那就是他最後選的單一分校
  private readonly lastSingle = signal<string | null>(read(SINGLE_KEY) ?? read(STORAGE_KEY));
  private readonly dailyUsers = signal(0);
  private readonly allowAllUsers = signal(0);
  /**
   * 自己被指派的分校（`/api/me` 的 `assignedCampusIds`，由 AuthService 讀到後填進來）。
   * 反過來由這裡 inject AuthService 會讓每個接上的頁一建構就打 `/api/me`。
   */
  private readonly assigned = signal<readonly string[]>([]);

  /** 授權過的分校清單（頂欄下拉的選項） */
  readonly campuses = computed(() => this.refData.campuses());
  /** 現在這一頁有沒有接上（頂欄要不要出下拉） */
  readonly inUse = computed(() => this.dailyUsers() + this.allowAllUsers() > 0);
  /** 這一頁能不能選「全部分校」。換頁瞬間兩種頁並存時算日常頁（寧可少一項，不給日常頁看全部） */
  readonly allowAll = computed(() => this.allowAllUsers() > 0 && this.dailyUsers() === 0);

  /**
   * 清單還沒載到時先相信存著的值（不然一進頁先查全部、載到再查一次）；
   * 載到之後不在清單裡（換了帳號、分校被停用）就當作沒選。
   */
  private valid(id: string | null): string | null {
    const list = this.campuses();
    if (id === null || list.length === 0) return id;
    return list.some((c) => c.id === id) ? id : null;
  }

  /**
   * 日常頁沒選分校時看哪一間（#1607）：上次選過的單一分校 → 自己被指派的（依清單順序）→
   * 清單第一間。清單是空的就沒有預設（後端本來就什麼都不給）。**只算不寫**，使用者自己選了才記。
   */
  private readonly fallback = computed(() => {
    const last = this.valid(this.lastSingle());
    if (last) return last;
    const list = this.campuses();
    const assigned = this.assigned();
    return (list.find((c) => assigned.includes(c.id)) ?? list[0])?.id ?? null;
  });

  /** 目前這一頁的分校 id；`null` 只會出現在報表頁（全部分校），或日常頁還沒有任何分校可選時 */
  readonly id = computed(() => {
    const s = this.valid(this.selected());
    return this.allowAll() ? s : (s ?? this.fallback());
  });
  readonly name = computed(() => this.campuses().find((c) => c.id === this.id())?.name ?? null);

  setAssigned(ids: readonly string[]): void {
    this.assigned.set(ids);
  }

  select(id: string | null): void {
    this.selected.set(id);
    write(STORAGE_KEY, id);
    if (id) {
      this.lastSingle.set(id);
      write(SINGLE_KEY, id);
    }
  }

  /**
   * 接上的頁面在建構時呼叫（要在 injection context 裡）；頁面銷毀時自動放掉。
   * 報表頁傳 `{ allowAll: true }` 保留「全部分校」，其餘一律是日常頁。
   */
  use(opts: { allowAll?: boolean } = {}): void {
    this.refData.loadCampuses();
    const users = opts.allowAll ? this.allowAllUsers : this.dailyUsers;
    users.update((n) => n + 1);
    inject(DestroyRef).onDestroy(() => users.update((n) => n - 1));
  }
}

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ReferenceDataService } from './reference-data.service';

const STORAGE_KEY = 'clessia.campusContext';

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * 「這一頁要看哪一間分校」—— 頂欄分校下拉寫它、已接上的頁面讀它（#1138 H2，計畫席裁 Q1 A）。
 *
 * **這是偏好，不是權限**：分校範圍由後端 `getCampusScope` 決定（c1），選項清單來自
 * `ReferenceDataService.campuses()`（已是授權過的）。`null`＝全部分校。
 * 記在 localStorage 只是便利（讀寫都包 try/catch，讀不到就是全部分校）。
 *
 * 過渡期：頁面逐頁接（每頁一支 PR）。接上的頁在建構時呼叫 `use()`，頂欄**只在有人用的時候**
 * 才出現下拉 —— 不然使用者會看到「頂欄選了 A、這頁還是 B」。
 */
@Injectable({ providedIn: 'root' })
export class CampusContextService {
  private readonly refData = inject(ReferenceDataService);
  private readonly selected = signal<string | null>(read());
  private readonly users = signal(0);

  /** 授權過的分校清單（頂欄下拉的選項） */
  readonly campuses = computed(() => this.refData.campuses());

  /**
   * 目前選的分校 id。清單還沒載到時先相信存著的值（不然一進頁先查全部、載到再查一次）；
   * 載到之後不在清單裡（換了帳號、分校被停用）就當成全部分校。
   */
  readonly id = computed(() => {
    const s = this.selected();
    const list = this.campuses();
    if (s === null || list.length === 0) return s;
    return list.some((c) => c.id === s) ? s : null;
  });
  readonly name = computed(() => this.campuses().find((c) => c.id === this.id())?.name ?? null);
  /** 現在這一頁有沒有接上（頂欄要不要出下拉） */
  readonly inUse = computed(() => this.users() > 0);

  select(id: string | null): void {
    this.selected.set(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 便利而已：存不了就只在這次瀏覽有效
    }
  }

  /** 接上的頁面在建構時呼叫（要在 injection context 裡）；頁面銷毀時自動放掉 */
  use(): void {
    this.refData.loadCampuses();
    this.users.update((n) => n + 1);
    inject(DestroyRef).onDestroy(() => this.users.update((n) => n - 1));
  }
}

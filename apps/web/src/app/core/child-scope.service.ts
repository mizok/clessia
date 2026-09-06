import { Injectable, computed, inject, signal } from '@angular/core';
import { ChildrenService, type Child } from './children.service';

/**
 * 家長端「目前在看哪個孩子」的狀態 —— 授權範圍(`studentScope`)在後端已經限定好，
 * 這裡只決定畫面上顯示哪一個。沒有 APP_INITIALIZER（同族教訓見
 * `OrgSettingsService`），呼叫端要自己叫一次 `load()`。
 */
@Injectable({ providedIn: 'root' })
export class ChildScopeService {
  private readonly childrenService = inject(ChildrenService);

  private readonly _children = signal<Child[]>([]);
  private readonly _activeChildId = signal<string | null>(null);
  private readonly _loading = signal(false);
  /**
   * 載入狀態。**`failed` 必須跟「這個帳號沒有孩子」分開** ——
   * 兩者都會讓 `children()` 是空陣列，而切換器對空陣列的反應是整個不渲染，
   * 家長端三頁的 effect 也因為 `activeChildId` 是 null 而不打 API。
   * 結果是一個**完全空白、沒有任何訊息**的家長端，跟「還沒綁孩子」一模一樣（#484 M4）。
   *
   * 形狀跟 `OrgSettingsService.status` 刻意一致 —— 同一種問題不要有兩種寫法。
   */
  private readonly _status = signal<'unloaded' | 'ready' | 'failed'>('unloaded');
  private loaded = false;

  readonly children = this._children.asReadonly();
  readonly status = this._status.asReadonly();
  readonly activeChildId = this._activeChildId.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly activeChild = computed(
    () => this._children().find((c) => c.id === this._activeChildId()) ?? null,
  );

  /** 只有一個以上的孩子才有東西可切——跟角色徽章「單一角色不給互動」同一條規則 */
  readonly canSwitch = computed(() => this._children().length > 1);

  load(): void {
    if (this.loaded || this._loading()) return;
    this.loaded = true;
    this._loading.set(true);
    this.childrenService.list().subscribe({
      next: (res) => {
        this._children.set(res.data);
        if (this._activeChildId() === null && res.data.length > 0) {
          this._activeChildId.set(res.data[0].id);
        }
        this._status.set('ready');
        this._loading.set(false);
      },
      error: () => {
        this._status.set('failed');
        // 失敗不算「已載入過」——允許呼叫端之後重試，不然一次網路抖動就永久卡死
        this.loaded = false;
        this._loading.set(false);
      },
    });
  }

  setActiveChild(id: string): void {
    this._activeChildId.set(id);
  }
}

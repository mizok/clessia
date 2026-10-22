import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, debounceTime, switchMap } from 'rxjs';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ReloadVeilComponent } from '@shared/components/reload-veil/reload-veil.component';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { SchoolsService } from '@core/schools.service';
import type { School, SchoolLevel } from '@core/schools.service';
import { SchoolFormDialogComponent, type SchoolFormResult } from './school-form-dialog.component';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/** 分章順序：國小 → 國中 → 高中 → 未分類（計畫席 10-22 裁 C：未分類放最後） */
const CHAPTERS: ReadonlyArray<{ level: SchoolLevel | null; label: string }> = [
  { level: 'elementary', label: '國小' },
  { level: 'junior', label: '國中' },
  { level: 'senior', label: '高中' },
  { level: null, label: '未分類' },
];

@Component({
  selector: 'app-schools-page',
  standalone: true,
  imports: [
    SkeletonComponent,
    PageActionsComponent,
    FormsModule,
    ReloadVeilComponent,
    ConfirmDialogModule,
    EmptyStateComponent,
    LoadFailedComponent,
  ],
  providers: [ConfirmationService, DialogService],
  templateUrl: './schools.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolsPage implements OnInit {
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  /** 重抓的資料平滑換上；新增／編輯造成的重抓帶 rows，那一列淡入或淡出（#1641 5b） */
  private readonly viewTransition = injectViewTransition();
  /** 這一輪重抓是增刪改造成的 —— 回應套上時列表帶名字（搜尋不帶） */
  private reloadRows = false;

  /** 搜尋輸入 —— 節流 + 去重之後才進 `load()`（#661） */
  private readonly searchInput = new Subject<string>();
  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去。
   *
   * `debounce` 只解一半：打字慢的人（每次間隔超過 300ms）仍然會送出多支請求，
   * 而它們回來的順序不保證 —— **先發的後到就會蓋掉畫面**，而畫面上的輸入框
   * 顯示的是最新的字。**而且它不會自己追上**：沒有任何後續事件會重查。
   *
   * 讓每一個取數都走同一條 `switchMap`，新的一發就取消舊的那一支。
   */
  private readonly loadRequests = new Subject<void>();

  protected readonly schools = signal<School[]>([]);
  protected readonly loading = signal(true);
  /** 取數失敗。**不能沿用 `schools().length === 0`** —— 「尚無學校」在失敗時是謊話（#812） */
  protected readonly loadFailed = signal(false);
  protected readonly search = signal('');
  /** 輸入框顯示的字（即時）；`search` 是節流後真的拿去查的那個 */
  protected readonly searchText = signal('');
  /** A6 依學制分章；空章不畫 */
  protected readonly chapters = computed(() =>
    CHAPTERS.map((c) => ({
      ...c,
      schools: this.schools().filter((s) => (s.level ?? null) === c.level),
    })).filter((c) => c.schools.length > 0),
  );
  protected readonly inactiveCount = computed(
    () => this.schools().filter((s) => !s.isActive).length,
  );
  protected readonly primaryAction: PageAction = { label: '新增學校', icon: 'pi pi-plus' };

  ngOnInit(): void {
    this.setupLoadPipeline();

    // 搜尋：節流 + 去重，然後才觸發取數。
    // 去重比對的是 `search` signal 而不是 `distinctUntilChanged` ——
    // 後者的記憶是這個狀態的第二份複本，任何不經過這條管線的重設都會讓它
    // 跟畫面脫鉤，然後靜靜吞掉下一次同樣的字。
    this.searchInput
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (value === this.search()) return;
        this.search.set(value);
        this.load();
      });

    this.load();
  }

  /**
   * 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#661）。
   * `quiet`：刪除成功後的背景重抓 —— 畫面已經是「刪掉了」，不再變淡（#1641 5b 第 1 點）。
   * `rows`：新增／編輯造成的重抓，回應套上時那一列淡入或淡出（搜尋不帶）。
   */
  protected load({ quiet = false, rows = false }: { quiet?: boolean; rows?: boolean } = {}): void {
    this.reloadRows = rows;
    if (!quiet) this.loading.set(true);
    this.loadFailed.set(false);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.schoolsService
            .list({ search: this.search() || undefined })
            // **`catchError` 必須在內層，不能掛在外層 `pipe` 上。**
            // 所有取數收進單一管線之後，內層的 error 會終止外層 ——
            // **一次網路錯誤就讓這一頁再也載入不了任何東西**，而畫面上只有一則
            // toast，看起來像「這次失敗了」不是「這一頁壞了」。
            // 由 spec 的「一次請求失敗之後…」那條釘住（#689）。
            .pipe(
              // **不再發 toast** —— 主體現在有常駐的失敗狀態；會消失的 toast
              // 加留著的錯誤畫面是兩個互相矛盾的訊號（#788 的裁定）
              catchError(() => {
                this.loadFailed.set(true);
                this.loading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.viewTransition(
          () => {
            this.schools.set(response.data);
            this.loading.set(false);
          },
          { rows: this.reloadRows },
        );
        this.reloadRows = false;
      });
  }

  protected onSearch(value: string): void {
    this.searchText.set(value);
    this.searchInput.next(value);
  }

  protected clearSearch(): void {
    this.searchText.set('');
    this.search.set('');
    this.load();
  }

  protected openCreate(): void {
    this.openSchoolDialog(null);
  }

  protected openEdit(school: School): void {
    this.openSchoolDialog(school);
  }

  private onSaved(result: SchoolFormResult): void {
    const name = result.school?.name?.trim();
    const action = result.mode === 'create' ? '已新增學校' : '已更新學校';
    this.messageService.add({
      severity: 'success',
      summary: result.mode === 'create' ? '新增成功' : '更新成功',
      detail: name ? `${action}「${name}」` : action,
    });
    this.load({ rows: true });
  }

  protected onDelete(school: School): void {
    if (school.studentCount > 0) {
      this.explainBlocked(school);
      return;
    }

    // **`acceptLabel` / `rejectLabel` 不能省**（#752）：PrimeNG 原生的
    // `ConfirmationService` 沒給就會吃元件庫的英文預設值（`Yes` / `No`），
    // 而這一頁的訊息是中文 —— 全站唯一一個中文訊息配英文按鈕的確認框。
    // 這裡的四個欄位跟另外 9 個 `confirmationService.confirm()` 呼叫點同形。
    this.confirmationService.confirm({
      message: `確定刪除「${school.name}」？`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      // 等伺服器確認才淡出（悲觀刪除）—— 全站刪除是樂觀的（#1641 5b 第 1 點），這一頁是例外
      // （計畫席 10-16 同意盤點時的判準）：前端只擋得住有學生的學校，學校考試、考程也是
      // FK RESTRICT（409 CONSTRAINT），樂觀版會「先淡出又回來」。
      accept: () => {
        this.schoolsService
          .delete(school.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.viewTransition(
                () => this.schools.update((list) => list.filter((s) => s.id !== school.id)),
                { rows: true },
              );
              this.messageService.add({ severity: 'success', summary: '已刪除' });
              this.load({ quiet: true, rows: true });
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: '刪除失敗',
                detail: error?.error?.error ?? '',
              });
            },
          });
      },
    });
  }

  /**
   * 有學生的學校按刪除：**跳說明＋給停用的出口**（A6 settings#schools），不是只出一則 toast。
   * 行政按刪除真正要的通常是「以後別再出現在選單裡」—— 停用就做得到，已寫著它的學生不受影響。
   */
  private explainBlocked(school: School): void {
    const label = school.shortName || school.name;
    this.confirmationService.confirm({
      header: `「${label}」不能刪除`,
      message: `還有 ${school.studentCount} 位學生的資料寫著這所學校。可以改成停用：新填的學生資料選不到它，已經寫著它的不受影響。`,
      icon: 'pi pi-info-circle',
      acceptLabel: school.isActive ? '改成停用' : '它已經停用了',
      rejectLabel: '取消',
      rejectVisible: school.isActive,
      accept: () => {
        if (!school.isActive) return;
        this.schoolsService
          .update(school.id, { isActive: false })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: `已停用「${label}」` });
              this.load({ rows: true });
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: '停用失敗',
                detail: error?.error?.error ?? '',
              });
            },
          });
      },
    });
  }

  private openSchoolDialog(editing: School | null): void {
    const ref = this.dialogService.open(SchoolFormDialogComponent, {
      width: '480px',
      breakpoints: { '640px': '96%' },
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: { editing },
    });
    if (!ref) return;
    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: SchoolFormResult | undefined) => {
        if (!result) return;
        this.onSaved(result);
      });
  }
}

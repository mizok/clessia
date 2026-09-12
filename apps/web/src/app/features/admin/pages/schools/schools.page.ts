import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, debounceTime, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SchoolsService } from '@core/schools.service';
import type { School } from '@core/schools.service';
import { SchoolFormDialogComponent, type SchoolFormResult } from './school-form-dialog.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

@Component({
  selector: 'app-schools-page',
  standalone: true,
  imports: [
    StatusDotComponent,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    ToastModule,
    ConfirmDialogModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './schools.page.html',
  styleUrl: './schools.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolsPage implements OnInit {
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

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
  protected readonly search = signal('');

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

  /** 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#661） */
  private load(): void {
    this.loading.set(true);
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
              catchError((error) => {
                this.loading.set(false);
                this.messageService.add({
                  severity: 'error',
                  summary: '載入失敗',
                  detail: error?.error?.error ?? '',
                });
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.schools.set(response.data);
        this.loading.set(false);
      });
  }

  protected onSearch(value: string): void {
    this.searchInput.next(value);
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
    this.load();
  }

  protected onDelete(school: School): void {
    if (school.studentCount > 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法刪除',
        detail: `此學校仍有 ${school.studentCount} 位學生`,
      });
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
      accept: () => {
        this.schoolsService
          .delete(school.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: '已刪除' });
              this.load();
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

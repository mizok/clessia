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
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
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
    PageBreadcrumbComponent,
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

  protected readonly breadcrumbs: BreadcrumbItem[] = [{ label: '系統設定' }, { label: '學校管理' }];

  protected readonly schools = signal<School[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.schoolsService
      .list({ search: this.search() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.schools.set(response.data);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: error?.error?.error ?? '',
          });
        },
      });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
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

    this.confirmationService.confirm({
      message: `確定刪除「${school.name}」？`,
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
      width: 'min(480px, 96vw)',
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

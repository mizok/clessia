import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { DialogTitleDirective } from '@shared/directives/dialog-title.directive';
import {
  ParentsService,
  ParentDetail,
  CreateParentInput,
  UpdateParentInput,
} from '@core/parents.service';
import { StudentsService, type Student } from '@core/students.service';

@Component({
  selector: 'app-parent-form-dialog',
  standalone: true,
  imports: [FormsModule, AutoCompleteModule, DialogTitleDirective],
  templateUrl: './parent-form-dialog.component.html',
})
export class ParentFormDialogComponent {
  private readonly parentsService = inject(ParentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /**
   * #1844：Email／手機是本機構教職員的帳號（409 `STAFF_ACCOUNT_EXISTS`）。確認後帶 `userId` 再送一次，
   * 後端會重新判斷。改了 Email／手機就作廢 —— 那是另一個人了。
   */
  protected readonly linkCandidate = signal<{ userId: string; staffName: string } | null>(null);

  protected readonly parent = signal<ParentDetail | null>(this.config.data?.parent ?? null);
  protected readonly isEditMode = computed(() => this.parent() !== null);

  /**
   * 新增模式的預填（#1245：從公開申請建立家長）。**不是 `parent`** —— 有 `parent` 就是編輯模式。
   */
  private readonly prefill: { name?: string; email?: string | null; phone?: string | null } =
    this.config.data?.prefill ?? {};

  protected readonly formData = signal({
    name: this.config.data?.parent?.name ?? this.prefill.name ?? '',
    email: this.config.data?.parent?.email ?? this.prefill.email ?? '',
    phone: this.config.data?.parent?.phone ?? this.prefill.phone ?? '',
    notes: this.config.data?.parent?.notes ?? '',
  });

  /** A6 `.fdlg__why`：「還沒填：姓名」／「Email 和手機至少填一個」；都填了是 null */
  protected readonly missingHint = computed(() => {
    const f = this.formData();
    if (!f.name.trim()) return '還沒填：姓名';
    if (!f.email.trim() && !f.phone.trim()) return 'Email 和手機至少填一個';
    return null;
  });

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    // 稿：桌機聚焦第一個欄位（姓名）、手機不聚焦（不要一開就彈鍵盤）
    afterNextRender(() => {
      if (globalThis.matchMedia?.('(min-width: 861px)').matches) {
        this.nameInput().nativeElement.focus();
      }
    });
  }

  protected selectedStudents: Student[] = [];
  protected readonly studentSuggestions = signal<Student[]>([]);

  protected searchStudents(event: AutoCompleteCompleteEvent): void {
    const picked = new Set(this.selectedStudents.map((s) => s.id));
    this.studentsService
      .list({ search: event.query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data.filter((s) => !picked.has(s.id))),
        error: () => this.studentSuggestions.set([]),
      });
  }

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
    this.errorMessage.set(null);
    if (field === 'email' || field === 'phone') this.linkCandidate.set(null);
  }

  /** 確認框的「設為家長」：同一份表單再送一次，帶上要設的那個帳號 */
  protected confirmLink(): void {
    const candidate = this.linkCandidate();
    if (candidate) this.save(candidate.userId);
  }

  protected save(linkExistingUserId?: string): void {
    const f = this.formData();

    // 送出鈕不鎖死（A6 `.fdlg`）：沒填完就停在這裡，動作列左邊那行寫還差什麼
    if (this.missingHint()) return;

    this.errorMessage.set(null);
    this.loading.set(true);

    if (this.isEditMode()) {
      const input: UpdateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        notes: f.notes.trim() || null,
      };

      this.parentsService.update(this.parent()!.id, input).subscribe({
        next: (res) => this.ref.close({ type: 'updated', data: res.data }),
        error: (err) => this.handleError(err),
      });
    } else {
      const input: CreateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        notes: f.notes.trim() || undefined,
        studentIds: this.selectedStudents.length
          ? this.selectedStudents.map((s) => s.id)
          : undefined,
        ...(linkExistingUserId ? { linkExistingUserId } : {}),
      };

      this.parentsService.create(input).subscribe({
        next: (res) =>
          this.ref.close({
            type: 'created',
            data: res.data,
            loginUrl: res.loginUrl,
            // 設為家長：對方已經有帳號，不發登入連結（loginUrl 是 null）
            linkedStaff: !!linkExistingUserId,
          }),
        error: (err) => this.handleError(err),
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  private handleError(err: {
    error?: { error?: string; code?: string; details?: Record<string, unknown> };
  }): void {
    const { code, details } = err.error ?? {};
    this.loading.set(false);

    if (code === 'STAFF_ACCOUNT_EXISTS' && typeof details?.['userId'] === 'string') {
      this.errorMessage.set(null);
      this.linkCandidate.set({
        userId: details['userId'],
        staffName: String(details['staffName'] ?? ''),
      });
      return;
    }
    this.linkCandidate.set(null);

    let message = '請稍後再試';
    if (code === 'DUPLICATE_EMAIL') message = '此 Email 已被使用';
    else if (code === 'DUPLICATE_PHONE') message = '此手機號碼已被使用';
    else if (code === 'CREATE_PARENT_FAILED') message = '建立帳號失敗，請稍後再試';
    // 其餘（PARENT_ALREADY_EXISTS、STAFF_NOT_ACTIVE、SELF_LINK_FORBIDDEN…）後端的訊息就是給人看的
    else if (err.error?.error) message = err.error.error;

    this.errorMessage.set(message);
  }
}

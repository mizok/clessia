import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { SchoolsService, type School } from '@core/schools.service';
import { ParentsService, type Parent } from '@core/parents.service';
import {
  StudentsService,
  type CreateStudentInput,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  type GradeLevel,
  type Student,
  type StudentGender,
  type UpdateStudentInput,
} from '@core/students.service';

@Component({
  selector: 'app-student-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TextareaModule,
    DatePickerModule,
    AutoCompleteModule,
    TooltipModule,
    ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './student-form-dialog.component.html',
  styleUrl: './student-form-dialog.component.scss',
})
export class StudentFormDialogComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly parentsService = inject(ParentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly student = signal<Student | null>(this.config.data?.student ?? null);
  protected readonly isCreateMode = computed(() => this.student() === null);
  protected readonly schools = signal<School[]>([]);
  protected readonly creatingSchool = signal(false);
  protected readonly newSchoolName = signal('');

  /**
   * 從家長頁的 ⋮ 選單開啟時，`config.data.parentId` 已經預填了要關聯的家長；
   * 從學生頁的「新增學生」開啟時沒有這個值 —— 那條路徑才需要picker，
   * 讓兩個入口的能力對齊（#364 後續：同名不同能力）。
   */
  private readonly presetParentId: string | null = this.config.data?.parentId ?? null;
  protected readonly showParentPicker = computed(() => this.isCreateMode() && !this.presetParentId);
  protected readonly selectedParent = signal<Parent | string | null>(null);
  protected readonly parentSuggestions = signal<Parent[]>([]);

  protected readonly formData = signal({
    name: this.student()?.name ?? '',
    grade: (this.student()?.grade ?? '') as GradeLevel | '',
    schoolId: this.student()?.school?.id ?? null,
    birthday: this.student()?.birthday
      ? new Date(this.student()!.birthday!)
      : (null as Date | null),
    gender: this.student()?.gender ?? (null as StudentGender | null),
    phone: this.student()?.phone ?? '',
    email: this.student()?.email ?? '',
    address: this.student()?.address ?? '',
    emergencyContactName: this.student()?.emergencyContactName ?? '',
    emergencyContactPhone: this.student()?.emergencyContactPhone ?? '',
    notes: this.student()?.notes ?? '',
  });

  protected readonly gradeOptions = GRADE_LEVELS.map((g) => ({
    label: GRADE_LEVEL_LABELS[g],
    value: g,
  }));

  protected readonly genderOptions: { label: string; value: StudentGender }[] = [
    { label: '男', value: 'male' },
    { label: '女', value: 'female' },
    { label: '不提供', value: 'prefer_not_to_say' },
  ];

  /**
   * 驗證失敗的持久標記（#716，方向由 #664 定）。
   *
   * **toast 是輔助，這個才是主體訊號** —— 錯誤跟著欄位顯示，
   * 直到那個欄位被改動為止。
   */
  protected readonly errors = signal<Record<string, string>>({});

  /**
   * 回傳第一個錯誤的欄位 key，全部通過回 `null`。
   *
   * **一次收集全部**而不是遇到第一個就 return —— 使用者一次看到所有要補的東西，
   * 不用「修一個、再按一次、再發現下一個」。
   */
  private validate(): string | null {
    const f = this.formData();
    const found: Record<string, string> = {};

    if (!f.name.trim()) found['name'] = '請填寫姓名';
    if (!f.grade) found['grade'] = '請選擇年級';
    if (!f.schoolId) found['schoolId'] = '請選擇就讀學校';

    this.errors.set(found);
    return Object.keys(found)[0] ?? null;
  }

  constructor() {
    this.schoolsService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = [...res.data];
          const currentSchool = this.student()?.school;
          if (currentSchool && !list.some((school) => school.id === currentSchool.id)) {
            list.push({
              id: currentSchool.id,
              name: currentSchool.name,
              shortName: currentSchool.shortName,
              isActive: false,
              studentCount: 0,
              createdAt: '',
              updatedAt: '',
            });
          }
          this.schools.set(list);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學校清單',
          });
        },
      });
  }

  /**
   * **這顆按鈕刻意只在 `loading()` 時 disable。**（#716，照 #664 的判準）
   *
   * 原本是 `[disabled]="!isFormValid()"` —— 必填沒填時**按下去真的什麼都不會發生**：
   * 沒有 toast、沒有欄位標記、沒有任何解釋。
   *
   * 判準：**`disabled` 是把「為什麼不行」藏起來，而那正是使用者最需要知道的。
   * 按不下去的按鈕不會解釋原因，按得下去的才會。**
   * 例外是「按下去會產生後果」的按鈕 —— 驗證沒過就不會送出，
   * 誤觸的代價只是看到一則錯誤訊息，而那正是我們要他看到的東西。
   * （`loading()` 期間仍然 disable，那時候按下去**會**產生後果：重複建立。）
   */
  protected save(): void {
    const firstError = this.validate();
    if (firstError) {
      // toast 留著當**輔助** —— 有人的視線可能正好在右上，但它不再是唯一訊號
      this.messageService.add({
        severity: 'warn',
        summary: '請檢查標示的欄位',
        detail: this.errors()[firstError],
      });
      return;
    }

    const f = this.formData();
    this.loading.set(true);

    const commonFields = {
      name: f.name.trim(),
      grade: f.grade as GradeLevel,
      schoolId: f.schoolId,
      birthday: f.birthday ? this.formatDate(f.birthday) : null,
      gender: f.gender,
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      address: f.address.trim() || null,
      emergencyContactName: f.emergencyContactName.trim() || null,
      emergencyContactPhone: f.emergencyContactPhone.trim() || null,
      notes: f.notes.trim() || null,
    };

    if (this.isCreateMode()) {
      const picked = this.selectedParent();
      const input: CreateStudentInput = {
        ...commonFields,
        parentId: this.presetParentId ?? (typeof picked === 'string' ? undefined : picked?.id),
      };
      this.studentsService.create(input).subscribe({
        next: (res) => this.ref.close(res.data),
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '建立失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    } else {
      const input: UpdateStudentInput = commonFields;
      this.studentsService.update(this.student()!.id, input).subscribe({
        next: (res) => this.ref.close(res.data),
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected onParentChange(value: Parent | string | null): void {
    this.selectedParent.set(value);
  }

  protected searchParents(event: AutoCompleteCompleteEvent): void {
    this.parentsService
      .list({ search: event.query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.parentSuggestions.set(res.data),
        error: () => this.parentSuggestions.set([]),
      });
  }

  protected formatParentMeta(parent: Parent): string {
    return parent.phone ?? parent.email ?? '';
  }

  protected quickCreateSchool(): void {
    const name = this.newSchoolName().trim();
    if (!name) return;

    this.schoolsService
      .create({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schools.update((list) => [...list, res.data]);
          this.updateForm('schoolId', res.data.id);
          this.creatingSchool.set(false);
          this.newSchoolName.set('');
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err?.error?.error ?? '',
          });
        },
      });
  }

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
    this.clearError(field as string);
  }

  /** 改動一個欄位就清掉它的錯誤 —— 錯誤是「上次送出時的狀態」，不是永久標籤 */
  private clearError(field: string): void {
    if (!this.errors()[field]) return;
    this.errors.update((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

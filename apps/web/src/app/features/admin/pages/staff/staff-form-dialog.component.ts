import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  StaffService,
  Staff,
  StaffRole,
  PERMISSIONS,
  Permission,
  CreateStaffInput,
  UpdateStaffInput,
} from '@core/staff.service';
import { Campus } from '@core/campuses.service';
import { Subject } from '@core/subjects.service';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { AuthService } from '@core/auth.service';
import { roleLock } from './permission-rules';

/**
 * 中文標籤與說明。**只有這張表是手寫的，值的集合不是** ——
 * 它是 `Record<Permission, …>`，所以**詞彙表多一個值而這裡沒跟上，編譯就會失敗**。
 * 這是 #772 的修法核心：把「別漏掉」從人的責任換成編譯器的責任。
 */
const PERMISSION_META: Record<Permission, { label: string; description: string }> = {
  basic_operations: { label: '日常行政', description: '查詢與處理報名、出勤、請假' },
  manage_courses: { label: '課程管理', description: '課程與排課管理' },
  manage_students: { label: '學生管理', description: '學生與家長資料管理' },
  manage_finance: { label: '財務管理', description: '財務與收費管理' },
  manage_staff: { label: '帳號管理', description: '系統帳號與權限管理' },
  manage_roles: { label: '角色管理', description: '指派或變更帳號角色與權限' },
  manage_org_settings: {
    label: '機構設定',
    // 實際擋得住的是這三個欄位（`routes/org-settings.ts` 的 UpdateOrgSettingsSchema
    // 扣掉需要 manage_finance 的那三個）。**機構名稱不在裡面 —— 那支端點不給改。**
    description: '出勤模式、點名權責與補登天數等機構層級設定',
  },
  view_reports: { label: '報表查看', description: '查看營收與統計報表' },
  all_campuses: {
    label: '跨分校',
    description: '不受指派分校限制，看得到全機構的資料',
  },
  send_announcements: { label: '發送通知', description: '發布公告給老師與家長' },
};

export const PERMISSION_OPTIONS: { value: Permission; label: string; description: string }[] =
  PERMISSIONS.map((value) => ({ value, ...PERMISSION_META[value] }));
const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'admin', label: '管理員' },
  { value: 'teacher', label: '老師' },
];

@Component({
  selector: 'app-staff-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    DialogFrameComponent,
    FormsModule,
    ButtonModule,
    MultiSelectModule,
    CheckboxModule,
  ],
  templateUrl: './staff-form-dialog.component.html',
})
export class StaffFormDialogComponent {
  private readonly staffService = inject(StaffService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly auth = inject(AuthService);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly roleOptions = ROLE_OPTIONS;

  protected readonly loading = signal(false);
  protected readonly staff = signal<Staff | null>(this.config.data?.staff ?? null);
  protected readonly campuses = signal<Campus[]>(this.config.data?.campuses ?? []);
  protected readonly subjects = signal<Subject[]>(this.config.data?.subjects ?? []);

  protected readonly formData = signal({
    displayName: this.staff()?.displayName ?? '',
    nickname: this.staff()?.nickname ?? '',
    email: this.staff()?.email ?? '',
    phone: this.staff()?.phone ?? '',
    // 原生 <input type="date">（稿 `type: 'date'`）：值就是 YYYY-MM-DD，跟 API 同格式
    birthday: this.staff()?.birthday ?? '',
    notes: this.staff()?.notes ?? '',
    subjectIds: this.staff()?.subjectIds ?? [],
    campusIds: this.staff()?.campusIds ?? [],
    // #666：**不預選任何角色。** 原本預設 `['teacher']`，於是每一個純行政都被
    // 靜默地記成老師 —— 建立者只是沒去取消一個預先勾好的框，而那個人會出現在
    // 排課、代課、鐘點費的候選名單裡。省一次點擊，換一筆要人工才發現的髒資料。
    roles: this.staff()?.roles ?? ([] as StaffRole[]),
  });

  protected readonly isEditing = computed(() => this.staff() !== null);
  protected readonly isAdminRole = computed(() => this.formData().roles.includes('admin'));
  protected readonly isTeacherRole = computed(() => this.formData().roles.includes('teacher'));
  /**
   * 角色勾選框為什麼不能改（#1314 ST3／ST8，判準同 API `checkSelfAssignment`、`manage_roles`）。
   * 只管編輯 —— 新增本來就要 `manage_roles`（API 擋），沒有的人存檔會收到那句錯誤。
   */
  protected roleBlock(role: StaffRole): string | null {
    const staff = this.staff();
    if (!staff) return null;
    return roleLock(
      { isSelf: this.auth.user()?.id === staff.userId, has: (p) => this.auth.hasPermission(p) },
      role as 'admin' | 'teacher',
    );
  }

  /** 角色旁那一行：停用的原因（同一個原因只寫一次） */
  protected readonly roleNote = computed(() => {
    const notes = ROLE_OPTIONS.map((r) => this.roleBlock(r.value)).filter(Boolean);
    return [...new Set(notes)].join('；') || null;
  });

  protected readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ label: c.name, value: c.id })),
  );

  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id })),
  );

  /**
   * 驗證失敗的欄位 → 訊息。**畫面上的主體訊號是這個，不是 toast。**
   *
   * #663：可用性測試席按下「建立」之後**什麼都沒發生**。實際上 toast 有出現，
   * 但它在畫面**對角**、而且壽命短於「把視線從右下的按鈕移到右上」所需的時間
   * （量測：等 1 秒看得到、等 4 秒什麼都沒有）。而欄位**從頭到尾沒有紅框**。
   *
   * **兩個本該互為備援的管道同時失效，結果不是「提示不夠明顯」，
   * 是「驗證失敗這件事在畫面上不存在」。**
   *
   * 所以錯誤存在**持久的**狀態裡，跟著欄位顯示，直到那個欄位被改動為止。
   * toast 留著當輔助（有人可能正看著右上），**但它不再是唯一的訊號**。
   */
  protected readonly errors = signal<Record<string, string>>({});

  /** A6 `.fdlg__why`：動作列左邊「還沒填：姓名、Email」；都填了是 null（規則同 validate） */
  protected readonly missingHint = computed(() => {
    const f = this.formData();
    const missing = [
      !f.displayName.trim() && '姓名',
      !this.isEditing() && !f.email.trim() && 'Email',
      !this.isEditing() && !f.phone.trim() && '電話',
      f.roles.length === 0 && '角色',
      f.campusIds.length === 0 && '服務分校',
      f.roles.includes('teacher') && f.subjectIds.length === 0 && '教學科目',
    ].filter(Boolean);
    return missing.length ? `還沒填：${missing.join('、')}` : null;
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

  /**
   * 回傳第一個錯誤的欄位 key，全部通過回 `null`。
   *
   * **一次收集全部**而不是遇到第一個就 return —— 使用者一次看到所有要補的東西，
   * 不用「修一個、再按一次、再發現下一個」。
   */
  private validate(): string | null {
    const form = this.formData();
    const found: Record<string, string> = {};

    if (!form.displayName.trim()) found['displayName'] = '請填寫姓名';
    if (!this.isEditing() && !form.email.trim()) found['email'] = '請填寫 Email';
    // A6 staff.html：電話必填（`req: true`）—— 只在新增時。既有人員多半沒填（建立流程原本選填，
    // seed 99／99 位都沒有），編輯時也擋的話，改個名字就存不了；編輯時改成欄位下的提示
    if (!this.isEditing() && !form.phone.trim()) found['phone'] = '請填寫電話';
    if (form.campusIds.length === 0) found['campusIds'] = '請選擇服務分校';
    if (form.roles.length === 0) found['roles'] = '請選擇角色';
    // **這個條件本來就跟角色綁**（#663 的 ② 查證後不是「沒有綁」）——
    // 不教書的人根本看不到這個欄位，因為整個區塊在 `@if (isTeacherRole())` 裡。
    if (form.roles.includes('teacher') && form.subjectIds.length === 0) {
      found['subjectIds'] = '請選擇教學科目';
    }

    this.errors.set(found);
    return Object.keys(found)[0] ?? null;
  }

  /**
   * **這顆按鈕刻意不 disable。**（#663 實測時發現的第二個成因）
   *
   * 原本是 `[disabled]="!displayName.trim() || roles.length === 0"` ——
   * 於是姓名空白時**按下去真的什麼都不會發生**：`save()` 根本沒被呼叫，
   * 沒有 toast、沒有欄位標記、沒有任何解釋。
   * **那才是「按建立沒反應」最徹底的版本**，而它比 toast 太短更難查，
   * 因為連一閃而過的訊號都沒有。
   *
   * charter 的判準：**`disabled` 是把「為什麼不行」藏起來，而那正是使用者
   * 最需要知道的。按不下去的按鈕不會解釋原因，按得下去的才會。**
   * 例外是「按下去會產生後果」的按鈕 —— 這一顆不是：驗證沒過就不會送出，
   * 誤觸的代價是看到一則錯誤訊息，而那正是我們要他看到的東西。
   */
  protected save(): void {
    // 鈕是 aria-disabled（不鎖死），送出中按 Enter 也會走到這裡 —— 這裡擋
    if (this.loading()) return;
    const form = this.formData();
    const firstError = this.validate();
    // 錯誤留在欄位上（紅框＋欄位下的字），動作列左邊也寫還差什麼（A6 `.fdlg__why`）——
    // 兩個都在按鈕旁邊的視線範圍內，不再靠右上的 toast
    if (firstError) return;

    this.loading.set(true);

    const commonInput = {
      displayName: form.displayName.trim(),
      // 空字串＝清掉；API 端同一條 NicknameSchema 也會 trim
      nickname: form.nickname.trim() || null,
      phone: form.phone.trim() || null,
      birthday: form.birthday || null,
      notes: form.notes.trim() || null,
      subjectIds: form.subjectIds,
      campusIds: form.campusIds,
    };

    if (this.isEditing()) {
      // 權限改在「權限設定」（ST2），這裡不帶 → API 不動；角色沒變也不帶，
      // 沒有 manage_roles 的人才改得了別人的姓名、分校（API 只要動到角色就要 manage_roles）
      const before = this.staff()!.roles;
      const rolesChanged =
        before.length !== form.roles.length || form.roles.some((r) => !before.includes(r));
      const input: UpdateStaffInput = {
        ...commonInput,
        ...(rolesChanged && { roles: form.roles }),
      };

      this.staffService.update(this.staff()!.id, input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.displayName}」已更新`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    } else {
      // 新增管理員預設只給「日常行政」，要多的建完再開權限設定（A6 `staff.html:232`，計畫席 11-05 裁 (a)）
      const input: CreateStaffInput = {
        ...commonInput,
        roles: form.roles,
        permissions: form.roles.includes('admin') ? ['basic_operations'] : [],
        email: form.email.trim(),
      };

      this.staffService.create(input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.displayName}」已建立`,
          });
          // loginUrl 一定要往上傳 —— 這個系統沒有密碼，那條連結是對方唯一的進門方式
          this.ref.close({ data: res.data, loginUrl: res.loginUrl });
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
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

  /** 改動一個欄位就清掉它的錯誤 —— 錯誤是「上次送出時的狀態」，不是永久標籤 */
  private clearError(field: string): void {
    if (!this.errors()[field]) return;
    this.errors.update((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
  }

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
    this.clearError(field as string);
  }

  protected toggleRole(role: StaffRole, checked: boolean): void {
    this.clearError('roles');
    // 取消老師角色時，「請選擇教學科目」就不再適用 —— 留著會變成一個
    // **指向一個已經不存在的欄位**的錯誤訊息
    this.clearError('subjectIds');
    this.formData.update((f) => {
      let newRoles: StaffRole[];
      if (checked) {
        newRoles = f.roles.includes(role) ? f.roles : [...f.roles, role];
      } else {
        newRoles = f.roles.filter((r) => r !== role);
      }
      return { ...f, roles: newRoles };
    });
  }

  protected openSubjectManager(): void {
    const dialogRef = this.dialogService.open(SubjectManagerComponent, {
      width: '400px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer ?? 'body',
    });

    if (dialogRef) {
      dialogRef.onClose.subscribe((updatedSubjects: Subject[]) => {
        if (updatedSubjects) {
          this.subjects.set(updatedSubjects);
        }
      });
    }
  }
}

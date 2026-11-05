import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { feeTemplateOptions } from '../class-detail/enrollment-billing.util';
import {
  ClassesService,
  Class,
  CreateClassInput,
  UpdateClassInput,
  CreateScheduleInput,
  CheckConflictScheduleInput,
  ScheduleConflict,
} from '@core/classes.service';
import { Course } from '@core/courses.service';
import { CampusesService } from '@core/campuses.service';
import { Staff } from '@core/staff.service';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { DialogTitleDirective } from '@shared/directives/dialog-title.directive';
import { ConflictWarningDialogComponent } from './conflict-warning-dialog/conflict-warning-dialog.component';
import {
  ScheduleSplitDialogComponent,
  type ScheduleSplitDialogData,
} from './schedule-split-dialog/schedule-split-dialog.component';
import type { Schedule, SplitScheduleResult } from '@core/classes.service';
import { taipeiDateString } from '@core/system-clock.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '@core/students.service';
import { effectiveRangeLabel, rangesOverlap } from '@shared/utils/schedule-effective.util';

export interface ScheduleFormEntry {
  /** 前端用的穩定 key（#1641 項 5）：`@for` 用它 track（新增的時段還沒有 id）。不送 API */
  key: number;
  id?: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  /** 既有時段的生效起始日（#1100 #22）；新增的還沒有＝null（API 預設班級開課日） */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** 指定的教室（#1796）；null = 不指定 */
  classroomId: string | null;
}

@Component({
  selector: 'app-class-form-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectFieldComponent, DialogTitleDirective],
  // **自己 provide 一份 `DialogService`。** 這支元件本身是被 DynamicDialog 開起來的，
  // 而它又要再開一層（排課衝突警告）。父層 `courses.page` 雖然有 provide，
  // 但「dialog 內的元件解不解析得到父元件層的 provider」取決於 PrimeNG 的
  // injector 串接方式 —— 那是我沒辦法在單元測試裡驗到的東西，
  // 而解析失敗的症狀是**警告完全開不出來**，比原本的 bug 更糟。
  //
  // 自己 provide 一份就把這個不確定性拿掉了，成本是一個無狀態的 service 實例。
  providers: [DialogService],
  templateUrl: './class-form-dialog.component.html',
})
export class ClassFormDialogComponent {
  private readonly classesService = inject(ClassesService);
  /** 列表增刪的頁內 VT（#1641 項 5）：新列淡入、刪掉的淡出、其餘補位 */
  private readonly viewTransition = injectViewTransition();
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly config = inject(DynamicDialogConfig);
  private readonly auth = inject(AuthService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly campusesService = inject(CampusesService);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly course = signal<Course | null>(this.config.data?.course ?? null);
  protected readonly staff = signal<Staff[]>(this.config.data?.staff ?? []);
  protected readonly campuses = signal<any[]>(this.config.data?.campuses ?? []);

  protected readonly isEditing = computed(() => this.cls() !== null);

  /**
   * 目錄參考價（#1175）：家長目錄顯示的價錢，實際報名價仍以報名時選的範本為準。
   * 門檻跟價目表同一個（`manage_finance`）—— 沒有就不畫、送出時**不帶這個 key**，
   * 帶了 API 會 403 整張表單。
   */
  protected readonly canSetFee = this.auth.hasPermission('manage_finance');
  private readonly originalFeeTemplateId = this.cls()?.defaultFeeTemplateId ?? null;
  protected readonly defaultFeeTemplateId = signal<string | null>(this.originalFeeTemplateId);
  private readonly feeTemplates = signal<FeeTemplate[]>([]);
  protected readonly feeOptions = computed(() => feeTemplateOptions(this.feeTemplates()));
  /** 家長端「推薦加選」（#1118）：目錄排最前、卡片畫推薦標籤 */
  protected readonly isRecommended = signal(this.cls()?.isRecommended ?? false);
  /**
   * 適用年級（#2089）：班級自己存的（`ownGradeLevels`）是空的＝沿用課程，表單只寫「沿用課程：…」、
   * 送出 []；按「自訂」才展開勾選。不能拿合併值 `gradeLevels` 當初值 —— 那樣編輯一次就把沿用的班
   * 存成課程年級的副本，之後改課程年級這個班不會跟著動。
   * 舊 API 沒帶 `ownGradeLevels` 時當作自己存的（照舊送回，不改資料）
   */
  private readonly ownGrades: string[] =
    this.cls()?.ownGradeLevels ?? this.cls()?.gradeLevels ?? [];
  protected readonly customGrades = signal(this.ownGrades.length > 0);
  protected readonly gradeLevels = signal<string[]>(this.ownGrades);
  /** 沿用時顯示的課程年級（中文，照年級順序）；課程沒設＝不限 */
  protected readonly courseGradesText = computed(() => {
    const course = this.course()?.gradeLevels ?? [];
    const labels = GRADE_LEVELS.filter((g) => course.includes(g)).map((g) => GRADE_LEVEL_LABELS[g]);
    return labels.length ? labels.join('、') : '不限年級';
  });
  /** 按「自訂」：從課程的年級開始勾 */
  protected startCustomGrades(): void {
    this.gradeLevels.set(
      GRADE_LEVELS.filter((g) => (this.course()?.gradeLevels ?? []).includes(g)),
    );
    this.customGrades.set(true);
  }
  protected useCourseGrades(): void {
    this.customGrades.set(false);
    this.gradeLevels.set([]);
  }
  protected readonly gradeOptions = GRADE_LEVELS.map((g) => ({
    value: g as string,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected toggleGrade(grade: string, checked: boolean): void {
    this.gradeLevels.update((list) =>
      GRADE_LEVELS.filter((g) => (g === grade ? checked : list.includes(g))),
    );
  }
  /** #1665 Q5′：新班預設開放，跟 DB 預設一致 */
  protected readonly isPublicEnrollment = signal(this.cls()?.isPublicEnrollment ?? true);

  constructor() {
    // 稿：桌機聚焦班名、手機不聚焦（不要一開就彈鍵盤）
    afterNextRender(() => {
      if (globalThis.matchMedia?.('(min-width: 861px)').matches)
        this.nameInput().nativeElement.focus();
    });
    // 用課程的分校就是班級的分校：班級建立時取自課程，之後班級、課程都沒有改分校的 API
    // （UpdateClassSchema／UpdateCourseSchema 都沒有 campus 欄位），兩邊不會分歧
    const campusId = this.course()?.campusId;
    if (campusId) {
      this.campusesService
        .listClassrooms(campusId)
        // 讀不到就只剩「不指定」＋既有時段的那幾間 —— 表單照樣能存
        .subscribe({ next: (res) => this.campusRooms.set(res.data), error: () => undefined });
    }
    // #1100 #22：列表傳進來的班級只帶「今天有效」的時段（列表的摘要規則），還沒生效的未來段不在裡面。
    // 表單要列出未來段、重疊檢查也要看得到它，所以編輯時重讀詳情（全部時段）。讀取期間鎖住表單，
    // 免得使用者先改的時段列被蓋掉；讀失敗就沿用列表那份（未來段不會被刪：存檔只刪表單看得到的）
    const editingId = this.cls()?.id;
    if (editingId) {
      this.loading.set(true);
      this.classesService.get(editingId).subscribe({
        next: (res) => {
          this.cls.set(res.data);
          this.scheduleEntries.set(this.toEntries(this.liveSchedules()));
          this.loading.set(false);
          this.startRetime();
        },
        error: () => {
          this.loading.set(false);
          this.startRetime();
        },
      });
    }
    // 只列使用中的範本 —— 停用的 API 會擋（停用的價目表不再對外報價）
    if (this.canSetFee) {
      this.feeTemplatesService
        .list({ isActive: true })
        .subscribe({ next: (res) => this.feeTemplates.set(res.data) });
    }
  }
  protected readonly dialogTitle = computed(() => (this.isEditing() ? '編輯班級' : '新增班級'));

  protected readonly formData = signal({
    name: this.cls()?.name ?? '',
    maxStudents: this.cls()?.maxStudents ?? 20,
    nextClassId: this.cls()?.nextClassId ?? null,
    isActive: this.cls()?.isActive ?? true,
  });
  /**
   * 日期是**選填的，而且要保持選填**。
   *
   * 留空不是「還沒填」，是「不限期」—— API 靠 `end_date IS NULL` 判斷這個班還在
   * （`routes/classes.ts` 的班級列表過濾），頁面靠它判斷是不是歷史班
   * （`courses.page.ts` 的 `isHistorical`）。改成必填會消滅這個狀態。
   *
   * 代價是留空的班每次產生課堂都要另外指定範圍 —— 那句話寫在欄位下面，
   * 讓「不限」是選的不是預設踩到的。
   */
  // 原生 date 欄位（A6 `.acset__in`）：值是 `yyyy-MM-dd`，空字串＝不限
  protected readonly startDate = signal<string>(this.cls()?.startDate ?? '');
  protected readonly endDate = signal<string>(this.cls()?.endDate ?? '');
  private readonly today = taipeiDateString(Date.now());
  /** 原開始日期在過去：允許保留但不能選更早；否則限今天（字串比較，`yyyy-MM-dd` 可直接比） */
  protected readonly startDateMin = computed(() => {
    const original = this.cls()?.startDate;
    return this.isEditing() && original && original < this.today ? original : this.today;
  });
  /** 編輯：max(今天, 開始日)；新增：只限不早於開始日 */
  protected readonly endDateMin = computed(() => {
    const start = this.startDate();
    if (this.isEditing()) return start > this.today ? start : this.today;
    return start;
  });
  /**
   * 表單只管「今天有效＋還沒生效」的時段（#1100 #22）。已經結束的舊段是歷史，不列、
   * **也不能算進 `handleScheduleUpdates` 的「表單裡沒有＝刪掉」**，不然存一次就把它刪了
   */
  private liveSchedules(): Schedule[] {
    return (this.cls()?.schedules ?? []).filter(
      (s) => s.effectiveTo === null || s.effectiveTo >= this.today,
    );
  }
  private toEntries(schedules: Schedule[]): ScheduleFormEntry[] {
    return schedules.map((s) => ({
      key: this.nextScheduleKey++,
      id: s.id,
      weekday: s.weekday,
      startTime: s.startTime.substring(0, 5),
      endTime: s.endTime.substring(0, 5),
      teacherId: s.teacherId,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      classroomId: s.classroomId ?? null,
    }));
  }
  private nextScheduleKey = 0;
  // A6：新增班級一開就有一筆時段（週一 19:00–20:30、從今天起）
  protected readonly scheduleEntries = signal<ScheduleFormEntry[]>(
    this.cls()
      ? this.toEntries(this.liveSchedules())
      : [
          {
            key: this.nextScheduleKey++,
            weekday: 1,
            startTime: '19:00',
            endTime: '20:30',
            teacherId: null,
            effectiveFrom: this.today,
            effectiveTo: null,
            classroomId: null,
          },
        ],
  );

  /** 時段列的「11/1 起」「至 10/31」 */
  protected rangeLabel(entry: ScheduleFormEntry): string {
    return entry.id && entry.effectiveFrom
      ? effectiveRangeLabel(entry.effectiveFrom, entry.effectiveTo, this.today)
      : '';
  }

  /**
   * 教室下拉（#1796，A6 courses.html 時段「教室 · 不指定」）：只列這個班分校的教室。
   * 既有時段指的教室先放進來 —— 清單還沒讀到、或讀失敗時，已選的那間照樣顯示得出名字
   */
  private readonly campusRooms = signal<Array<{ id: string; name: string }>>([]);
  protected readonly classroomOptions = computed(() => {
    const byId = new Map<string, string>();
    for (const s of this.cls()?.schedules ?? []) {
      if (s.classroomId) byId.set(s.classroomId, s.classroomName ?? '');
    }
    for (const r of this.campusRooms()) byId.set(r.id, r.name);
    return [
      { label: '不指定', value: null as string | null },
      ...[...byId].map(([value, label]) => ({ label, value: value as string | null })),
    ];
  });

  /** A6 `.fdlg__sub`：「{分校} · {課程}」 */
  protected readonly subtitle = computed(() => {
    const c = this.course();
    if (!c) return '';
    const campusName = this.campuses().find((cp) => cp.id === c.campusId)?.name ?? '未知分校';
    return `${campusName} · ${c.name}`;
  });

  protected readonly weekdayOptions = [
    { label: '週一', value: 1 },
    { label: '週二', value: 2 },
    { label: '週三', value: 3 },
    { label: '週四', value: 4 },
    { label: '週五', value: 5 },
    { label: '週六', value: 6 },
    { label: '週日', value: 7 },
  ];

  protected readonly filteredStaffOptions = computed(() => {
    const c = this.course();
    if (!c) return [];

    return this.staff()
      .filter((s) => s.campusIds.includes(c.campusId) && s.subjectIds.includes(c.subjectId))
      .map((s) => ({ label: s.displayName, value: s.id }));
  });

  /**
   * A6 classDialog 的 check（courses.html）：每次輸入都重算，第一個問題寫在動作列左邊（`.fdlg__why`），
   * 送出鈕只標 aria-disabled、不鎖死。`bad` 是要框紅的時段（A6 `.slot.is-bad`）
   */
  private readonly issue = computed((): { msg: string; bad: number[] } | null => {
    const form = this.formData();
    if (!form.name.trim()) return { msg: '還沒填：開課班名稱', bad: [] };
    if (!(form.maxStudents > 0)) return { msg: '人數上限要大於 0', bad: [] };
    const entries = this.scheduleEntries();
    const bad = entries.findIndex(
      (e) => !e.weekday || !e.startTime || !e.endTime || e.endTime <= e.startTime,
    );
    if (bad >= 0) {
      return { msg: `第 ${bad + 1} 筆時段的結束要晚於開始`, bad: [bad] };
    }
    // 日期下限（#2110／#2115 二讀）：原本只有 `[min]` 提示、手打或貼上的值擋不住。沒改的原值不擋（歷史班照樣能編輯）
    const start = this.startDate();
    if (start && start !== (this.cls()?.startDate ?? '') && start < this.startDateMin()) {
      return { msg: `開始日期不能早於 ${this.startDateMin()}`, bad: [] };
    }
    const end = this.endDate();
    if (end && end !== (this.cls()?.endDate ?? '') && end < this.endDateMin()) {
      return {
        msg:
          start && end < start
            ? '結束日期不能早於開始日期'
            : `結束日期不能早於 ${this.endDateMin()}`,
        bad: [],
      };
    }
    const early = entries.findIndex(
      (e) => !e.id && start && e.effectiveFrom && e.effectiveFrom < start,
    );
    if (early >= 0) {
      return { msg: `第 ${early + 1} 筆時段的生效起始日不能早於班級開始日期`, bad: [early] };
    }
    const range = entries.findIndex(
      (e) => e.effectiveFrom && e.effectiveTo && e.effectiveTo < e.effectiveFrom,
    );
    if (range >= 0) {
      return { msg: `第 ${range + 1} 筆時段的生效結束日不能早於起始日`, bad: [range] };
    }
    const overlap = this.findLocalScheduleOverlap(entries);
    if (overlap) {
      return {
        msg: `時段重疊：第 ${overlap.firstEntryNo} 筆與第 ${overlap.secondEntryNo} 筆在${this.getWeekdayLabel(overlap.weekday)}重疊`,
        bad: [overlap.firstEntryNo - 1, overlap.secondEntryNo - 1],
      };
    }
    return null;
  });
  protected readonly formValidationMessage = computed(() => this.issue()?.msg ?? null);
  protected isBadSlot(index: number): boolean {
    return this.issue()?.bad.includes(index) ?? false;
  }
  /** 刪到只剩一筆時再按：A6 寫「至少要有一個時段」 */
  private readonly deleteBlocked = signal(false);
  /**
   * 時段老師是**選填**（計畫席 11-02，R5）：D4 以來時段本來就可以沒有老師，必選會讓還沒有該科老師的
   * 分校建不了班。不擋送出，只在動作列提示（A6 是「還沒選老師」擋送出）
   */
  protected readonly noTeacherHint = computed(() => {
    const nos = this.scheduleEntries()
      .map((e, i) => (e.teacherId ? 0 : i + 1))
      .filter(Boolean);
    return nos.length ? `第 ${nos.join('、')} 筆時段還沒排老師，可以之後再排` : null;
  });
  protected readonly whyText = computed(() =>
    this.deleteBlocked()
      ? '至少要有一個時段'
      : (this.formValidationMessage() ?? this.noTeacherHint()),
  );

  /** A6 `.fdlg__opt` radio */
  protected readonly statusOptions = [
    { label: '啟用', value: true },
    { label: '停用', value: false },
  ] as const;

  /**
   * 下一階班級（A6「沒有（不設升班路徑）」＋其他還在開的班）：同分校、不含自己。
   * `classes` 是課程頁那份「不分頁、不含歷史班」的清單
   */
  protected readonly nextClassOptions = computed(() => {
    const campusId = this.course()?.campusId;
    const selfId = this.cls()?.id;
    const list = ((this.config.data?.classes ?? []) as Class[]).filter(
      (c) => c.campusId === campusId && c.id !== selfId,
    );
    return [
      { label: '沒有（不設升班路徑）', value: null as string | null },
      ...list.map((c) => ({
        label: c.courseName ? `${c.courseName} · ${c.name}` : c.name,
        value: c.id as string | null,
      })),
    ];
  });

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  /** A6：新的一筆沿用上一筆的星期與老師，時間空著、生效日從今天起 */
  protected addScheduleEntry(): void {
    this.deleteBlocked.set(false);
    const last = this.scheduleEntries().at(-1);
    this.viewTransition(
      () =>
        this.scheduleEntries.update((list) => [
          ...list,
          {
            key: this.nextScheduleKey++,
            weekday: last?.weekday ?? 1,
            startTime: '',
            endTime: '',
            teacherId: last?.teacherId ?? null,
            effectiveFrom: this.today,
            effectiveTo: null,
            classroomId: null,
          },
        ]),
      { rows: true },
    );
  }

  /** 班級開始日往後調：還沒存的時段若從更早開始，跟著帶到開始日（API 的預設也是班級開課日） */
  protected onStartDateChange(value: string): void {
    this.startDate.set(value);
    if (!value) return;
    this.scheduleEntries.update((list) =>
      list.map((e) =>
        !e.id && e.effectiveFrom && e.effectiveFrom < value ? { ...e, effectiveFrom: value } : e,
      ),
    );
  }

  protected removeScheduleEntry(index: number): void {
    if (this.scheduleEntries().length < 2) {
      this.deleteBlocked.set(true);
      return;
    }
    this.viewTransition(
      () => this.scheduleEntries.update((list) => list.filter((_, i) => i !== index)),
      { rows: true },
    );
  }

  protected updateScheduleEntry(index: number, field: keyof ScheduleFormEntry, value: any): void {
    this.deleteBlocked.set(false);
    // 原生 date 清空是 ''；生效日的「不限／預設」是 null（rangesOverlap、API 都認 null）
    if (value === '' && (field === 'effectiveFrom' || field === 'effectiveTo')) value = null;
    this.scheduleEntries.update((list) =>
      list.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }

  /** 既有時段的老師是唯讀，只顯示名字 */
  protected teacherNameOf(entry: ScheduleFormEntry): string {
    return this.cls()?.schedules?.find((s) => s.id === entry.id)?.teacherName ?? '還沒排老師';
  }

  protected save(): void {
    if (this.issue() || this.loading()) return;

    // Conflict check for NEW schedules (only when teacherId is set)
    const toCheck: CheckConflictScheduleInput[] = this.scheduleEntries()
      .filter((e) => !e.id && !!e.teacherId && !!e.weekday)
      .map((e) => ({
        weekday: e.weekday!,
        startTime: e.startTime,
        endTime: e.endTime,
        teacherId: e.teacherId!,
        effectiveFrom: e.effectiveFrom,
        effectiveTo: e.effectiveTo,
      }));

    if (toCheck.length === 0) {
      // No teacher assigned — skip conflict check, go directly to save
      this.doSave();
      return;
    }

    this.loading.set(true);
    this.classesService.checkScheduleConflicts(toCheck, this.cls()?.id).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.conflicts.length > 0) {
          this.openConflictWarning(res.conflicts);
        } else {
          this.doSave();
        }
      },
      error: () => {
        this.loading.set(false);
        this.doSave();
      },
    });
  }

  /**
   * 排課衝突警告。**這裡用 DynamicDialog 而不是模板裡的 `@if`** ——
   * 原本那段掛的 7 個 class 全庫沒有任何 CSS 定義，所以它不是遮罩，
   * 是掉在表單下方、被對話框高度推出視野的一塊。使用者可能沒看到就按了儲存。
   * 理由詳見 `conflict-warning-dialog.component.ts` 的註解。
   */
  private openConflictWarning(conflicts: ScheduleConflict[]): void {
    const ref = this.dialogService.open(ConflictWarningDialogComponent, {
      width: 'var(--dlg-w-md)',
      modal: true,
      showHeader: false,
      // 跟 courses.page 開這支對話框時同一個容器 —— 疊在既有對話框之上
      appendTo: 'body',
      data: { conflicts },
    });

    ref?.onClose.subscribe((proceed: boolean | undefined) => {
      // undefined = 按遮罩或 Esc 關掉。**等同「返回修改」，不能當成同意** ——
      // 把「沒有回答」讀成「答應了」正是這個警告要防的事。
      if (proceed === true) this.doSave();
    });
  }

  /** 沒權限、或編輯時沒改 → 不帶（原本掛的範本可能已停用，照送會被 API 擋） */
  private feeTemplatePatch(): { defaultFeeTemplateId?: string | null } {
    const value = this.defaultFeeTemplateId();
    return this.canSetFee && value !== this.originalFeeTemplateId
      ? { defaultFeeTemplateId: value }
      : {};
  }

  private doSave(): void {
    this.loading.set(true);
    const form = this.formData();

    if (this.isEditing()) {
      const updateInput: UpdateClassInput = {
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        nextClassId: form.nextClassId,
        gradeLevels: this.customGrades() ? this.gradeLevels() : [],
        startDate: this.startDate() || null,
        endDate: this.endDate() || null,
        isActive: form.isActive,
        isRecommended: this.isRecommended(),
        isPublicEnrollment: this.isPublicEnrollment(),
        ...this.feeTemplatePatch(),
      };
      this.classesService.update(this.cls()!.id, updateInput).subscribe({
        next: () => {
          this.handleScheduleUpdates(this.cls()!.id);
        },
        error: (err) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    } else {
      const input: CreateClassInput = {
        courseId: this.course()!.id,
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        nextClassId: form.nextClassId,
        gradeLevels: this.customGrades() ? this.gradeLevels() : [],
        startDate: this.startDate() || null,
        endDate: this.endDate() || null,
        isActive: form.isActive,
        isRecommended: this.isRecommended(),
        isPublicEnrollment: this.isPublicEnrollment(),
        ...this.feeTemplatePatch(),
      };
      this.classesService.create(input).subscribe({
        next: (res) => {
          this.handleScheduleUpdates(res.data.id);
        },
        error: (err) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    }
  }

  private handleScheduleUpdates(classId: string): void {
    const existingSchedules = this.liveSchedules();
    const updatedEntries = this.scheduleEntries();

    const existingById = new Map(existingSchedules.map((s) => [s.id, s]));
    const keptIds = new Set(updatedEntries.filter((e) => e.id).map((e) => e.id!));
    const toDelete = existingSchedules.map((s) => s.id).filter((id) => !keptIds.has(id));
    const toAdd = updatedEntries.filter((e) => !e.id);
    const toUpdate = updatedEntries.filter((e) => {
      if (!e.id) return false;
      const orig = existingById.get(e.id);
      if (!orig) return false;
      return (
        e.weekday !== orig.weekday ||
        e.startTime !== orig.startTime.substring(0, 5) ||
        e.endTime !== orig.endTime.substring(0, 5) ||
        e.teacherId !== orig.teacherId ||
        (e.effectiveTo || null) !== orig.effectiveTo ||
        e.classroomId !== (orig.classroomId ?? null)
      );
    });

    const deleteOps = toDelete.map((sid) =>
      this.classesService.deleteSchedule(classId, sid).toPromise(),
    );
    const updateOps = toUpdate.map((e) =>
      this.classesService
        .updateSchedule(classId, e.id!, {
          weekday: e.weekday!,
          startTime: e.startTime,
          endTime: e.endTime,
          teacherId: e.teacherId,
          effectiveTo: e.effectiveTo || null,
          classroomId: e.classroomId,
        })
        .toPromise(),
    );

    Promise.all([...deleteOps, ...updateOps])
      .then(() => {
        if (toAdd.length === 0) {
          this.ref.close({ classId });
        } else {
          this.addSchedulesSequentially(classId, toAdd, 0, () => {
            this.ref.close({ classId });
          });
        }
      })
      .catch((err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '儲存失敗',
          detail: err?.error?.error || '更新時段失敗，請稍後再試',
        });
      });
  }

  private addSchedulesSequentially(
    classId: string,
    entries: ScheduleFormEntry[],
    index: number,
    onComplete: () => void,
  ): void {
    if (index >= entries.length) {
      onComplete();
      return;
    }
    const entry = entries[index];
    const input: CreateScheduleInput = {
      weekday: entry.weekday!,
      startTime: entry.startTime,
      endTime: entry.endTime,
      teacherId: entry.teacherId,
      ...(entry.effectiveFrom ? { effectiveFrom: entry.effectiveFrom } : {}),
      effectiveTo: entry.effectiveTo || null,
      classroomId: entry.classroomId,
    };
    this.classesService.addSchedule(classId, input).subscribe({
      next: () => this.addSchedulesSequentially(classId, entries, index + 1, onComplete),
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '儲存失敗',
          detail: err?.error?.error || '新增時段失敗，請確認是否存在重疊時段',
        });
      },
    });
  }

  private findLocalScheduleOverlap(entries: ScheduleFormEntry[]): {
    firstEntryNo: number;
    secondEntryNo: number;
    weekday: number;
  } | null {
    for (let i = 0; i < entries.length; i++) {
      const left = entries[i];
      if (!left.weekday) continue;

      for (let j = i + 1; j < entries.length; j++) {
        const right = entries[j];
        if (!right.weekday || left.weekday !== right.weekday) continue;
        // 「下個月起改週三」之後，同一個時間的舊段與新段前後接續、日期不重疊（#1100 #22）
        if (!rangesOverlap(left, right)) continue;

        const isOverlap = left.startTime < right.endTime && right.startTime < left.endTime;
        if (isOverlap) {
          return {
            firstEntryNo: i + 1,
            secondEntryNo: j + 1,
            weekday: left.weekday,
          };
        }
      }
    }
    return null;
  }

  /**
   * 「從某日起改時段」（#1100 #22）。送出後 API 已經寫好了，所以重讀班級、把時段列換成新的；
   * 表單其他欄位（名稱等）保留，時段列上還沒存的改動會被重讀蓋掉。
   */
  protected openSplit(entry: ScheduleFormEntry): void {
    const classId = this.cls()?.id;
    const schedule = this.cls()?.schedules?.find((s) => s.id === entry.id);
    if (!classId || !schedule) return;
    const data: ScheduleSplitDialogData = {
      classId,
      schedule,
      classroomOptions: this.classroomOptions(),
      teacherOptions: this.filteredStaffOptions(),
    };
    const ref = this.dialogService.open(ScheduleSplitDialogComponent, {
      width: 'var(--dlg-w-md)',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data,
    });
    ref?.onClose.subscribe((result: SplitScheduleResult | undefined) => {
      if (!result) return;
      this.messageService.add({
        severity: 'success',
        summary: '時段已改',
        detail: result.kept.length
          ? `有 ${result.kept.length} 堂已有資料的課沒有自動改，請用「批次改時間」處理`
          : undefined,
      });
      this.classesService.get(classId).subscribe({
        next: (res) => {
          this.cls.set(res.data);
          this.scheduleEntries.set(this.toEntries(this.liveSchedules()));
        },
      });
    });
  }

  /** 從儀表板「班級改時段」進來（#2246）：多個時段時表單上方那一句 */
  protected readonly retimeHint = signal(false);

  /** 只有一個時段就直接開它的「從某日起改時段」；多個時段不替人挑，停在表單說要選哪個 */
  private startRetime(): void {
    if (!this.config.data?.retime) return;
    const entries = this.scheduleEntries().filter((e) => e.id);
    if (entries.length === 1) this.openSplit(entries[0]);
    else this.retimeHint.set(true);
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }
}

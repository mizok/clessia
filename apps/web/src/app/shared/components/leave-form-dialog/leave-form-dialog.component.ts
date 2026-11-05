import {
  Component,
  ElementRef,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Observable } from 'rxjs';
import { format, parseISO } from 'date-fns';
import {
  StudentsService,
  type Student,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  type GradeLevel,
} from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { LeaveService, type CreateLeaveInput, type LeaveRequest } from '@core/leave.service';
import {
  AttendanceService,
  type StudentDay,
  type StudentDaySession,
} from '@core/attendance.service';
import { CampusContextService } from '@core/campus-context.service';
import { SystemClockService } from '@core/system-clock.service';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

interface SelectOption<T> {
  label: string;
  value: T | null;
}

function isStudentSelection(value: unknown): value is Student {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value['id'] === 'string' &&
    'name' in value &&
    typeof value['name'] === 'string'
  );
}

/** DB 回 `HH:MM:SS`，picker 要 Date */
function toTimeDate(time: string | null): Date | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m);
}

/**
 * **#2290 起已無作用**：換成共用殼之後，內容區內距由全站 `.p-dialog-content:has(.form-dialog--a6)` 歸 0、
 * 底部留白由殼的底部列撐，`--leave-foot-pb` 沒有人讀了。保留 export 只是為了不在這張動到請假頁、
 * 學生詳情的開窗點與 spec（兩頁各由別席負責）；那兩頁換殼時一起拿掉。
 */
export const LEAVE_DIALOG_CONTENT_STYLE: Record<string, string> = {
  'padding-bottom': '0',
  '--leave-foot-pb': 'var(--space-5)',
};

@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [DialogFrameComponent, FormsModule, SelectModule, StudentAutocompleteComponent],
  template: `
    <!-- 共用殼（#2290）：管理端標題讀開窗端的 header；家長端嵌在原生 <dialog> 裡，副標寫孩子 -->
    <app-dialog-frame [title]="title" [sub]="sub()" (closed)="cancel()">
      <!-- 嵌入（家長端）時學生寫在外框的副標，這裡不出學生欄（A6 forms.leave） -->
      @if (student()) {
      } @else if (fixedStudentName(); as fixedName) {
        <div class="flex w-full flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700">學生</label>
          <strong>{{ fixedName }}</strong>
        </div>
      } @else {
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-zinc-700">分校</label>
            <p-select
              [(ngModel)]="selectedCampusId"
              [options]="campusOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="全部分校"
              styleClass="w-full"
              (onChange)="onFilterChange()"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-zinc-700">年級</label>
            <p-select
              [(ngModel)]="selectedGrade"
              [options]="gradeOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="全部年級"
              styleClass="w-full"
              (onChange)="onFilterChange()"
            />
          </div>
        </div>

        <div class="flex w-full flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700"
            >學生 <span class="text-error-600">*</span></label
          >
          <!-- 跟儀表板「登記請假」同一組（#2318）：建議列寫分校 · 家長，家長名也找得到 -->
          <app-student-autocomplete
            [value]="selectedStudent"
            (valueChange)="onStudent($event)"
            [suggestions]="studentSuggestions()"
            [showContact]="true"
            (queryChange)="searchStudents($event)"
          />
        </div>
      }

      @if (mode() === 'sessions') {
        <!-- A6 leave.html newLeave（#2318）：請假日期 → 那天的課（勾選，預設全勾）→ 原因 -->
        <!-- 稿的這幾欄直接在 acset__body 裡（殼的內容區），不包 form、不多包一層 -->
        <div class="min-w-0">
          <label class="mb-1 block text-md font-semibold text-zinc-700" for="leave-day"
            >請假日期 <span class="text-error-700" aria-hidden="true">*</span></label
          >
          <input
            id="leave-day"
            type="date"
            class="h-10 w-full min-w-0 rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
            [value]="day()"
            (input)="onDay($any($event.target).value)"
          />
        </div>
        <div class="min-w-0" data-testid="leave-pick">
          <p class="m-0 mb-1 text-md font-semibold text-zinc-700" id="leave-pick-label">
            要請假的課
          </p>
          <!-- A6 .pick：清單與空狀態都在這一層（標題在外面） -->
          <div class="flex flex-col gap-2">
            @if (!studentId()) {
              <!-- A6 .pick__none -->
              <p class="m-0 rounded-md bg-zinc-100 p-3 text-md text-zinc-700">
                先選學生，這裡會列出他那天的課。
              </p>
            } @else if (dayState() === 'loading') {
              <p class="m-0 text-md text-zinc-600" role="status">載入這天的課…</p>
            } @else if (dayState() === 'error') {
              <p class="m-0 text-md text-error-700">讀不到這天的課，請換個日期或稍後再試。</p>
            } @else if (daySessions().length === 0) {
              <p class="m-0 rounded-md bg-zinc-100 p-3 text-md text-zinc-700">
                該日無排課。{{ studentLabel() }}在 {{ dayLabel() }} 沒有課，換一天試試。
              </p>
            } @else {
              <div class="contents" role="group" aria-labelledby="leave-pick-label">
                @for (s of daySessions(); track s.sessionId) {
                  <label
                    class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-solid border-zinc-300 bg-white px-3 has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset has-disabled:cursor-not-allowed has-disabled:text-zinc-500"
                  >
                    <input
                      type="checkbox"
                      class="m-0 size-[18px] accent-zinc-900"
                      [checked]="picked().has(s.sessionId)"
                      [disabled]="!!blockedReason(s)"
                      (change)="toggle(s.sessionId)"
                    />
                    <span class="font-semibold">{{ s.className }}</span>
                    <small class="ml-auto text-sm text-zinc-600 tabular-nums"
                      >{{ s.startTime?.slice(0, 5) }}–{{ s.endTime?.slice(0, 5) }}</small
                    >
                    @if (blockedReason(s); as why) {
                      <span class="text-sm text-zinc-600">{{ why }}</span>
                    }
                  </label>
                }
              </div>
            }
          </div>
        </div>
        <div class="min-w-0">
          <label class="mb-1 block text-md font-semibold text-zinc-700" for="leave-reason"
            >原因（選填）</label
          >
          <input
            id="leave-reason"
            type="text"
            [(ngModel)]="reason"
            placeholder="請假原因"
            autocomplete="off"
            class="h-10 w-full min-w-0 rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
          />
        </div>
      } @else {
        <!-- A6 forms.leave：四個欄各自有標籤，桌機兩兩並排、手機一欄一列 -->
        <!-- ngNoForm：A6 的欄位包在 <form> 裡，但這裡的 ngModel 是 standalone，不要 NgForm -->
        <form
          ngNoForm
          class="grid grid-cols-1 gap-x-3 gap-y-4 wide:grid-cols-2"
          (submit)="$event.preventDefault()"
        >
          @for (f of dateFields; track f.key) {
            <!-- A6 .acset__f／.acset__l：標籤是 block＋下距 4，欄位是一般的 inline-block（不包 flex） -->
            <div class="min-w-0">
              <label
                class="mb-1 block text-md font-semibold text-zinc-700"
                [attr.for]="'leave-' + f.key"
                >{{ f.label }}
                @if (f.required) {
                  <span class="text-error-700" aria-hidden="true">*</span>
                }
              </label>
              <!-- A6 forms.leave：原生 date／time 欄（.acset__in），手機 44 高、字 16 -->
              <input
                [id]="'leave-' + f.key"
                [type]="f.time ? 'time' : 'date'"
                class="h-10 w-full min-w-0 rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
                [value]="toInput(this[f.key], f.time)"
                [min]="f.key === 'endDate' ? toInput(startDate, false) : ''"
                (input)="setField(f.key, fromInput($any($event.target).value, f.time))"
              />
            </div>
          }
          <div class="min-w-0 wide:col-span-2">
            <label class="mb-1 block text-md font-semibold text-zinc-700" for="leave-reason"
              >原因（選填）</label
            >
            <!-- A6 是單行文字欄 -->
            <input
              id="leave-reason"
              type="text"
              [(ngModel)]="reason"
              placeholder="請假原因"
              autocomplete="off"
              class="h-10 w-full min-w-0 rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
            />
          </div>
        </form>
      }
      <!-- 跨日、指定時段（現況有、A6 沒畫，R2 不刪）：收成一個連結。編輯時維持原本的模式 -->
      @if (pickSessions && !editing) {
        <button
          type="button"
          class="mt-1 inline-flex min-h-11 cursor-pointer items-center self-start border-0 bg-transparent p-0 text-md font-semibold text-zinc-900 underline underline-offset-[3px]"
          data-testid="leave-mode-toggle"
          (click)="switchMode()"
        >
          {{ mode() === 'sessions' ? '改用日期區間（跨日、指定時段）' : '改回勾選當天的課' }}
        </button>
      }

      <!--
        A6 form() 的底部：必填沒填時送出鈕不鎖死，旁邊一行寫還差什麼（#723：disabled 會把「為什麼不行」藏起來）；
        處理中寫「送出中…」。送出失敗的訊息也寫在這一行，填的內容不清。sticky 與底部留白（含 safe-area）由殼處理
      -->
      <ng-container dialogFoot>
        <p
          class="m-0 mr-auto text-md max-wide:basis-full"
          [class.text-error-700]="!!errorMessage()"
          [class.text-zinc-600]="!errorMessage()"
          aria-live="polite"
        >
          {{ errorMessage() ?? missingHint() }}
        </p>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9"
          [disabled]="saving()"
          (click)="cancel()"
        >
          取消
        </button>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
          [attr.aria-disabled]="!canSubmit() || saving()"
          (click)="submit()"
        >
          {{ saving() ? (editing ? '儲存中…' : '送出中…') : editing ? '儲存變更' : '送出請假' }}
        </button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class LeaveFormDialogComponent implements OnInit {
  /** 管理端由 DialogService 開（有 ref）；家長端直接嵌在頁面的 `<dialog>` 裡（沒有 ref，靠 `closed`） */
  private readonly dialogRef = inject(DynamicDialogRef, { optional: true });
  private readonly config = inject(DynamicDialogConfig, { optional: true });
  private readonly studentsService = inject(StudentsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly leaveService = inject(LeaveService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly campusCtx = inject(CampusContextService);
  private readonly todayTaipei = inject(SystemClockService).todayTaipei;
  // 編輯模式：`data.leave` 有值。換學生等於撤掉再開一張（PATCH 沒有 studentId），所以學生唯讀。
  protected readonly editing: LeaveRequest | null = this.config?.data?.leave ?? null;

  /**
   * 嵌入用（家長端，#1695）：學生固定是這一位，不出學生欄；A6 `forms.leave` 的預設
   * 今天 17:00–21:00 也只在這條路帶（管理端的行為不變）
   */
  readonly student = input<{ id: string; name: string } | null>(null);
  /** 嵌入用：送出走哪支 API（家長端是 `/api/me/leaves`）；沒給就是管理端的 `LeaveService.create` */
  readonly create = input<((body: CreateLeaveInput) => Observable<unknown>) | null>(null);
  /** 嵌入用：送出成功帶回建立的假、取消帶 null（DialogService 開的走 `dialogRef.close`） */
  readonly closed = output<unknown>();

  /** 殼的標題：管理端讀開窗端的 header（登記／編輯請假），家長端嵌入時是「登記請假」 */
  protected readonly title: string = (this.config?.header as string | undefined) ?? '登記請假';
  /** 嵌入（家長端）時學生不出欄位，寫在副標（A6 forms.leave） */
  protected readonly sub = computed(() => {
    const s = this.student();
    if (s) return `${s.name} · 這段時間的課都會標成請假`;
    return this.mode() === 'sessions' ? '送出後，勾的課出缺席會標成請假' : '';
  });

  // 預帶學生（學生檔案的「登記請假」）：`data.student` 有值就跟編輯一樣學生唯讀，不給選
  protected presetStudent(): { id: string; name: string } | null {
    return this.config?.data?.student ?? this.student();
  }

  protected fixedStudentName(): string | null {
    return this.editing?.studentName ?? this.presetStudent()?.name ?? null;
  }

  protected selectedCampusId: string | null = null;
  protected selectedGrade: GradeLevel | null = null;
  protected selectedStudent: Student | string | null = null;
  protected startDate: Date | null = null;
  protected endDate: Date | null = null;
  protected startTime: Date | null = null;
  protected endTime: Date | null = null;
  protected reason = '';

  /** 四個日期時間欄（A6 forms.leave 的欄名）；時間選填（管理端一直是選填，後端也收 null） */
  protected readonly dateFields = [
    { key: 'startDate', label: '開始日期', time: false, required: true },
    { key: 'startTime', label: '開始時間', time: true, required: false },
    { key: 'endDate', label: '結束日期', time: false, required: true },
    { key: 'endTime', label: '結束時間', time: true, required: false },
  ] as const;

  /**
   * 勾選當天的課（#2318，A6 leave.html newLeave）：只有管理端開窗端給 `data.pickSessions`。
   * 家長端不勾堂次（specs/parent/leave.md Q6），維持日期區間。
   */
  protected readonly pickSessions: boolean = !!this.config?.data?.pickSessions;
  /** 編輯時照原本的假：有綁堂＝勾選，沒綁堂（區間、整天）＝區間 */
  protected readonly mode = signal<'sessions' | 'range'>(
    this.pickSessions && (!this.editing || (this.editing.sessionIds?.length ?? 0) > 0)
      ? 'sessions'
      : 'range',
  );
  // 只有勾堂模式用得到；家長端不讀伺服器時鐘
  protected readonly day = signal<string>(
    this.editing?.startDate ?? (this.pickSessions ? this.todayTaipei() : ''),
  );
  protected readonly studentId = signal<string | null>(
    this.editing?.studentId ?? this.config?.data?.student?.id ?? null,
  );
  private readonly dayResult = signal<StudentDay | 'loading' | 'error' | null>(null);
  protected readonly dayState = computed(() => {
    const r = this.dayResult();
    return r === 'loading' || r === 'error' ? r : 'ready';
  });
  protected readonly daySessions = computed<StudentDaySession[]>(() => {
    const r = this.dayResult();
    return r && typeof r === 'object' ? r.sessions : [];
  });
  protected readonly picked = signal<ReadonlySet<string>>(new Set());

  protected readonly saving = signal(false);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly campusOptions = computed<SelectOption<string>[]>(() => [
    { label: '全部分校', value: null },
    ...this.refData
      .campuses()
      .filter((campus) => campus.isActive)
      .map((campus) => ({ label: campus.name, value: campus.id })),
  ]);

  protected readonly gradeOptions: SelectOption<GradeLevel>[] = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  constructor() {
    // 嵌入（家長端）時桌機聚焦第一欄、手機不聚焦（不要一開就彈鍵盤）—— A6 form()（a6.js:383）。
    // 不用 [autofocus]：家長頁的 showModal 比表單先跑，那時還沒有欄位。管理端的 DynamicDialog 不走這條
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (this.student() && globalThis.matchMedia?.('(min-width: 861px)').matches)
        host.querySelector<HTMLInputElement>('#leave-startDate')?.focus();
    });
  }

  ngOnInit(): void {
    if (this.mode() === 'sessions') this.loadDay();
    const leave = this.editing;
    if (leave) {
      this.startDate = parseISO(leave.startDate);
      this.endDate = parseISO(leave.endDate);
      this.startTime = toTimeDate(leave.startTime);
      this.endTime = toTimeDate(leave.endTime);
      this.reason = leave.reason ?? '';
      return;
    }
    if (this.student()) {
      this.startDate = this.endDate = new Date();
      this.startTime = toTimeDate('17:00');
      this.endTime = toTimeDate('21:00');
    }
    if (this.presetStudent()) return;
    this.refData.loadCampuses();
    // 分校預設帶頂列（#2318）；頂列是全部分校時維持全部
    if (this.pickSessions) this.selectedCampusId = this.campusCtx.id();
  }

  protected onStudent(value: Student | string | null): void {
    this.selectedStudent = value;
    const id = isStudentSelection(value) ? value.id : null;
    if (id === this.studentId()) return;
    this.studentId.set(id);
    if (this.mode() === 'sessions') this.loadDay();
  }

  protected onDay(value: string): void {
    if (!value || value === this.day()) return;
    this.day.set(value);
    this.loadDay();
  }

  protected switchMode(): void {
    this.mode.set(this.mode() === 'sessions' ? 'range' : 'sessions');
    this.errorMessage.set(null);
    if (this.mode() === 'sessions') this.loadDay();
  }

  /** 區間模式：結束日跟開始日（#2318）—— 結束日空的或早於開始日就帶同一天，單日假不用填兩次 */
  protected setField(key: 'startDate' | 'endDate' | 'startTime' | 'endTime', value: Date | null) {
    this[key] = value;
    if (key === 'startDate' && value && (!this.endDate || this.endDate < value))
      this.endDate = value;
  }

  /** 停課的、已經被別張假蓋到的不能勾（後者送出會 409 重疊）；編輯時自己這張綁的堂不算 */
  protected blockedReason(s: StudentDaySession): string | null {
    if (s.cancelled) return '停課';
    if (s.existingLeave && !this.editing?.sessionIds?.includes(s.sessionId)) return '已請假';
    return null;
  }

  protected toggle(id: string): void {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  protected studentLabel(): string {
    const s = this.selectedStudent;
    return this.fixedStudentName() ?? (isStudentSelection(s) ? s.name : '');
  }

  protected dayLabel(): string {
    const d = parseISO(this.day());
    return `${format(d, 'M/d')}（${'日一二三四五六'[d.getDay()]}）`;
  }

  /** 那天的課：管理端儀表板「登記請假」同一支 `GET /attendance/student-day` */
  private loadDay(): void {
    const id = this.studentId();
    if (!id) {
      this.dayResult.set(null);
      return;
    }
    const day = this.day();
    this.dayResult.set('loading');
    this.attendanceService.studentDay(id, day).subscribe({
      next: (res) => {
        if (id !== this.studentId() || day !== this.day()) return; // 換得快，舊回應不蓋新的
        this.dayResult.set(res.data);
        // 預設全勾能勾的（A6）；編輯時帶回原本綁的那幾堂
        const own = this.editing?.sessionIds;
        this.picked.set(
          new Set(
            res.data.sessions
              .filter((x) => !this.blockedReason(x))
              .filter((x) => !own?.length || own.includes(x.sessionId))
              .map((x) => x.sessionId),
          ),
        );
      },
      error: () => {
        if (id === this.studentId() && day === this.day()) this.dayResult.set('error');
      },
    });
  }

  /** 原生 date／time 欄的字串（`yyyy-MM-dd`／`HH:mm`）↔ 表單裡的 Date */
  protected toInput(value: Date | null, time: boolean): string {
    return value ? format(value, time ? 'HH:mm' : 'yyyy-MM-dd') : '';
  }

  protected fromInput(value: string, time: boolean): Date | null {
    if (!value) return null;
    return time ? toTimeDate(value) : parseISO(value);
  }

  protected onFilterChange(): void {
    this.selectedStudent = null;
    this.studentSuggestions.set([]);
  }

  protected canSubmit(): boolean {
    if (this.mode() === 'sessions') return !this.sessionsHint();
    return (
      (this.fixedStudentName() !== null || isStudentSelection(this.selectedStudent)) &&
      !!this.startDate &&
      !!this.endDate &&
      this.startDate <= this.endDate
    );
  }

  /** A6 newLeave 的 why()：還沒選學生／這天沒有他的課／至少勾一堂課 */
  private sessionsHint(): string {
    if (this.fixedStudentName() === null && !isStudentSelection(this.selectedStudent))
      return '還沒選學生';
    if (this.dayState() !== 'ready') return '';
    if (this.daySessions().length === 0) return '這天沒有他的課';
    if (this.picked().size === 0) return '至少勾一堂課';
    return '';
  }

  /** A6「還沒填：…」：必填沒填的欄名 */
  protected missingHint(): string {
    if (this.mode() === 'sessions') return this.sessionsHint();
    const missing = [
      ...(this.fixedStudentName() === null && !isStudentSelection(this.selectedStudent)
        ? ['學生']
        : []),
      ...(this.startDate ? [] : ['開始日期']),
      ...(this.endDate ? [] : ['結束日期']),
    ];
    return missing.length ? `還沒填：${missing.join('、')}` : '';
  }

  protected searchStudents(query: string): void {
    this.studentsService
      .list({
        // 不帶 searchScope：家長名也比對（同儀表板「登記請假」，#2318）—— 打電話來的常是家長
        search: query,
        campusId: this.selectedCampusId ?? undefined,
        grade: this.selectedGrade ?? undefined,
        isActive: true,
        pageSize: 30,
      })
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
      });
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.mode() === 'sessions') {
      this.submitSessions();
      return;
    }
    const student = this.selectedStudent;
    if (!this.editing && !this.presetStudent() && !isStudentSelection(student)) {
      this.errorMessage.set('請從建議清單選擇一位學生');
      return;
    }
    if (!this.startDate || !this.endDate) {
      this.errorMessage.set('請完整填寫開始與結束日期');
      return;
    }
    if (this.startDate > this.endDate) {
      this.errorMessage.set('結束日期不可早於開始日期');
      return;
    }
    if (
      format(this.startDate, 'yyyy-MM-dd') === format(this.endDate, 'yyyy-MM-dd') &&
      this.startTime &&
      this.endTime &&
      format(this.startTime, 'HH:mm') > format(this.endTime, 'HH:mm')
    ) {
      this.errorMessage.set('同一天請假的結束時間不可早於開始時間');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const fields = {
      startDate: format(this.startDate, 'yyyy-MM-dd'),
      endDate: format(this.endDate, 'yyyy-MM-dd'),
      startTime: this.startTime ? format(this.startTime, 'HH:mm') : null,
      endTime: this.endTime ? format(this.endTime, 'HH:mm') : null,
      reason: this.reason || null,
    };
    const create = (body: CreateLeaveInput) =>
      this.create()?.(body) ?? this.leaveService.create(body);
    const request$: Observable<unknown> = this.editing
      ? this.leaveService.update(this.editing.id, fields)
      : create({ studentId: this.presetStudent()?.id ?? (student as Student).id, ...fields });

    this.send(request$);
  }

  /** 勾選模式：送 `sessionIds`，日期由 server 從堂次算；時間不能一起給（API 互斥） */
  private submitSessions(): void {
    const hint = this.sessionsHint();
    if (hint || this.dayState() !== 'ready' || this.picked().size === 0) {
      this.errorMessage.set(hint || '還在載入這天的課');
      return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);
    const sessionIds = [...this.picked()];
    const reason = this.reason || null;
    const student = this.selectedStudent;
    const studentId =
      this.editing?.studentId ??
      this.presetStudent()?.id ??
      (isStudentSelection(student) ? student.id : '');
    this.send(
      this.editing
        ? this.leaveService.update(this.editing.id, { reason, sessionIds })
        : this.leaveService.create({
            studentId,
            startDate: this.day(),
            endDate: this.day(),
            reason,
            sessionIds,
          }),
    );
  }

  private send(request$: Observable<unknown>): void {
    request$.subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.close(leave);
      },
      error: (err) => {
        this.saving.set(false);
        // 錯誤留在表單、填的不清（#1695 §5）。家長端回 `{ error, code }`，管理端回 `{ error, message }`
        const msg =
          err?.error?.code === 'NO_SESSIONS'
            ? `這段時間 ${this.fixedStudentName()} 沒有課`
            : (err?.error?.message ?? (err?.error?.code ? err.error.error : undefined));
        this.errorMessage.set(
          msg ?? (this.editing ? '儲存失敗，請稍後再試' : '新增請假失敗，請稍後再試'),
        );
      },
    });
  }

  protected cancel(): void {
    this.close(null);
  }

  private close(result: unknown): void {
    if (this.dialogRef) this.dialogRef.close(result);
    else this.closed.emit(result);
  }
}

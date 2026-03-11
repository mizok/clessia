# Calendar UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 改善教務管理板塊的資訊完整性、操作效率與工作流程引導，不依賴學生/報名模組。

**Architecture:** 分三個階段漸進實作。Phase 1 只改現有 component 的資訊顯示；Phase 2 加操作效率優化；Phase 3 補工作流程引導。所有變更均在現有 component 結構內進行，不新增 route 或 service。

**Tech Stack:** Angular 21 Signals + PrimeNG 21 + date-fns

---

## Phase 1：資訊完整性

### Task 1：異動紀錄加時間戳

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-detail-dialog/session-detail-dialog.component.html`

**現況**

異動紀錄只顯示 changeType、substituteTeacherName、newDate、reason、createdByName，沒有時間戳。`ScheduleChange` interface 已有 `createdAt: string`（ISO string）。

**Step 1: 在 HTML 異動紀錄的 `cal-detail__by` span 後加時間戳**

找到這段：
```html
<span class="cal-detail__by">{{ c.createdByName }}</span>
```
改為：
```html
<span class="cal-detail__by">{{ c.createdByName }}・{{ c.createdAt | date:'MM/dd HH:mm' }}</span>
```

**Step 2: 確認 DatePipe 已 import**

在 `session-detail-dialog.component.ts` 的 imports 陣列加入 `DatePipe`（來自 `@angular/common`）。

**Step 3: 手動驗證**

點一個有異動紀錄的課堂，確認每筆異動紀錄右側顯示 `03/10 14:30` 格式的時間。

**Step 4: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/dialogs/session-detail-dialog/
git commit -m "feat(calendar): add timestamp to session change history"
```

---

### Task 2：清單視圖加「共 N 堂」統計

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-list/session-list.component.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-list/session-list.component.ts`

**現況**

`session-list` 有 `sessions` input（全部課堂陣列）。表格有分頁但沒有顯示總筆數的文字提示。

**Step 1: 在 `session-list.component.ts` 加 computed**

```typescript
protected readonly sessionCountLabel = computed(() => {
  const total = this.sessions().length;
  if (total === 0) return '';
  const cancelled = this.sessions().filter(s => s.status === 'cancelled').length;
  const unassigned = this.sessions().filter(
    s => s.assignmentStatus === 'unassigned' && s.status === 'scheduled'
  ).length;
  const parts = [`共 ${total} 堂`];
  if (unassigned > 0) parts.push(`${unassigned} 堂未指派`);
  if (cancelled > 0) parts.push(`${cancelled} 堂已停課`);
  return parts.join('・');
});
```

**Step 2: 在 HTML 表格上方加統計列**

在 `<app-responsive-table>` 的起始 tag 之前插入：
```html
@if (sessionCountLabel()) {
  <p class="session-list__count">{{ sessionCountLabel() }}</p>
}
```

**Step 3: 在 `session-list.component.scss` 加樣式**

```scss
.session-list__count {
  font-size: 0.8125rem;
  color: var(--text-secondary, #71717a);
  padding: var(--space-2) var(--space-1);
  margin: 0;
}
```

**Step 4: 手動驗證**

清單視圖載入後，表格上方顯示「共 12 堂・3 堂未指派・1 堂已停課」。

**Step 5: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/components/session-list/
git commit -m "feat(calendar): show session count summary above list"
```

---

### Task 3：行事曆格未指派課堂顯示警示樣式

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-calendar-grid/session-calendar-grid.component.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-calendar-grid/session-calendar-grid.component.scss`

**現況**

行事曆格有 `--scheduled`、`--cancelled`、`--changed` 三種 modifier。未指派課堂（`assignmentStatus === 'unassigned'`）沒有特別的視覺區分，容易被忽略。

**Step 1: 在週視圖的 session div 加 modifier**

找到 `class="session-calendar-grid__session"` 所在的 `<div>`，在現有 class binding 後加一行：
```html
[class.session-calendar-grid__session--unassigned]="slot.session.assignmentStatus === 'unassigned' && slot.session.status === 'scheduled'"
```

日視圖（同一個 HTML 檔案的下半部）也要加同樣的 class binding。

**Step 2: 在 SCSS 加樣式**

```scss
.session-calendar-grid__session--unassigned {
  border-left: 3px solid var(--p-orange-400);
  background-color: color-mix(in srgb, var(--p-orange-50) 60%, transparent);
}
```

**Step 3: 手動驗證**

行事曆中未指派老師的課堂顯示橘色左邊框。已指派的課堂不受影響。

**Step 4: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/components/session-calendar-grid/
git commit -m "feat(calendar): highlight unassigned sessions in calendar grid"
```

---

### Task 4：代課 Dialog 顯示老師本週課量

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-substitute-dialog/session-substitute-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-substitute-dialog/session-substitute-dialog.component.html`

**現況**

代課 dialog 載入可用老師列表，但下拉選項只顯示老師名字，看不到老師本週有幾堂課，難以判斷是否合適。

**Step 1: 修改 `loadTeachers` 同時查詢本週課堂數**

在 `session-substitute-dialog.component.ts` 新增型別與 signal：

```typescript
interface TeacherOption {
  readonly id: string;
  readonly displayName: string;
  readonly weeklySessionCount: number;
}

readonly teacherOptions = signal<TeacherOption[]>([]);
```

修改 `loadTeachers()`，用 `forkJoin` 同時取得老師列表與本週課堂：

```typescript
private loadTeachers() {
  const s = this.session();
  if (!s) { this.teacherOptions.set([]); return; }

  this.loadingTeachers.set(true);
  const weekStart = startOfWeek(new Date(`${s.sessionDate}T00:00:00`), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  forkJoin({
    teachersRes: this.staffService.list({ role: 'teacher', campusId: s.campusId }),
    courseRes: this.coursesService.get(s.courseId),
    weekSessions: this.sessionsService.list({
      from: format(weekStart, 'yyyy-MM-dd'),
      to: format(weekEnd, 'yyyy-MM-dd'),
      campusId: s.campusId,
    }),
  }).subscribe({
    next: ({ teachersRes, courseRes, weekSessions }) => {
      const subjectId = courseRes.data.subjectId;
      const countMap = new Map<string, number>();
      weekSessions.data.forEach(session => {
        if (session.teacherId && session.status === 'scheduled') {
          countMap.set(session.teacherId, (countMap.get(session.teacherId) ?? 0) + 1);
        }
      });
      const available = teachersRes.data
        .filter(t =>
          t.id !== s.teacherId &&
          t.campusIds.includes(s.campusId) &&
          t.subjectIds.includes(subjectId),
        )
        .map(t => ({
          id: t.id,
          displayName: t.displayName,
          weeklySessionCount: countMap.get(t.id) ?? 0,
        }))
        .sort((a, b) => a.weeklySessionCount - b.weeklySessionCount);
      this.teacherOptions.set(available);
      this.loadingTeachers.set(false);
    },
    error: () => this.loadingTeachers.set(false),
  });
}
```

需要 import：`import { format, startOfWeek, endOfWeek } from 'date-fns';`

`teachers` signal 改用 `teacherOptions`，並在 form submit 時從 `teacherOptions` 取得 id。

**Step 2: 更新 HTML select options**

```html
<p-select
  formControlName="teacherId"
  [options]="teacherOptions()"
  optionLabel="displayName"
  optionValue="id"
  placeholder="選擇代課老師"
  [loading]="loadingTeachers()"
  styleClass="w-full"
>
  <ng-template pTemplate="item" let-item>
    <div class="sub-teacher-option">
      <span>{{ item.displayName }}</span>
      <span class="sub-teacher-option__count">本週 {{ item.weeklySessionCount }} 堂</span>
    </div>
  </ng-template>
</p-select>
```

**Step 3: 加 SCSS**

```scss
.sub-teacher-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);

  &__count {
    font-size: 0.75rem;
    color: var(--text-secondary, #71717a);
  }
}
```

**Step 4: 手動驗證**

打開代課 dialog，老師下拉每個選項右側顯示「本週 3 堂」，清單依課量由低到高排序。

**Step 5: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/dialogs/session-substitute-dialog/
git commit -m "feat(calendar): show teacher weekly load in substitute dialog"
```

---

## Phase 2：操作效率

### Task 5：調課 Dialog 顯示目標日期已排課堂

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-reschedule-dialog/session-reschedule-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-reschedule-dialog/session-reschedule-dialog.component.html`

**現況**

調課 dialog 只有一個日期選擇器，選完日期後沒有提示那天有哪些課。使用者需要開另一個視窗比對。

**Step 1: 加 signal 與監聽**

```typescript
readonly targetDateSessions = signal<Array<{
  className: string;
  startTime: string;
  endTime: string;
  teacherName: string | null;
}>>([]);
readonly loadingTargetDate = signal(false);
```

在 `ngOnInit` 中監聽 `newSessionDate` 的變化：

```typescript
this.form.get('newSessionDate')!.valueChanges
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(date => {
    if (!date) { this.targetDateSessions.set([]); return; }
    this.loadTargetDateSessions(date);
  });
```

新增 `loadTargetDateSessions(date: Date)`：

```typescript
private loadTargetDateSessions(date: Date): void {
  const s = this.session();
  if (!s) return;
  const dateStr = format(date, 'yyyy-MM-dd');
  this.loadingTargetDate.set(true);
  this.sessionsService.list({ from: dateStr, to: dateStr, campusId: s.campusId })
    .subscribe({
      next: res => {
        this.targetDateSessions.set(
          res.data
            .filter(session => session.status === 'scheduled' && session.id !== s.id)
            .map(session => ({
              className: session.className,
              startTime: session.startTime,
              endTime: session.endTime,
              teacherName: session.teacherName,
            }))
        );
        this.loadingTargetDate.set(false);
      },
      error: () => this.loadingTargetDate.set(false),
    });
}
```

需要 inject `DestroyRef` 和 import `takeUntilDestroyed`。

**Step 2: 在 HTML 日期選擇器下方加提示區塊**

```html
@if (loadingTargetDate()) {
  <p class="cal-op-form__hint">載入中...</p>
} @else if (targetDateSessions().length > 0) {
  <div class="cal-op-form__target-sessions">
    <p class="cal-op-form__hint">該日已有 {{ targetDateSessions().length }} 堂課：</p>
    @for (s of targetDateSessions(); track s.className) {
      <span class="cal-op-form__target-session-chip">
        {{ s.startTime }}–{{ s.endTime }} {{ s.className }}
      </span>
    }
  </div>
}
```

**Step 3: 加 SCSS**

```scss
.cal-op-form__target-sessions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.cal-op-form__target-session-chip {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--p-zinc-100);
  color: var(--p-zinc-600);
  white-space: nowrap;
}
```

**Step 4: 手動驗證**

打開調課 dialog，選擇一個有其他課堂的日期，確認日期選擇器下方出現「該日已有 N 堂課」提示和課堂 chip。

**Step 5: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/dialogs/session-reschedule-dialog/
git commit -m "feat(calendar): show existing sessions on target date in reschedule dialog"
```

---

### Task 6：班級列表「未指派」badge 點擊跳轉行事曆

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`

**現況**

班級列表每行有「34 堂未指派」的警告 badge，但這個 badge 只是顯示數字，點擊沒有任何行為。`navigateToCalendarList(cls)` 方法已存在，可以跳轉到行事曆清單視圖並帶 classId 篩選。

**Step 1: 找到 classes.page.html 中的未指派 badge**

搜尋 `upcomingUnassignedCount` 或 `未指派` 找到 badge 所在位置。

**Step 2: 改為可點擊的 button**

在 badge 外層加上 click handler，呼叫一個新的導航方法：

```html
<button
  class="classes-page__unassigned-badge"
  (click)="navigateToCalendarUnassigned(cls); $event.stopPropagation()"
  [pTooltip]="'查看未指派課堂'"
  tooltipPosition="top"
>
  ⚠ {{ cls.upcomingUnassignedCount }} 堂未指派
</button>
```

**Step 3: 在 `classes.page.ts` 加 `navigateToCalendarUnassigned` 方法**

```typescript
protected navigateToCalendarUnassigned(cls: Class): void {
  this.router.navigate(['/admin/calendar'], {
    queryParams: {
      view: 'list',
      classId: cls.id,
      campusId: cls.campusId,
      courseId: cls.courseId,
      assignmentStatus: 'unassigned',
    },
  });
}
```

**Step 4: calendar.page.ts 接收 assignmentStatus query param**

在 `applyQueryParams()` 中加：

```typescript
if (params['assignmentStatus']) {
  this.assignmentStatusFilter.set(params['assignmentStatus'] as 'unassigned' | null);
}
```

新增 `assignmentStatusFilter = signal<'unassigned' | null>(null)`。

在 `activeFilterCount` 和 `hasActiveFilters` 中納入此條件，並在 `clearFilters` 中重置。

在 `loadSessions()` 的 `sessionsService.list(...)` call 中傳入（需確認 API 支援此參數，若不支援則在前端 filter）。

**Step 5: 手動驗證**

在班級列表點擊「N 堂未指派」badge，行事曆清單視圖應開啟且已預先篩選該班級。

**Step 6: Commit**
```bash
git add apps/web/src/app/features/admin/pages/classes/
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(classes): navigate to unassigned sessions from class badge"
```

---

### Task 7：批次操作加詳細結果摘要

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/mobile-batch-dialog/mobile-batch-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`

**現況**

`MobileBatchDialogResult` 只有 `updated: number`。批次完成後 toast 只顯示「已更新 N 堂課」，沒有說明跳過了幾堂、原因為何。

**Step 1: 擴充 `MobileBatchDialogResult`**

```typescript
export interface MobileBatchDialogResult {
  readonly action: 'applied';
  readonly updated: number;
  readonly skipped: number;
  readonly mode: BatchMode;
}
```

在 `mobile-batch-dialog.component.ts` 關閉前傳入 skipped 和 mode：

```typescript
const skipped = this.skippedCount();
const mode = this.currentMode() ?? 'cancel';
this.ref.close({ action: 'applied', updated, skipped, mode } satisfies MobileBatchDialogResult);
```

**Step 2: 在 `calendar.page.ts` 用詳細文案取代簡單 toast**

```typescript
ref?.onClose.subscribe((result?: MobileBatchDialogResult) => {
  if (result?.action === 'applied') {
    this.clearSelection();
    this.loadSessions();
    const modeLabel: Record<string, string> = {
      cancel: '停課', uncancel: '取消停課', assign: '指派老師', time: '調整時間',
    };
    const label = modeLabel[result.mode] ?? '更新';
    const detail = result.skipped > 0
      ? `已${label} ${result.updated} 堂，略過 ${result.skipped} 堂`
      : `已${label} ${result.updated} 堂`;
    this.messageService.add({ severity: 'success', summary: '批次操作完成', detail });
  }
});
```

**Step 3: 手動驗證**

批次停課 5 堂，其中 2 堂不符合條件被略過。toast 顯示「已停課 3 堂，略過 2 堂」。

**Step 4: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/dialogs/mobile-batch-dialog/
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts
git commit -m "feat(calendar): detailed batch operation result message"
```

---

### Task 8：清單視圖快速篩選「僅顯示未指派」

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-filters/session-filters.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/components/session-filters/session-filters.component.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`

**現況**

清單視圖的篩選只有日期、分校、課程、老師、班級，沒有依指派狀態篩選的選項。

**Step 1: 在 `session-filters` 加 input 與 output**

```typescript
readonly showOnlyUnassigned = input(false);
readonly showOnlyUnassignedChange = output<boolean>();
```

**Step 2: 在 HTML 清單視圖篩選列加 toggle button**

在 `@if (viewMode() === 'list')` 的篩選列中，課程選擇器前加：

```html
@if (viewMode() === 'list') {
  <p-button
    [label]="showOnlyUnassigned() ? '顯示全部' : '僅未指派'"
    [severity]="showOnlyUnassigned() ? 'warn' : 'secondary'"
    [outlined]="!showOnlyUnassigned()"
    size="small"
    icon="pi pi-user-minus"
    (onClick)="showOnlyUnassignedChange.emit(!showOnlyUnassigned())"
  />
}
```

**Step 3: 在 `calendar.page.ts` 加 signal 與 computed**

```typescript
protected readonly showOnlyUnassigned = signal(false);
```

在 `activeFilterCount` 中加：
```typescript
if (this.viewMode() === 'list' && this.showOnlyUnassigned()) count++;
```

在 `hasActiveFilters` 中加：
```typescript
(this.viewMode() === 'list' && this.showOnlyUnassigned())
```

在 `clearFilters` 中加：
```typescript
this.showOnlyUnassigned.set(false);
```

前端過濾（不需改 API）：

```typescript
protected readonly filteredSessions = computed(() => {
  const sessions = this.sessions();
  if (!this.showOnlyUnassigned()) return sessions;
  return sessions.filter(s => s.assignmentStatus === 'unassigned' && s.status === 'scheduled');
});
```

將 `calendar.page.html` 中傳給 `app-session-list` 的 `[sessions]` 改為 `filteredSessions()`。

**Step 4: 手動驗證**

點擊「僅未指派」按鈕，清單只顯示未指派課堂。再點一次「顯示全部」，清單回復。badge 數字在 toggle 後更新。

**Step 5: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/components/session-filters/
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.html
git commit -m "feat(calendar): add unassigned quick filter in list view"
```

---

## Phase 3：工作流程引導

### Task 9：停課後提示安排補課

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/dialogs/session-cancel-dialog/session-cancel-dialog.component.ts`

**現況**

停課成功後 dialog 關閉，只有 toast。沒有引導使用者去安排補課。

**Step 1: 停課成功後改用 confirm dialog 詢問是否安排補課**

在 `session-cancel-dialog.component.ts` 的 `submit()` success callback 中：

```typescript
next: () => {
  const s = this.session();
  this.ref.close({ result: 'refresh', session: s });
},
```

**Step 2: 在呼叫方（`session-detail-dialog.component.ts`）接收並處理**

`openCancel()` 目前是 `this.ref.close()` 然後用 `dialogService.open(SessionCancelDialogComponent)`。改為訂閱 cancel dialog 的關閉：

```typescript
protected openCancel(): void {
  const s = this.session();
  if (!s) return;
  const cancelRef = this.dialogService.open(SessionCancelDialogComponent, {
    header: '停課',
    width: '400px',
    data: { session: s },
    styleClass: 'cal-dialog',
  });
  cancelRef.onClose.subscribe((result?: { result: string; session: Session }) => {
    if (result?.result === 'refresh') {
      this.ref.close('refresh');
      this.messageService.add({
        severity: 'success',
        summary: '已停課',
        detail: `如需安排補課，請至行事曆清單視圖新增調課`,
        life: 6000,
      });
    }
  });
}
```

注意：`session-detail-dialog` 目前 `openCancel` 先 `this.ref.close()` 再開 cancel dialog，這樣 cancel dialog 的 MessageService 是獨立的。需要調整為先開 cancel dialog，cancel 完成後再關 detail dialog。

**Step 3: 手動驗證**

停課後 detail dialog 關閉，toast 顯示「已停課」並附帶補課提示文字，持續 6 秒。

**Step 4: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/dialogs/session-cancel-dialog/
git add apps/web/src/app/features/admin/pages/calendar/dialogs/session-detail-dialog/
git commit -m "feat(calendar): prompt user to arrange makeup after cancellation"
```

---

### Task 10：切換分校時保留篩選提示

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`

**現況**

`onCampusChange()` 切換分校時會靜默 reset 課程、老師、班級篩選。使用者可能不知道篩選條件消失了。

**Step 1: 切換分校前若有 active filters 顯示提示**

```typescript
protected onCampusChange(campusId: string | null): void {
  const hadFilters = this.hasActiveFilters();
  this.selectedCampusId.set(campusId);
  this.selectedCourseId.set(null);
  this.selectedTeacherIds.set([]);
  this.selectedClassId.set(null);
  this.loadSessions();
  if (hadFilters) {
    this.messageService.add({
      severity: 'info',
      summary: '篩選條件已重置',
      detail: '切換分校時，課程、老師與班級篩選已自動清除',
      life: 3000,
    });
  }
}
```

**Step 2: 手動驗證**

設定課程篩選後切換分校，出現 info toast 說明篩選已重置。未設定篩選時切換分校，不出現 toast。

**Step 3: Commit**
```bash
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts
git commit -m "feat(calendar): notify user when campus switch resets filters"
```

---

## 完成後驗收清單

- [ ] 異動紀錄每筆都有時間戳
- [ ] 清單視圖上方顯示總堂數、未指派堂數、停課堂數
- [ ] 行事曆格中未指派課堂有橘色左邊框
- [ ] 代課 dialog 每位老師顯示本週課量，按課量排序
- [ ] 調課 dialog 選日期後顯示該日已有的課堂
- [ ] 班級列表的未指派 badge 可點擊跳轉行事曆
- [ ] 批次操作完成後 toast 顯示「成功 N 堂、略過 N 堂」
- [ ] 清單視圖有「僅未指派」快速篩選 toggle
- [ ] 停課後 toast 附帶補課引導文字
- [ ] 切換分校若有篩選條件，顯示提示 toast

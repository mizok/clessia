# 課程與班級停用行為 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 實作課程停用警告、班級停用對話框（含可選的取消未來課堂），以及停用後阻擋新增班級的 UI 邏輯。

**Architecture:**
- 班級停用 → 自訂 `<p-dialog>` 提供「僅停用」vs「停用並取消所有未來課堂」兩個選項（PrimeNG ConfirmDialog 只支援 2 鈕，這裡需要 3 鈕所以用 Dialog）
- 課程停用 → 在編輯 Dialog 內顯示 inline 警告（不 cascade 到班級），並在主列表停用「新增班」按鈕 + 加 tooltip
- 新 API endpoint `POST /api/classes/:id/cancel-future-sessions` 取消未來 scheduled 課堂

**Tech Stack:** Angular 21 Signals, PrimeNG Dialog, Hono OpenAPI, Supabase

---

### Task 1: API — 新增 cancel-future-sessions 端點

**Files:**
- Modify: `apps/api/src/routes/classes.ts`（在 DELETE /api/classes/:id 之前加入）

**Step 1: 在 classes.ts 的 Route 區塊最後（export default app 之前）加入以下路由**

在 `export default app;` 之前插入：

```typescript
// POST /api/classes/:id/cancel-future-sessions
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel-future-sessions',
    tags: ['Classes'],
    summary: '取消此班級所有未來已排定的課堂',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ cancelled: z.number() }),
          },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    // 確認班級存在
    const { data: cls } = await supabase
      .from('classes')
      .select('id')
      .eq('id', id)
      .single();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: updated, error } = await supabase
      .from('sessions')
      .update({ status: 'cancelled' })
      .eq('class_id', id)
      .gte('session_date', today)
      .eq('status', 'scheduled')
      .select('id');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 404);
    }

    return c.json({ cancelled: updated?.length ?? 0 }, 200);
  }
);
```

**Step 2: 手動測試**

啟動 API server (`npx tsx watch src/index.ts` 或 dev 指令)，確認 OpenAPI doc 有出現 `POST /api/classes/{id}/cancel-future-sessions`。

---

### Task 2: ClassesService — 新增 cancelFutureSessions 方法

**Files:**
- Modify: `apps/web/src/app/core/classes.service.ts`

**Step 1: 在 generateSessions 方法後面加入**

```typescript
cancelFutureSessions(id: string): Observable<{ cancelled: number }> {
  return this.http.post<{ cancelled: number }>(
    `${this.endpoint}/${id}/cancel-future-sessions`,
    {}
  );
}
```

---

### Task 3: Page TS — 新增停用 Dialog 的 Signals 與方法

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`

**Step 1: 在 Class Dialog signals 區塊之後（`// ---- Generate Sessions Dialog ----` 之前）加入停用 Dialog signals**

```typescript
// ---- Deactivate Class Dialog ----
protected readonly deactivateDialogVisible = signal(false);
protected readonly deactivateTargetClass = signal<Class | null>(null);
protected readonly deactivateLoading = signal(false);
```

**Step 2: 新增 editingCourseActiveClassCount computed（在 filteredStaffOptions 之後）**

```typescript
protected readonly editingCourseActiveClassCount = computed(() => {
  const courseId = this.editingCourseId();
  if (!courseId) return 0;
  return this.classes().filter((cl) => cl.courseId === courseId && cl.isActive).length;
});
```

**Step 3: 修改 confirmToggleActive 方法**

原本：
```typescript
protected confirmToggleActive(cls: Class): void {
  const action = cls.isActive ? '停用' : '啟用';
  this.confirmationService.confirm({
    message: `確定要${action}班級「${cls.name}」嗎？`,
    header: `確認${action}`,
    icon: 'pi pi-question-circle',
    acceptLabel: action,
    rejectLabel: '取消',
    accept: () => {
      this.classesService.toggleActive(cls.id).subscribe({
        next: (res) => {
          this.classes.update((list) =>
            list.map((c) => (c.id === cls.id ? res.data : c))
          );
          this.messageService.add({
            severity: 'success',
            summary: `${action}成功`,
            detail: `「${cls.name}」已${action}`,
          });
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: `${action}失敗`,
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    },
  });
}
```

改成：
```typescript
protected confirmToggleActive(cls: Class): void {
  if (cls.isActive) {
    // 停用 → 開啟自訂 Dialog
    this.deactivateTargetClass.set(cls);
    this.deactivateDialogVisible.set(true);
  } else {
    // 啟用 → 維持簡單 confirm
    this.confirmationService.confirm({
      message: `確定要啟用班級「${cls.name}」嗎？`,
      header: '確認啟用',
      icon: 'pi pi-question-circle',
      acceptLabel: '啟用',
      rejectLabel: '取消',
      accept: () => this.doToggleActive(cls, false),
    });
  }
}

protected deactivateOnly(): void {
  const cls = this.deactivateTargetClass();
  if (!cls) return;
  this.deactivateLoading.set(true);
  this.classesService.toggleActive(cls.id).subscribe({
    next: (res) => {
      this.classes.update((list) => list.map((c) => (c.id === cls.id ? res.data : c)));
      this.deactivateDialogVisible.set(false);
      this.deactivateLoading.set(false);
      this.messageService.add({ severity: 'success', summary: '停用成功', detail: `「${cls.name}」已停用` });
    },
    error: (err) => {
      this.deactivateLoading.set(false);
      this.messageService.add({ severity: 'error', summary: '停用失敗', detail: err.error?.error || '請稍後再試' });
    },
  });
}

protected deactivateAndCancelSessions(): void {
  const cls = this.deactivateTargetClass();
  if (!cls) return;
  this.deactivateLoading.set(true);
  // 先停用，再取消未來課堂
  this.classesService.toggleActive(cls.id).subscribe({
    next: (res) => {
      this.classes.update((list) => list.map((c) => (c.id === cls.id ? res.data : c)));
      this.classesService.cancelFutureSessions(cls.id).subscribe({
        next: (r) => {
          this.deactivateDialogVisible.set(false);
          this.deactivateLoading.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '停用成功',
            detail: `「${cls.name}」已停用，已取消 ${r.cancelled} 筆未來課堂`,
          });
        },
        error: () => {
          // 停用成功但取消課堂失敗，仍算部分成功
          this.deactivateDialogVisible.set(false);
          this.deactivateLoading.set(false);
          this.messageService.add({
            severity: 'warn',
            summary: '班級已停用',
            detail: '取消未來課堂時發生錯誤，請手動確認',
          });
        },
      });
    },
    error: (err) => {
      this.deactivateLoading.set(false);
      this.messageService.add({ severity: 'error', summary: '停用失敗', detail: err.error?.error || '請稍後再試' });
    },
  });
}

private doToggleActive(cls: Class, expectedIsActive: boolean): void {
  this.classesService.toggleActive(cls.id).subscribe({
    next: (res) => {
      this.classes.update((list) => list.map((c) => (c.id === cls.id ? res.data : c)));
      const action = expectedIsActive ? '停用' : '啟用';
      this.messageService.add({ severity: 'success', summary: `${action}成功`, detail: `「${cls.name}」已${action}` });
    },
    error: (err) => {
      const action = expectedIsActive ? '停用' : '啟用';
      this.messageService.add({ severity: 'error', summary: `${action}失敗`, detail: err.error?.error || '請稍後再試' });
    },
  });
}
```

---

### Task 4: Page HTML — 新增停用 Dialog

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html`

**Step 1: 在 Generate Sessions Dialog 的 `</p-dialog>` 之後加入停用 Dialog**

```html
<!-- ============================================================ -->
<!-- Deactivate Class Dialog -->
<!-- ============================================================ -->
<p-dialog
  header="停用班級"
  [(visible)]="deactivateDialogVisible"
  [modal]="true"
  [closable]="!deactivateLoading()"
  [style]="{ width: '28rem' }"
>
  @if (deactivateTargetClass()) {
    <div class="form-dialog">
      <div class="deactivate-dialog__body">
        <i class="pi pi-ban deactivate-dialog__icon"></i>
        <p class="deactivate-dialog__message">
          確定要停用班級「<strong>{{ deactivateTargetClass()!.name }}</strong>」嗎？
        </p>
        <p class="deactivate-dialog__hint">
          停用後將無法新增學生報名，也無法產生新課堂。
        </p>
      </div>

      <div class="form-dialog__footer form-dialog__footer--column">
        <p-button
          label="停用並取消所有未來課堂"
          icon="pi pi-calendar-times"
          severity="danger"
          [loading]="deactivateLoading()"
          (onClick)="deactivateAndCancelSessions()"
          styleClass="w-full"
        />
        <p-button
          label="僅停用（保留已排課堂）"
          icon="pi pi-ban"
          [outlined]="true"
          severity="secondary"
          [loading]="deactivateLoading()"
          (onClick)="deactivateOnly()"
          styleClass="w-full"
        />
        <p-button
          label="取消"
          [text]="true"
          severity="secondary"
          [disabled]="deactivateLoading()"
          (onClick)="deactivateDialogVisible.set(false)"
          styleClass="w-full"
        />
      </div>
    </div>
  }
</p-dialog>
```

---

### Task 5: Page HTML — 課程停用警告 + 阻擋新增班

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html`

**Step 1: 修改課程 Header 的「新增班」按鈕，加入 disabled 與 tooltip**

找到（classes.page.html line ~136-143）：
```html
<p-button
  label="新增班"
  icon="pi pi-plus"
  size="small"
  [outlined]="true"
  severity="secondary"
  (onClick)="openCreateClassDialog(group.course.id)"
/>
```

改成：
```html
<p-button
  label="新增班"
  icon="pi pi-plus"
  size="small"
  [outlined]="true"
  severity="secondary"
  [disabled]="!group.course.isActive"
  [pTooltip]="!group.course.isActive ? '課程已停用，無法新增班級' : ''"
  tooltipPosition="top"
  (onClick)="openCreateClassDialog(group.course.id)"
/>
```

**Step 2: 在課程 Dialog 的狀態 toggleswitch 下方加入 inline 警告**

找到（classes.page.html）課程 dialog 的狀態欄位：
```html
@if (courseDialogMode() === 'edit') {
  <div class="form-dialog__field form-dialog__field--inline">
    <label class="form-dialog__label">狀態</label>
    <div class="form-dialog__switch-row">
      <p-toggleswitch
        [ngModel]="courseForm().isActive"
        (ngModelChange)="updateCourseForm('isActive', $event)"
        [disabled]="courseDialogLoading()"
      />
      <span class="form-dialog__switch-label">
        {{ courseForm().isActive ? '啟用中' : '已停用' }}
      </span>
    </div>
  </div>
}
```

改成：
```html
@if (courseDialogMode() === 'edit') {
  <div class="form-dialog__field form-dialog__field--inline">
    <label class="form-dialog__label">狀態</label>
    <div class="form-dialog__switch-row">
      <p-toggleswitch
        [ngModel]="courseForm().isActive"
        (ngModelChange)="updateCourseForm('isActive', $event)"
        [disabled]="courseDialogLoading()"
      />
      <span class="form-dialog__switch-label">
        {{ courseForm().isActive ? '啟用中' : '已停用' }}
      </span>
    </div>
  </div>
  @if (!courseForm().isActive && editingCourseActiveClassCount() > 0) {
    <div class="form-dialog__warning">
      <i class="pi pi-info-circle"></i>
      此課程下有 {{ editingCourseActiveClassCount() }} 個啟用班級，停用後不影響現有班級運作，但無法新增新班級。
    </div>
  }
}
```

---

### Task 6: SCSS — 新增 deactivate dialog 和 warning 樣式

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.scss`

**Step 1: 在檔案末尾加入**

```scss
// ── Deactivate Dialog ──────────────────────────────────────────
.deactivate-dialog {
  &__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3);
    padding: var(--space-4) 0;
  }

  &__icon {
    font-size: 2rem;
    color: var(--p-red-500);
  }

  &__message {
    font-size: 0.9375rem;
    color: var(--zinc-800);
  }

  &__hint {
    font-size: 0.8125rem;
    color: var(--zinc-500);
    margin: 0;
  }
}

// ── Form Dialog Warning ────────────────────────────────────────
.form-dialog {
  &__warning {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: 6px;
    background: var(--p-yellow-50);
    border: 1px solid var(--p-yellow-200);
    color: var(--p-yellow-800);
    font-size: 0.8125rem;
    line-height: 1.5;

    i {
      flex-shrink: 0;
      margin-top: 2px;
    }
  }

  &__footer--column {
    flex-direction: column;
    gap: var(--space-2);
  }
}
```

---

### Task 7: 手動驗證

**Step 1: 測試班級停用流程**

1. 展開一個有班級的課程
2. 點開班級詳情 → 點「停用」
3. 確認出現自訂 Dialog，有三個按鈕
4. 點「停用並取消所有未來課堂」→ 確認 toast 顯示取消了幾筆
5. 點「僅停用」→ 確認 toast 顯示停用成功
6. 班級 tag 變為「停用」

**Step 2: 測試班級啟用流程**

1. 對已停用班級點「啟用」→ 確認出現簡單 confirm dialog（非自訂 Dialog）
2. 確認成功後 tag 變為「啟用」

**Step 3: 測試課程停用警告**

1. 點「編輯課程」，對有啟用班級的課程
2. 關掉 isActive toggleswitch
3. 確認出現 inline 警告：「此課程下有 X 個啟用班級...」
4. 存檔 → 課程顯示「已停用」tag（已有）

**Step 4: 測試課程停用後阻擋新增班**

1. 停用某課程
2. 確認「新增班」按鈕變為灰色（disabled）
3. Hover 到按鈕，確認 tooltip 顯示「課程已停用，無法新增班級」

# class 名對不上的一次性清理清單

> **不是 gate，是清單。** 兩個方向都掃過（2026-09-05，infra 席），
> 結論是**都不做 ratchet** —— 無害的比例太高，而**一份沒有人會清的 baseline 等於裝飾**：
> 它長期發出「有債」的訊號，而那訊號永遠不變，於是沒有人再看它。
>
> **不做也留下理由**，否則下一個人看到這批數字會重跑一次同樣的分析。
>
> 唯一機器化的是 **A20**（可互動元素的 class 全部沒定義），零 baseline，
> 因為那是唯一有使用者看得到後果的形狀。

## 掃描方法（要重跑就照這個，別用字面 grep）

**一定要解析 `&` 巢狀。** `.a { &__b {} }` 編出來是 `.a__b`，而那個字串在原始碼裡
**根本不存在** —— 用 `grep a__b **/*.scss` 會回零筆，於是這個 codebase 裡幾乎每一個
BEM class 都會被誤判成「沒定義」。2026-09-05 一則錯誤的 bug 診斷就是這樣產生的。

用 `tools/agent-harness/lib/scss-blocks.mjs` 的 `blocks()`，它同時遞迴進
`@media` / `@container`。

**兩側都要收齊載體**：

| 側   | 載體                                                                                     |
| ---- | ---------------------------------------------------------------------------------------- |
| 樣式 | `.scss`、`.ts` 的 `styles:`、`index.html` 的 `<style>`、**TS 裡的 CSS 字串**（列印版面） |
| 模板 | `.html`、`.ts` 的 inline template、`[class.x]`、動態組出來的字串                         |

**第一版只讀 `.scss`，製造了 27 個假陽性。**

---

## 甲、模板用了但沒有任何 CSS 定義（54 筆）

處置：**逐筆判斷是補樣式還是刪 class**。優先看下面兩組，其餘可以慢慢來。

- `courses/class-form-dialog`（7）—— `conflict-modal` **整族**，清單裡唯一「一整個對話框都沒樣式」的
- `sessions/sessions.component.ts`（4）—— `text-2xl` `font-bold` `mb-4` `text-zinc-500`：
  **Tailwind 風格 utility，而本專案不用 Tailwind**。同族還有 `w-full`、`ml-2`
- 其餘約 35 筆是 `__header` / `__title-group` 這種**遷去 `app-page-band` 之後的殘留**，每支 1–2 個
- 另有 9 筆是**死修飾詞**（基底有定義、`--x` 沒有 → 基底樣式照樣套，**零視覺後果**）：
  `academy-score-editor__th--notes`、`__cell--score`、`__cell--status`、`__cell--notes`、
  `score-edit-dialog__cell--score`、`__cell--status`、`attendance-page__card-date--meta`、
  `reports__flow-sw--rest`、`sessions-header__badge--attendance`

## 乙、SCSS 定義了但沒有任何模板掛（97 筆）

**這個方向的危險形狀不是「沒人用」，是「寫給了錯的家族」** ——
有人寫了一條規則、以為它在生效，而畫面在多數情況下正常，
只有在那條規則本來要保護的邊界條件下才出錯。

> 實例：`session-filters__control--date-range` 寫來保護 tablet-portrait 斷點，
> 而模板掛的是 `clessia-filter-control--date-range`，**從來沒有生效過**。

**12 筆疑似「寫錯家族」已另外交付 design-web**（見下節）。剩下 85 筆列在最後。

### 我第一個嚴重度分類法失敗了，記在這裡免得有人重走

我先分成「模板連 block 名都沒出現」（13 筆）vs「家族在用、只有這個元素沒掛」（49 筆），
以為前者是失效的意圖、後者是殘留。**兩個判斷都錯**：

- 那 13 筆有 8 筆是 `*-table` 遷去 `responsive-table` 的殘留，**不是失效的意圖**
- **已知的那個真 bug 落在 49 筆那一堆裡** —— 我的訊號對它完全沒反應

有效的訊號是**「同樣的尾巴掛在別的前綴下」**，而且要收緊成「這個尾巴只被另外一個前綴用過」
（`__actions` / `__table` 這種通用 BEM 名字會巧合撞上，寬鬆版得到 45 筆）。

**收緊版自己也有誤報**：`_auth-form.scss` 的 `form__tab*` 配到 `bottom-bar__tabs`，
但登入表單的 tab 跟底部導覽毫無關係，只是尾巴撞名。**訊號沒有免疫的**。

---

## 丙、其餘 85 筆 —— **已知無害，不設 gate，僅供日後大掃除參考**

多數是抽元件／遷移之後留在原地的死碼。**不急，也不必一次做完。**

（共 85 筆，分佈在 30 支 SCSS）

- `features/public/shared/_auth-form.scss`（15）—— `form__field`、`form__label`、`form__input`、`form__tabs-indicator`、`form__input-wrapper`、`form__reveal-btn`、`form__submit`、`form__row`、`form__checkbox`、`form__link--back`、`form__link--spaced`、`message--success`、`message--error`、`message--info`、`auth-content__hint`
- `styles.scss`（15）—— `dialog-header-inline__row`、`dialog-header-inline__back`、`form-dialog__readonly`、`form-dialog__footer--column`、`session-detail__section`、`session-detail__section-title`、`session-detail__row`、`session-detail__icon`、`session-detail__change`、`session-detail__change-body`、`session-detail__reason`、`session-detail__unassigned`、`session-detail__by`、`session-op-form__time`、`import-dialog__result-icon--error`
- `shared/components/account-settings-dialog/account-settings-dialog.component.scss`（6）—— `account-settings__section--step`、`account-settings__confirm-card`、`account-settings__confirm-row`、`account-settings__confirm-label`、`account-settings__confirm-value`、`account-settings`
- `features/admin/pages/sessions/components/session-filters/session-filters.component.scss`（5）—— `session-filters__control--date-range`、`session-filters__teacher-option`、`session-filters__teacher-option-name`、`session-filters__teacher-option-subjects`、`session-filters__teacher-option-campuses`
- `features/admin/pages/courses/class-form-dialog/class-form-dialog.component.scss`（4）—— `schedule-entry__row--meta`、`schedule-entry__date-input`、`schedule-entry__effective`、`schedule-entry__meta-label`
- `features/admin/pages/sessions/components/sessions-header/sessions-header.component.scss`（4）—— `sessions-header__datepicker-popup`、`sessions-header__actions`、`sessions-header__nav`、`sessions-header__view-toggle`
- `shared/components/inline-notice/inline-notice.component.scss`（4）—— `inline-notice--error`、`inline-notice--success`、`inline-notice--warning`、`inline-notice--info`
- `features/admin/pages/students/students.page.scss`（3）—— `students__header-actions`、`student-table__actions`、`student-table`
- `shared/components/status/status-dot/status-dot.component.scss`（3）—— `status-dot--pending`、`status-dot--overdue`、`status-dot--inactive`
- `features/admin/pages/campuses/campuses.page.scss`（2）—— `campus-table__actions`、`campus-table`
- `features/admin/pages/changes/changes.component.scss`（2）—— `changes__table`、`changes__batch`
- `features/admin/pages/parents/parents.page.scss`（2）—— `parent-table__actions`、`parent-table`
- `features/admin/pages/staff/staff.page.scss`（2）—— `staff-table__actions`、`staff-table`
- `shared/components/parent-form-dialog/parent-form-dialog.component.scss`（2）—— `form-dialog__hint`、`form-dialog__notice`
- `features/admin/pages/courses/class-detail/enrollment-billing-dialog/enrollment-billing-dialog.component.scss`（1）—— `enrollment-billing__field--inline`
- `features/admin/pages/courses/course-form-dialog.component.scss`（1）—— `course-form-dialog`
- `features/admin/pages/enrollments/enrollments.page.scss`（1）—— `enrollments__table`
- `features/admin/pages/fee-templates/billing-period-form-dialog/billing-period-form-dialog.component.scss`（1）—— `billing-period-form__field--inline`
- `features/admin/pages/grades/exams/academy-exam-form-dialog/academy-exam-form-dialog.component.scss`（1）—— `academy-exam-form-dialog`
- `features/admin/pages/grades/exams/school-exam-form-dialog/school-exam-form-dialog.component.scss`（1）—— `school-exam-form-dialog`
- `features/admin/pages/grades/exams/score-entry/score-entry.component.scss`（1）—— `score-entry__editor-placeholder`
- `features/admin/pages/payments/invoice-detail-dialog/invoice-detail-dialog.component.scss`（1）—— `invoice-detail__table`
- `features/admin/pages/sessions/components/session-batch/session-batch.component.scss`（1）—— `session-batch`
- `features/admin/pages/sessions/components/sessions-body/sessions-body.component.scss`（1）—— `sessions-body__skeleton`
- `features/admin/pages/sessions/dialogs/session-assign-dialog/session-assign-dialog.component.scss`（1）—— `session-op-form__error`
- `features/admin/pages/staff/teaching-log-dialog/teaching-log-dialog.component.scss`（1）—— `teaching-log__table`
- `shared/components/audit-log-dialog/audit-log-dialog.component.scss`（1）—— `audit-log`
- `shared/components/page-actions/page-actions.component.scss`（1）—— `page-actions`
- `shared/components/responsive-table/responsive-table.component.scss`（1）—— `responsive-table__row`
- `shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.scss`（1）—— `session-advanced-filters-dialog__summary-text`

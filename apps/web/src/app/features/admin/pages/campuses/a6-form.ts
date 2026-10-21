/**
 * 分校頁兩支 A6 `form()` 對話框（分校、教室）共用的外觀：原生 `<dialog>`＋A6 `.acset`／`.fdlg`／`.btn`。
 * 寫成字串常數而不是元件 —— 兩支的欄位、行為都不同，共用的只有 class。
 */

/** `.acset.fdlg`：桌機置中 520px；手機（≤860px）貼底、灰底面板 */
export const A6_DIALOG =
  'overlay-motion overlay-motion--from-bottom-narrow m-auto max-h-[calc(100%-48px)] w-[min(520px,calc(100%-32px))] overflow-y-auto overscroll-contain rounded-lg border-0 bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(26_22_20/36%)] backdrop:bg-zinc-900/40 max-wide:inset-x-0 max-wide:top-auto max-wide:bottom-0 max-wide:m-0 max-wide:max-h-[calc(100%-24px)] max-wide:w-full max-wide:max-w-none max-wide:rounded-none max-wide:rounded-t-xl max-wide:bg-zinc-200';

/** `.acset__close`（桌機 40、手機 44 觸控） */
export const A6_CLOSE =
  'grid size-10 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 max-wide:size-11';

/** `.acset__body.fdlg__body`：桌機兩欄（`fdlg__half` 各佔一欄）、手機一欄 */
export const A6_FORM =
  'grid grid-cols-2 gap-x-3 gap-y-4 px-6 pt-2 pb-6 max-wide:grid-cols-1 max-wide:px-4';

/** `.acset__l` */
export const A6_LABEL = 'mb-1 block text-md font-semibold text-zinc-700';

/** `.fdlg .acset__in`（桌機 40、手機 44＋大字） */
export const A6_INPUT =
  'h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg';

/** `.fdlg__foot`：黏在捲動區底 */
export const A6_FOOT =
  'sticky bottom-0 z-[1] flex flex-wrap items-center justify-end gap-2 bg-inherit px-6 pt-3 pb-6 max-wide:px-4 max-wide:pt-2 max-wide:pb-[calc(16px+env(safe-area-inset-bottom,0px))]';

const BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-55 max-wide:h-11';
/** `.btn` */
export const A6_BTN = `${BTN} border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50`;
/** `.btn.btn--cta` */
export const A6_BTN_CTA = `${BTN} border-accent-vivid bg-accent-vivid hover:border-accent-vivid-2 hover:bg-accent-vivid-2`;
/** 危險動作（刪除確認） */
export const A6_BTN_DANGER = `${BTN} border-error-700 bg-error-700 text-white`;

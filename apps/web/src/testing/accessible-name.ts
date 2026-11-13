/**
 * 欄位的可及名稱（簡化版：aria-labelledby → aria-label → label[for] → 外層 label），給「這個欄位有沒有名字」
 * 的 spec 用（#2468）。**placeholder 刻意不算** —— 那正是 #2468 要修的。
 * ponytail: 只涵蓋本 repo 用得到的四種接法；要完整 accname 演算法再引 dom-accessibility-api。
 */
export function accessibleName(el: Element): string {
  const root = el.getRootNode() as ParentNode;
  const byId = (id: string) => root.querySelector(`[id="${id}"]`);
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => byId(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const label = el.id ? root.querySelector(`label[for="${el.id}"]`) : null;
  return (label ?? el.closest('label'))?.textContent?.trim() ?? '';
}

/** 頁面上學生自動完成欄真正的 input（#2468） */
export function studentInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('app-student-autocomplete input');
  if (!input) throw new Error('找不到學生自動完成的 input');
  return input;
}

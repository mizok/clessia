import type { CreateBillingPeriodInput } from '@core/billing-periods.service';

/**
 * 學期模板（#1100 #35③，使用者 10-23 裁定）：選一個模板就照「下一個學年」建好一組期間，日期之後可改。
 * 三個模板、名稱帶民國學年；續課通知日、是否啟用不做（跟自動續課一起暫緩）。
 */
export type PeriodTemplateKey = 'two-terms' | 'terms-and-breaks' | 'terms-with-breaks';

export const PERIOD_TEMPLATES: ReadonlyArray<{ label: string; value: PeriodTemplateKey }> = [
  { label: '傳統二學期制', value: 'two-terms' },
  { label: '學期＋寒暑假', value: 'terms-and-breaks' },
  { label: '上學期＋暑假／下學期＋寒假', value: 'terms-with-breaks' },
];

/** [名稱, 開始, 結束]；日期是 MM-DD，`+` 開頭＝學年的隔年 */
const SHAPES: Record<PeriodTemplateKey, ReadonlyArray<readonly [string, string, string]>> = {
  'two-terms': [
    ['上學期', '09-01', '+01-31'],
    ['下學期', '+02-01', '+06-30'],
  ],
  'terms-and-breaks': [
    ['上學期', '09-01', '+01-20'],
    ['寒假班', '+01-21', '+02-10'],
    ['下學期', '+02-11', '+06-30'],
    ['暑期班', '+07-01', '+08-31'],
  ],
  // 受訪補習班的實際做法（billing_foundation migration 的註解）：暑假併進上學期、寒假併進下學期
  'terms-with-breaks': [
    ['上學期＋暑假', '07-01', '+01-31'],
    ['下學期＋寒假', '+02-01', '+06-30'],
  ],
};

/** 下一個學年的開始年（西元）：今天之後最近的 9/1；今天就是 9/1 算這一年 */
export function nextAcademicYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today.slice(5) <= '09-01' ? year : year + 1;
}

export function periodsFromTemplate(
  key: PeriodTemplateKey,
  today: string,
): CreateBillingPeriodInput[] {
  const year = nextAcademicYear(today);
  const roc = year - 1911;
  const date = (md: string) => (md.startsWith('+') ? `${year + 1}-${md.slice(1)}` : `${year}-${md}`);
  return SHAPES[key].map(([name, from, to]) => ({
    name: `${roc} ${name}`,
    startDate: date(from),
    endDate: date(to),
  }));
}

import { describe, expect, it } from 'vitest';

import { buildPeriodFilter, buildSelect, sortColumn } from './list-query';

describe('buildPeriodFilter', () => {
  it('期間內新報名或退班都要抓到', () => {
    expect(buildPeriodFilter('2026-08-01', '2026-08-31')).toBe(
      'and(effective_from.gte.2026-08-01,effective_from.lte.2026-08-31),' +
        'and(effective_to.gte.2026-08-01,effective_to.lte.2026-08-31)',
    );
  });

  it('只給起日時兩個欄位都只比起日', () => {
    expect(buildPeriodFilter('2026-08-01', undefined)).toBe(
      'effective_from.gte.2026-08-01,effective_to.gte.2026-08-01',
    );
  });

  it('只給迄日時兩個欄位都只比迄日', () => {
    expect(buildPeriodFilter(undefined, '2026-08-31')).toBe(
      'effective_from.lte.2026-08-31,effective_to.lte.2026-08-31',
    );
  });

  // 期間清空 = 看全部在籍，不是看空清單
  it('沒有期間就不篩', () => {
    expect(buildPeriodFilter(undefined, undefined)).toBeNull();
  });

  it('兩個欄位都要出現 —— 只比 effective_from 會漏掉整批退班', () => {
    const filter = buildPeriodFilter('2026-08-01', '2026-08-31') ?? '';

    expect(filter).toContain('effective_from');
    expect(filter).toContain('effective_to');
  });
});

describe('buildSelect', () => {
  // 少了 !inner 的話 campus 篩選不會排除任何列，只會讓班級欄位變成空白
  it('依分校過濾時 classes 必須是 inner join', () => {
    expect(buildSelect('campus-1')).toContain('classes!inner(');
  });

  it('沒有分校條件時維持一般關聯', () => {
    const select = buildSelect();

    expect(select).toContain('classes(');
    expect(select).not.toContain('!inner(');
  });

  it('兩種情況取得的欄位一樣', () => {
    expect(buildSelect('campus-1').replace('classes!inner', 'classes')).toBe(buildSelect());
  });
});

describe('sortColumn', () => {
  // 班級花名冊與學生在籍清單都吃這支 API，預設不能改
  it('預設是 created_at', () => {
    expect(sortColumn()).toBe('created_at');
    expect(sortColumn('createdAt')).toBe('created_at');
  });

  it('進出總覽要 updated_at', () => {
    expect(sortColumn('updatedAt')).toBe('updated_at');
  });
});

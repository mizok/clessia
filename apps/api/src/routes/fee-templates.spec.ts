import { describe, expect, it } from 'vitest';

import { buildFeeTemplateFilters } from './fee-templates';

describe('buildFeeTemplateFilters', () => {
  it('沒有任何條件時全是 null', () => {
    expect(buildFeeTemplateFilters({})).toEqual({
      searchFilter: null,
      isActiveFilter: null,
      billingModeFilter: null,
    });
  });

  it('搜尋只比對名稱', () => {
    expect(buildFeeTemplateFilters({ search: '月繳' }).searchFilter).toBe('%月繳%');
  });

  // 報名時挑價目表只想看還在用的 —— 停用的留著是為了歷史帳單看得懂，不是給人選的
  it('isActive 直接帶過去，false 不能被當成沒給', () => {
    expect(buildFeeTemplateFilters({ isActive: false }).isActiveFilter).toBe(false);
    expect(buildFeeTemplateFilters({ isActive: true }).isActiveFilter).toBe(true);
  });

  it('依計費模式篩選', () => {
    expect(buildFeeTemplateFilters({ billingMode: 'session_pack' }).billingModeFilter).toBe(
      'session_pack',
    );
  });
});

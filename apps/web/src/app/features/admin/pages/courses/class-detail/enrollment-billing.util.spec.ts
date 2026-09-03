import type { FeeTemplate } from '@core/fee-templates.service';

import {
  feeTemplateOptions,
  findTemplate,
  isAdjusted,
  payableAmount,
  pricingHint,
} from './enrollment-billing.util';

const template = (overrides: Partial<FeeTemplate> = {}): FeeTemplate =>
  ({
    id: 'ft-1',
    name: '國中月繳',
    billingMode: 'monthly',
    amount: 4500,
    isActive: true,
    ...overrides,
  }) as FeeTemplate;

describe('enrollment-billing.util', () => {
  describe('payableAmount —— 規則 5.1 的優先序', () => {
    it('議定金額優先於定價', () => {
      expect(payableAmount({ agreedAmount: 3800, feeTemplateId: 'ft-1' }, [template()])).toBe(3800);
    });

    // 全免是一個決定，不是「沒填」—— 0 被當成沒填的話會退回定價，變成跟老闆談好的相反
    it('議定金額 0 是有效的金額，不會退回定價', () => {
      expect(payableAmount({ agreedAmount: 0, feeTemplateId: 'ft-1' }, [template()])).toBe(0);
    });

    it('沒有議定金額就照價目表', () => {
      expect(payableAmount({ agreedAmount: null, feeTemplateId: 'ft-1' }, [template()])).toBe(4500);
    });

    // 猜一個數字比留白危險：留白會被填，猜錯的數字會被送出去
    it('兩個都沒有就回 null，不猜', () => {
      expect(payableAmount({ agreedAmount: null, feeTemplateId: null }, [template()])).toBeNull();
    });

    it('價目表 id 找不到對應時也回 null', () => {
      expect(payableAmount({ agreedAmount: null, feeTemplateId: 'ft-9' }, [template()])).toBeNull();
    });
  });

  describe('isAdjusted —— 什麼時候要求填原因', () => {
    it('沒填議定金額不算調整', () => {
      expect(isAdjusted(null, template())).toBe(false);
    });

    it('議定金額等於定價不算調整', () => {
      expect(isAdjusted(4500, template())).toBe(false);
    });

    it('議定金額低於定價是調整', () => {
      expect(isAdjusted(3800, template())).toBe(true);
    });

    // 加價也是議價（插班補教材、一對一加收），同樣要留下為什麼
    it('議定金額高於定價也是調整', () => {
      expect(isAdjusted(5200, template())).toBe(true);
    });

    // 憑空填出來的數字更需要說明它從哪來
    it('沒選價目表卻填了金額算調整', () => {
      expect(isAdjusted(3800, undefined)).toBe(true);
    });

    it('全免（0）算調整 —— 免費也要有理由', () => {
      expect(isAdjusted(0, template())).toBe(true);
    });
  });

  describe('選項與提示', () => {
    it('價目表選項第一個是「未指定」', () => {
      expect(feeTemplateOptions([template()])[0]).toEqual({ label: '未指定', value: null });
    });

    it('價目表選項帶出模式與定價，行政不用回頭查', () => {
      expect(feeTemplateOptions([template()])[1].label).toContain('4,500');
    });

    it('沒選價目表時沒有定價提示', () => {
      expect(pricingHint(undefined)).toBeNull();
    });

    it('findTemplate 對 null id 回 undefined，不會誤配第一筆', () => {
      expect(findTemplate([template()], null)).toBeUndefined();
    });
  });
});

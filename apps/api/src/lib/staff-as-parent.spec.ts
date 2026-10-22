import { describe, expect, it } from 'vitest';

import { decideExistingAccount, type ExistingAccount } from './staff-as-parent';

/**
 * #1844：家長頁新增家長時，Email／手機已經是某個帳號 —— 回哪個碼。
 * 判斷順序就是規格（`specs/admin/student-affairs/parents.md`）那張表，第一個成立的就回。
 */

const ORG = 'org-1';
const ME = 'admin-1';

const staffAccount = (over: Partial<ExistingAccount> = {}): ExistingAccount => ({
  userId: 'u-teacher',
  orgId: ORG,
  accountName: '帳號名',
  matchedBy: 'email',
  roles: ['teacher'],
  staff: { display_name: '王老師', status: 'active' },
  parent: null,
  ...over,
});

const decide = (accounts: ExistingAccount[], permissions: string[] = ['manage_students']) =>
  decideExistingAccount(accounts, { orgId: ORG, requesterUserId: ME, permissions });

describe('decideExistingAccount', () => {
  it('沒有既有帳號 → 照舊建新帳號', () => {
    expect(decide([])).toEqual({ kind: 'create' });
  });

  it('本機構、啟用中的教職員、還沒有家長資料 → 可以設為家長（回教職員姓名）', () => {
    expect(decide([staffAccount()])).toEqual({
      kind: 'link',
      userId: 'u-teacher',
      staffName: '王老師',
    });
  });

  it('別機構的帳號 → 照舊 409 DUPLICATE_*，不透露是誰', () => {
    expect(decide([staffAccount({ orgId: 'org-2' })])).toEqual({
      kind: 'reject',
      status: 409,
      code: 'DUPLICATE_EMAIL',
    });
    expect(decide([staffAccount({ orgId: 'org-2', matchedBy: 'phone' })])).toEqual({
      kind: 'reject',
      status: 409,
      code: 'DUPLICATE_PHONE',
    });
  });

  it('Email 與手機分別對到兩個帳號 → ACCOUNT_CONFLICT', () => {
    expect(
      decide([staffAccount(), staffAccount({ userId: 'u-other', matchedBy: 'phone' })]),
    ).toMatchObject({ kind: 'reject', status: 409, code: 'ACCOUNT_CONFLICT' });
  });

  it('兩個帳號裡有別機構的 → 先回 DUPLICATE（別機構排第一，不因此透露「有兩個帳號」）', () => {
    expect(
      decide([staffAccount(), staffAccount({ userId: 'u-x', orgId: 'org-2', matchedBy: 'phone' })]),
    ).toMatchObject({ code: 'DUPLICATE_PHONE' });
  });

  it('掃碼機台帳號 → 照舊 409（機台不是人）', () => {
    expect(decide([staffAccount({ roles: ['kiosk'] })])).toMatchObject({
      code: 'DUPLICATE_EMAIL',
    });
  });

  it('已經有家長資料（任何狀態）→ PARENT_ALREADY_EXISTS，帶 parentId／status／name，不自動恢復（Q1）', () => {
    for (const status of ['active', 'inactive', 'archived'] as const) {
      expect(decide([staffAccount({ parent: { id: 'p1', name: '王老師', status } })])).toEqual({
        kind: 'reject',
        status: 409,
        code: 'PARENT_ALREADY_EXISTS',
        details: { parentId: 'p1', status, name: '王老師' },
      });
    }
  });

  it('沒有教職員身分的本機構帳號（孤兒等）→ 維持現狀的 DUPLICATE', () => {
    expect(decide([staffAccount({ staff: null, roles: [] })])).toMatchObject({
      code: 'DUPLICATE_EMAIL',
    });
  });

  it('對到操作者本人：沒有 * → SELF_LINK_FORBIDDEN 403（Q3），排在停用與確認之前', () => {
    expect(decide([staffAccount({ userId: ME })])).toMatchObject({
      kind: 'reject',
      status: 403,
      code: 'SELF_LINK_FORBIDDEN',
    });
    expect(
      decide([staffAccount({ userId: ME, staff: { display_name: '我', status: 'inactive' } })]),
    ).toMatchObject({ code: 'SELF_LINK_FORBIDDEN' });
  });

  it('對到操作者本人、持有 * → 可以', () => {
    expect(decide([staffAccount({ userId: ME })], ['*'])).toMatchObject({ kind: 'link' });
  });

  it('教職員已停用或封存 → STAFF_NOT_ACTIVE（Q5）', () => {
    for (const status of ['inactive', 'archived']) {
      expect(decide([staffAccount({ staff: { display_name: '王老師', status } })])).toEqual({
        kind: 'reject',
        status: 409,
        code: 'STAFF_NOT_ACTIVE',
        details: { staffName: '王老師' },
      });
    }
  });

  it('同一個帳號被 Email 和手機都對到（兩筆一樣）→ 當成一個帳號', () => {
    expect(decide([staffAccount(), staffAccount({ matchedBy: 'phone' })])).toMatchObject({
      kind: 'link',
    });
  });

  it('教職員姓名是空的 → 退到帳號名（同 resolveDisplayName）', () => {
    expect(decide([staffAccount({ staff: { display_name: '  ', status: 'active' } })])).toEqual({
      kind: 'link',
      userId: 'u-teacher',
      staffName: '帳號名',
    });
  });
});

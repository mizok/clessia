import { describe, expect, it } from 'vitest';

import { canManageAcademyExam, canManageOrgExam, resolveExamClassIds } from './exam-scope';

describe('canManageAcademyExam', () => {
  it('管理員什麼都能動', () => {
    expect(canManageAcademyExam({ roles: ['admin'], userId: 'u1', createdBy: 'other' })).toBe(true);
  });

  // ③ 的裁決：老師可以自己建考試，自己建的就自己管
  it('老師可以動自己建的', () => {
    expect(canManageAcademyExam({ roles: ['teacher'], userId: 'u1', createdBy: 'u1' })).toBe(true);
  });

  /**
   * **別人建的只能登錄成績，不能動考試本身。**
   *
   * 一場考試可以跨班（`academy_exam_classes`），而刪除會 CASCADE 掉其他班的成績。
   * 做這件事的人必須看得到全部影響範圍，老師依定義看不到自己不任課的班。
   */
  it('老師不能動別人建的，即使那場考試有自己的班', () => {
    expect(canManageAcademyExam({ roles: ['teacher'], userId: 'u1', createdBy: 'admin-1' })).toBe(
      false,
    );
  });

  // 舊資料的 created_by 可能是 null（建立者的帳號被刪）。fail-closed：老師動不了
  it('created_by 是 null 時老師動不了', () => {
    expect(canManageAcademyExam({ roles: ['teacher'], userId: 'u1', createdBy: null })).toBe(false);
    expect(canManageAcademyExam({ roles: ['admin'], userId: 'u1', createdBy: null })).toBe(true);
  });

  it('沒有角色的一律拒絕', () => {
    expect(canManageAcademyExam({ roles: [], userId: 'u1', createdBy: 'u1' })).toBe(false);
  });
});

describe('canManageOrgExam', () => {
  /**
   * `school_exams` 沒有 `created_by`、沒有班級關聯 —— 它是**學校段考的機構層目錄**
   * （學年 × 學期 × 類型），不是某個老師辦的考試。兩個老師各自建一筆「第一次段考」
   * 只會製造重複資料。
   *
   * 成績是另一回事：段考成績照樣是老師登錄的，那走 scores 的範圍規則。
   */
  it('只有管理員能動段考目錄', () => {
    expect(canManageOrgExam(['admin'])).toBe(true);
    expect(canManageOrgExam(['teacher'])).toBe(false);
    expect(canManageOrgExam(['teacher', 'parent'])).toBe(false);
    expect(canManageOrgExam([])).toBe(false);
  });
});

describe('resolveExamClassIds', () => {
  const taught = ['c1', 'c2'];

  it('管理員給什麼就是什麼', () => {
    expect(
      resolveExamClassIds({ isAdmin: true, current: ['c9'], requested: ['c9', 'c8'], taught: [] }),
    ).toEqual({ classIds: ['c9', 'c8'] });
  });

  it('老師加自己任課的班沒問題', () => {
    expect(
      resolveExamClassIds({ isAdmin: false, current: ['c1'], requested: ['c1', 'c2'], taught }),
    ).toEqual({ classIds: ['c1', 'c2'] });
  });

  /**
   * 沒有這一條的話，「老師可以建考試」就變成「老師可以把任何班拉進自己的考試」——
   * 那是一條提權路徑，而且看起來完全像正常操作。
   */
  it('老師不能加自己沒任課的班', () => {
    expect(
      resolveExamClassIds({ isAdmin: false, current: ['c1'], requested: ['c1', 'c9'], taught }),
    ).toEqual({ error: 'CLASS_NOT_TAUGHT' });
  });

  // 管理員事後把別班加進來，老師不該能把它踢掉 —— 那會刪掉別班的成績
  it('老師不能移除自己沒任課的班', () => {
    expect(
      resolveExamClassIds({ isAdmin: false, current: ['c1', 'c9'], requested: ['c1'], taught }),
    ).toEqual({ error: 'CANNOT_REMOVE_OTHERS_CLASS' });
  });

  // 明著回錯誤而不是默默補回去 —— 默默補的話老師會以為移除成功了
  it('老師保留別班、只動自己的班是可以的', () => {
    expect(
      resolveExamClassIds({
        isAdmin: false,
        current: ['c1', 'c9'],
        requested: ['c2', 'c9'],
        taught,
      }),
    ).toEqual({ classIds: ['c2', 'c9'] });
  });

  it('新建考試（current 是空的）只能放自己任課的班', () => {
    expect(resolveExamClassIds({ isAdmin: false, current: [], requested: ['c1'], taught })).toEqual(
      {
        classIds: ['c1'],
      },
    );
    expect(resolveExamClassIds({ isAdmin: false, current: [], requested: ['c9'], taught })).toEqual(
      {
        error: 'CLASS_NOT_TAUGHT',
      },
    );
  });
});

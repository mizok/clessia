import { describe, expect, it } from 'vitest';

import { audienceFor, canSee, campusOrFilter } from './visibility';

const TEACHER = { roles: ['teacher'], campusIds: ['campus-1'] };

describe('audienceFor', () => {
  it('老師看 all_teachers', () => {
    expect(audienceFor(['teacher'])).toBe('all_teachers');
  });

  it('家長看 all_parents', () => {
    expect(audienceFor(['parent'])).toBe('all_parents');
  });

  // 管理員是發布者，不是收件人；他要看發過什麼走管理端列表
  it('只有管理員角色時沒有收件匣', () => {
    expect(audienceFor(['admin'])).toBeNull();
  });

  it('同時是管理員與老師時仍有老師收件匣', () => {
    expect(audienceFor(['admin', 'teacher'])).toBe('all_teachers');
  });
});

describe('canSee', () => {
  it('全分校公告人人看得到', () => {
    expect(canSee({ campus_id: null, audience: 'all_teachers' }, TEACHER)).toBe(true);
  });

  it('自己分校的公告看得到', () => {
    expect(canSee({ campus_id: 'campus-1', audience: 'all_teachers' }, TEACHER)).toBe(true);
  });

  // 漏掉這條的話，甲分校老師會收到乙分校的公告而且看不出哪裡不對
  it('別的分校的公告看不到', () => {
    expect(canSee({ campus_id: 'campus-9', audience: 'all_teachers' }, TEACHER)).toBe(false);
  });

  it('給家長的公告老師看不到', () => {
    expect(canSee({ campus_id: null, audience: 'all_parents' }, TEACHER)).toBe(false);
  });

  it('沒有分校歸屬的老師只看得到全分校公告', () => {
    const viewer = { roles: ['teacher'], campusIds: [] };

    expect(canSee({ campus_id: null, audience: 'all_teachers' }, viewer)).toBe(true);
    expect(canSee({ campus_id: 'campus-1', audience: 'all_teachers' }, viewer)).toBe(false);
  });

  it('沒有收件角色的人什麼都看不到', () => {
    const viewer = { roles: ['admin'], campusIds: ['campus-1'] };

    expect(canSee({ campus_id: null, audience: 'all_teachers' }, viewer)).toBe(false);
  });
});

describe('campusOrFilter', () => {
  it('沒有分校歸屬時只看得到全分校公告', () => {
    expect(campusOrFilter([])).toBe('campus_id.is.null');
  });

  it('有分校歸屬時是「全分校 ∪ 自己的分校」', () => {
    expect(campusOrFilter(['a', 'b'])).toBe('campus_id.is.null,campus_id.in.(a,b)');
  });
});

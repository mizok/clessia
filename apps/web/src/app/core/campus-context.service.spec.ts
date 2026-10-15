import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CampusContextService } from './campus-context.service';
import { ReferenceDataService } from './reference-data.service';

@Component({ selector: 'daily-page', template: '' })
class DailyPage {
  constructor() {
    TestBed.inject(CampusContextService).use();
  }
}

@Component({ selector: 'report-page', template: '' })
class ReportPage {
  constructor() {
    TestBed.inject(CampusContextService).use({ allowAll: true });
  }
}

describe('CampusContextService（#1138 H2）', () => {
  const campuses = signal<{ id: string; name: string }[]>([]);

  function setup(stored: string | null, single: string | null = null) {
    localStorage.clear();
    if (stored) localStorage.setItem('clessia.campusContext', stored);
    if (single) localStorage.setItem('clessia.campusContext.single', single);
    campuses.set([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ReferenceDataService, useValue: { campuses, loadCampuses: vi.fn() } }],
    });
    return TestBed.inject(CampusContextService);
  }

  const ab = [
    { id: 'a', name: '總校' },
    { id: 'b', name: '二校' },
  ];

  it('報表頁：沒存過＝全部分校（null）；選了會記住', () => {
    const ctx = setup(null);
    TestBed.createComponent(ReportPage);
    expect(ctx.allowAll()).toBe(true);
    expect(ctx.id()).toBeNull();
    ctx.select('a');
    expect(ctx.id()).toBe('a');
    expect(localStorage.getItem('clessia.campusContext')).toBe('a');
    ctx.select(null);
    expect(localStorage.getItem('clessia.campusContext')).toBeNull();
  });

  it('清單還沒載到先相信存著的值；載到後不在清單裡，報表當全部、日常頁套預設', () => {
    const ctx = setup('gone');
    const report = TestBed.createComponent(ReportPage);
    expect(ctx.id()).toBe('gone');
    campuses.set(ab);
    expect(ctx.id()).toBeNull();
    report.destroy();
    TestBed.createComponent(DailyPage);
    expect(ctx.id()).toBe('a');
  });

  describe('日常頁（#1607）', () => {
    it('沒存過：套自己被指派的分校（依清單順序第一間），而且不寫回 storage', () => {
      const ctx = setup(null);
      ctx.setAssigned(['b']);
      campuses.set(ab);
      TestBed.createComponent(DailyPage);
      expect(ctx.allowAll()).toBe(false);
      expect(ctx.id()).toBe('b');
      expect(ctx.name()).toBe('二校');
      expect(localStorage.getItem('clessia.campusContext')).toBeNull();
      expect(localStorage.getItem('clessia.campusContext.single')).toBeNull();
    });

    it('指派 0 間（或 /api/me 沒帶這欄）：退回清單第一間', () => {
      const ctx = setup(null);
      campuses.set(ab);
      TestBed.createComponent(DailyPage);
      expect(ctx.id()).toBe('a');
    });

    it('上次選過的單一分校優先於指派', () => {
      const ctx = setup(null, 'a');
      ctx.setAssigned(['b']);
      campuses.set(ab);
      TestBed.createComponent(DailyPage);
      expect(ctx.id()).toBe('a');
    });

    it('清單是空的（沒有任何分校可看）：沒有預設，維持 null', () => {
      const ctx = setup(null);
      TestBed.createComponent(DailyPage);
      expect(ctx.id()).toBeNull();
    });
  });

  describe('報表 ↔ 日常頁（#1607）', () => {
    it('報表選全部 → 日常頁變單一 → 回報表還是全部', () => {
      const ctx = setup('a');
      campuses.set(ab);
      const r1 = TestBed.createComponent(ReportPage);
      ctx.select(null);
      expect(ctx.id()).toBeNull();
      r1.destroy();

      const daily = TestBed.createComponent(DailyPage);
      expect(ctx.id()).toBe('a'); // 上次選過的單一分校
      daily.destroy();

      TestBed.createComponent(ReportPage);
      expect(ctx.id()).toBeNull();
    });

    it('在日常頁選 B → 回報表看到 B', () => {
      const ctx = setup(null);
      campuses.set(ab);
      const daily = TestBed.createComponent(DailyPage);
      ctx.select('b');
      daily.destroy();
      TestBed.createComponent(ReportPage);
      expect(ctx.id()).toBe('b');
    });
  });

  it('有頁面接上才 inUse；頁面銷毀就放掉', () => {
    const ctx = setup(null);
    expect(ctx.inUse()).toBe(false);
    const f = TestBed.createComponent(DailyPage);
    expect(ctx.inUse()).toBe(true);
    f.destroy();
    expect(ctx.inUse()).toBe(false);
  });
});

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CampusContextService } from './campus-context.service';
import { ReferenceDataService } from './reference-data.service';

@Component({ template: '' })
class Page {
  constructor() {
    TestBed.inject(CampusContextService).use();
  }
}

describe('CampusContextService（#1138 H2）', () => {
  const campuses = signal<{ id: string; name: string }[]>([]);

  function setup(stored: string | null) {
    localStorage.clear();
    if (stored) localStorage.setItem('clessia.campusContext', stored);
    campuses.set([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ReferenceDataService, useValue: { campuses, loadCampuses: vi.fn() } }],
    });
    return TestBed.inject(CampusContextService);
  }

  it('沒存過＝全部分校（null）；選了會記住', () => {
    const ctx = setup(null);
    expect(ctx.id()).toBeNull();
    ctx.select('a');
    expect(ctx.id()).toBe('a');
    expect(localStorage.getItem('clessia.campusContext')).toBe('a');
    ctx.select(null);
    expect(localStorage.getItem('clessia.campusContext')).toBeNull();
  });

  it('清單還沒載到先相信存著的值；載到後不在清單裡就當全部分校', () => {
    const ctx = setup('gone');
    expect(ctx.id()).toBe('gone');
    campuses.set([{ id: 'a', name: '總校' }]);
    expect(ctx.id()).toBeNull();
    ctx.select('a');
    expect(ctx.name()).toBe('總校');
  });

  it('有頁面接上才 inUse；頁面銷毀就放掉', () => {
    const ctx = setup(null);
    expect(ctx.inUse()).toBe(false);
    const f = TestBed.createComponent(Page);
    expect(ctx.inUse()).toBe(true);
    f.destroy();
    expect(ctx.inUse()).toBe(false);
  });
});

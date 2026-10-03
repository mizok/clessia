import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { CampusScopeNoteComponent } from './campus-scope-note.component';

describe('CampusScopeNoteComponent（#1138）', () => {
  beforeEach(() => {
    localStorage.removeItem('clessia.campusContext');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReferenceDataService,
          useValue: {
            campuses: signal([{ id: 'c1', name: '文山旗艦校' }]),
            loadCampuses: vi.fn(),
          },
        },
      ],
    });
  });

  function text(): string {
    const fixture = TestBed.createComponent(CampusScopeNoteComponent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent!.trim();
  }

  it('這頁有接頂欄、選了分校：說出範圍與去哪換', () => {
    const ctx = TestBed.inject(CampusContextService);
    TestBed.runInInjectionContext(() => ctx.use());
    ctx.select('c1');
    expect(text()).toBe('目前只看 文山旗艦校，換分校在頂欄。');
  });

  it('頂欄是全部分校、或這頁沒接頂欄：不出聲', () => {
    const ctx = TestBed.inject(CampusContextService);
    ctx.select('c1');
    expect(text()).toBe(''); // 沒有人 use()
    TestBed.runInInjectionContext(() => ctx.use());
    ctx.select(null);
    expect(text()).toBe('');
  });
});

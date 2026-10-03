import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService, type AcademyExam } from '@core/academy-exams.service';
import { SystemClockService } from '@core/system-clock.service';
import { OverviewComponent } from './overview.component';

describe('OverviewComponent（#991 grades G3）', () => {
  const exam = (id: string, scoreCount: number, expectedCount: number) =>
    ({ id, name: `小考 ${id}`, examDate: '2026-10-01', scoreCount, expectedCount }) as AcademyExam;
  const list = vi.fn();

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        { provide: AcademyExamsService, useValue: { list } },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-04') } },
      ],
    });
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => list.mockReset());

  it('標題用近 30 天的場數與還沒登完的場數；清單寫還差幾人', () => {
    list.mockImplementation((p?: { todo?: boolean }) =>
      of(
        p?.todo
          ? { data: [exam('a', 3, 9)], meta: { total: 1, page: 1, pageSize: 50 } }
          : { data: [], meta: { total: 7, page: 1, pageSize: 1 } },
      ),
    );
    const host = render();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-09-04' }));
    expect(host.querySelector('h1')!.textContent!.replace(/\s+/g, '')).toBe(
      '近一個月7場考試，1場還沒登錄完。',
    );
    expect(host.textContent).toContain('6人還沒登錄');
    expect(host.querySelector('a[aria-label="去登錄 小考 a"]')).not.toBeNull();
  });

  it('都登完了就說登完了；取數失敗顯示載入失敗', () => {
    list.mockReturnValue(of({ data: [], meta: { total: 0, page: 1, pageSize: 1 } }));
    expect(render().textContent).toContain('成績都登錄完了');

    TestBed.resetTestingModule();
    list.mockReturnValue(throwError(() => new Error('x')));
    expect(render().querySelector('app-load-failed')).not.toBeNull();
  });
});

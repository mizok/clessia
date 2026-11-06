import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Select } from 'primeng/select';
import { DEFAULT_STATUSES } from '../../components/session-filters/session-filters.component';
import { MobileFilterDialogComponent } from './mobile-filter-dialog.component';

describe('MobileFilterDialogComponent', () => {
  it('共用殼（#2290）：h2「篩選條件」、「套用」在底部列；✕ 關窗不帶結果', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [MobileFilterDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              campuses: [],
              courses: [],
              teachers: [],
              students: [],
              sessions: [],
              classes: [],
              selectedCampusIds: [],
              selectedCourseIds: [],
              selectedTeacherIds: [],
              selectedClassIds: [],
              selectedStudentIds: [],
              selectedStatuses: [...DEFAULT_STATUSES],
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(MobileFilterDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h2')?.textContent?.trim()).toBe('篩選條件');
    const foot = [...el.querySelectorAll('.form-dialog__footer button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(foot).toContain('套用');
    el.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click();
    expect(close).toHaveBeenCalledWith();
  });

  // #1607：日常頁沒有「全部分校」—— 分校欄能清空，就等於能把頂欄改回全部
  it('分校欄沒有清除鈕', () => {
    TestBed.configureTestingModule({
      imports: [MobileFilterDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              campuses: [
                { id: 'a', name: '總校' },
                { id: 'b', name: '二校' },
              ],
              courses: [],
              teachers: [],
              students: [],
              sessions: [],
              classes: [],
              selectedCampusIds: ['a'],
              selectedCourseIds: [],
              selectedTeacherIds: [],
              selectedClassIds: [],
              selectedStudentIds: [],
              selectedStatuses: [...DEFAULT_STATUSES],
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MobileFilterDialogComponent);
    fixture.detectChanges();

    const campus = fixture.debugElement
      .queryAll(By.directive(Select))
      .map((d) => d.componentInstance as Select)
      .find((s) => s.optionLabel === 'name' && s.filterBy === 'name');
    expect(campus).toBeDefined();
    expect(campus!.showClear).toBeFalsy();
  });
});

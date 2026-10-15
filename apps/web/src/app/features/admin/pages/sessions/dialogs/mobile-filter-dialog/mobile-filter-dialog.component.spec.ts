import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Select } from 'primeng/select';
import { DEFAULT_STATUSES } from '../../components/session-filters/session-filters.component';
import { MobileFilterDialogComponent } from './mobile-filter-dialog.component';

describe('MobileFilterDialogComponent', () => {
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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import {
  StudentViewFilterDialogComponent,
  type StudentViewFilterDialogData,
} from './student-view-filter-dialog.component';

describe('StudentViewFilterDialogComponent', () => {
  let fixture: ComponentFixture<StudentViewFilterDialogComponent>;
  let component: StudentViewFilterDialogComponent;

  const closeMock = vi.fn();
  const onChangeMock = vi.fn();
  const onClearMock = vi.fn();

  const data: StudentViewFilterDialogData = {
    initial: {
      campusId: 'campus-1',
      searchText: '王',
      grade: 'J2',
      schoolId: 'school-1',
      status: 'active',
    },
    options: {
      campusOptions: [{ label: '示範分校', value: 'campus-1' }],
      gradeOptions: [{ label: '國二', value: 'J2' }],
      schoolOptions: [{ label: '示範國中', value: 'school-1' }],
      statusOptions: [
        { label: '在籍', value: 'active' },
        { label: '全部', value: 'all' },
      ],
    },
    onChange: onChangeMock,
    onClear: onClearMock,
  };

  beforeEach(async () => {
    closeMock.mockReset();
    onChangeMock.mockReset();
    onClearMock.mockReset();

    await TestBed.configureTestingModule({
      imports: [StudentViewFilterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentViewFilterDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('以傳入的 initial 作為初始值', () => {
    expect(component['campusId']()).toBe('campus-1');
    expect(component['searchText']()).toBe('王');
    expect(component['grade']()).toBe('J2');
    expect(component['schoolId']()).toBe('school-1');
    expect(component['status']()).toBe('active');
  });

  // 這個 dialog 走即時回報（onChange），不是 apply 才送出 —— 跟 class-view-filter-dialog
  // 的模式不同，改動任何一個欄位都要立刻通知呼叫端。
  it('改變任一欄位都立即回報完整 snapshot', () => {
    component['onSearchChange']('李');

    expect(onChangeMock).toHaveBeenCalledWith({
      campusId: 'campus-1',
      searchText: '李',
      grade: 'J2',
      schoolId: 'school-1',
      status: 'active',
    });
  });

  it('null 值被正規化成空字串或預設值，不會外洩 null', () => {
    component['onCampusChange'](null);
    component['onGradeChange'](null);
    component['onStatusChange'](null);

    const last = onChangeMock.mock.calls.at(-1)?.[0];
    expect(last.campusId).toBe('');
    expect(last.grade).toBe('');
    expect(last.status).toBe('active');
  });

  it('schoolId 允許 null（代表未指定學校），不做正規化', () => {
    component['onSchoolChange'](null);

    expect(onChangeMock.mock.calls.at(-1)?.[0].schoolId).toBeNull();
  });

  it('clear 重設所有欄位、呼叫 onClear，並回報重設後的 snapshot', () => {
    component['clear']();

    expect(onClearMock).toHaveBeenCalledTimes(1);
    expect(onChangeMock).toHaveBeenCalledWith({
      campusId: '',
      searchText: '',
      grade: '',
      schoolId: null,
      status: 'active',
    });
    // clear 不關閉 dialog —— 使用者可以繼續調整
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('close 關閉 dialog 且不回報變更', () => {
    component['close']();

    expect(closeMock).toHaveBeenCalledWith();
    expect(onChangeMock).not.toHaveBeenCalled();
  });
});

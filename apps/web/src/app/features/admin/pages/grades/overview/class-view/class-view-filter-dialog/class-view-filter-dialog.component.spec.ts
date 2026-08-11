import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import {
  ClassViewFilterDialogComponent,
  type ClassViewFilterDialogData,
} from './class-view-filter-dialog.component';

describe('ClassViewFilterDialogComponent', () => {
  let fixture: ComponentFixture<ClassViewFilterDialogComponent>;
  let component: ClassViewFilterDialogComponent;

  const closeMock = vi.fn();

  const data: ClassViewFilterDialogData = {
    initial: {
      campusId: 'campus-1',
      search: '數學',
      selectedGrades: ['J2'],
      subjectId: 'subject-1',
    },
    options: {
      campusOptions: [{ label: '示範分校', value: 'campus-1' }],
      gradeOptions: [{ label: '國二', value: 'J2' }],
      subjectOptions: [{ label: '數學', value: 'subject-1' }],
    },
  };

  async function setup(dialogData: ClassViewFilterDialogData = data) {
    closeMock.mockReset();
    await TestBed.configureTestingModule({
      imports: [ClassViewFilterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: { data: dialogData } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassViewFilterDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('以傳入的 initial 作為初始值', async () => {
    await setup();

    expect(component['campusId']()).toBe('campus-1');
    expect(component['search']()).toBe('數學');
    expect(component['selectedGrades']()).toEqual(['J2']);
    expect(component['subjectId']()).toBe('subject-1');
  });

  it('apply 回傳當下的 snapshot', async () => {
    await setup();
    component['search'].set('英文');
    component['selectedGrades'].set(['J1', 'J3']);

    component['apply']();

    expect(closeMock).toHaveBeenCalledWith({
      snapshot: {
        campusId: 'campus-1',
        search: '英文',
        selectedGrades: ['J1', 'J3'],
        subjectId: 'subject-1',
      },
    });
  });

  it('clear 回傳 cleared 旗標，而不是空的 snapshot —— 呼叫端要能區分「清空」與「套用空值」', async () => {
    await setup();

    component['clear']();

    expect(closeMock).toHaveBeenCalledWith({ cleared: true });
  });

  it('close 不帶任何結果，代表取消', async () => {
    await setup();

    component['close']();

    expect(closeMock).toHaveBeenCalledWith();
  });

  it('config 沒帶 data 時用安全預設值，不應拋錯', async () => {
    closeMock.mockReset();
    await TestBed.configureTestingModule({
      imports: [ClassViewFilterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: {} },
      ],
    }).compileComponents();

    const bare = TestBed.createComponent(ClassViewFilterDialogComponent);
    expect(() => bare.detectChanges()).not.toThrow();
    expect(bare.componentInstance['campusId']()).toBe('');
    expect(bare.componentInstance['selectedGrades']()).toEqual([]);
  });
});

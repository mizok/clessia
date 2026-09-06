import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { StudentsService, type Student } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { StudentsPage } from './students.page';

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 's1',
    orgId: 'org-1',
    name: '陳大同',
    grade: 'J2',
    school: null,
    birthday: null,
    gender: null,
    phone: null,
    email: null,
    address: null,
    emergencyContactName: null,
    campusNames: [],
    classNames: ['數學班 A'],
    ...overrides,
  } as Student;
}

describe('StudentsPage（老師端）', () => {
  let fixture: ComponentFixture<StudentsPage>;
  let component: StudentsPage;
  const listMock = vi.fn();

  async function setup(data: Student[] = [student()]) {
    listMock.mockReset();
    listMock.mockReturnValue(of({ data, meta: { total: data.length, page: 1, pageSize: 100 } }));

    await TestBed.configureTestingModule({
      imports: [StudentsPage],
      providers: [{ provide: StudentsService, useValue: { list: listMock } }],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_STUDENTS);
    fixture.detectChanges();
  }

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    listMock.mockReset();
    listMock.mockReturnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [StudentsPage],
      providers: [{ provide: StudentsService, useValue: { list: listMock } }],
    }).compileComponents();

    const f = TestBed.createComponent(StudentsPage);
    f.componentRef.setInput('page', RoutesCatalog.TEACHER_STUDENTS);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  it('查詢時表明只要自己任課的學生', async () => {
    await setup();

    expect(listMock.mock.calls[0][0]).toMatchObject({ taughtByMe: true });
  });

  it('依班級分組', async () => {
    await setup([
      student({ id: 'a', name: '甲', classNames: ['數學班 A'] }),
      student({ id: 'b', name: '乙', classNames: ['英文班 B'] }),
    ]);

    // 只斷言分組正確，不釘死順序 —— 中文 collation 依 Node/ICU 版本而異，
    // 把它寫進期望值會做出跨環境不穩的測試
    expect(new Set(component['groups']().map((g) => g.className))).toEqual(
      new Set(['數學班 A', '英文班 B']),
    );
  });

  // 一個學生可能同時在兩個班，兩組都要看得到他
  it('跨班的學生在每一組都出現', async () => {
    await setup([student({ classNames: ['數學班 A', '英文班 B'] })]);

    const groups = component['groups']();
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.students.length === 1)).toBe(true);
  });

  // 沒有班級的學生不該憑空消失
  it('沒有班級的學生歸到未分班', async () => {
    await setup([student({ classNames: [] })]);

    expect(component['groups']()[0].className).toBe('未分班');
  });

  it('姓名搜尋會過濾', async () => {
    await setup([student({ id: 'a', name: '王小明' }), student({ id: 'b', name: '李大華' })]);

    component['search'].set('王');

    expect(component['groups']()[0].students.map((s) => s.name)).toEqual(['王小明']);
  });

  it('班級篩選只留該班', async () => {
    await setup([
      student({ id: 'a', name: '甲', classNames: ['數學班 A'] }),
      student({ id: 'b', name: '乙', classNames: ['英文班 B'] }),
    ]);

    component['classFilter'].set('英文班 B');

    expect(component['groups']()).toHaveLength(1);
    expect(component['groups']()[0].students[0].name).toBe('乙');
  });

  it('沒有任課學生時顯示空狀態', async () => {
    await setup([]);

    expect(fixture.nativeElement.textContent).toContain('目前沒有任課班級的學生');
  });

  it('查詢失敗顯示錯誤而不是空白', async () => {
    listMock.mockReset();
    listMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [StudentsPage],
      providers: [{ provide: StudentsService, useValue: { list: listMock } }],
    }).compileComponents();

    const f = TestBed.createComponent(StudentsPage);
    f.componentRef.setInput('page', RoutesCatalog.TEACHER_STUDENTS);
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
  });
});

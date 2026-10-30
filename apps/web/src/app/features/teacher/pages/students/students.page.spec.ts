import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, vi } from 'vitest';

import { StudentsService, type Student } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { StudentsPage } from './students.page';

/** `classes` 預設從 `classNames` 帶出來，班 id＝班名（測試裡班名不重複） */
function student(overrides: Partial<Student> = {}): Student {
  const classNames = overrides.classNames ?? ['數學班 A'];
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
    classNames,
    classes: classNames.map((name) => ({ id: name, name })),
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
    expect(f.nativeElement.querySelectorAll('.skeleton-list .skeleton').length).toBeGreaterThan(0);
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

  it('篩光時有「清除篩選」，按下後搜尋與班級篩選都歸零、名單回來（#1314 TST2）', async () => {
    await setup([
      student({ id: 'a', name: '甲', classNames: ['數學班 A'] }),
      student({ id: 'b', name: '乙', classNames: ['英文班 B'] }),
    ]);

    component['search'].set('不存在的名字');
    component['classFilter'].set('英文班 B');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('沒有符合條件的學生');
    const clear = fixture.nativeElement.querySelector('.clear-filters') as HTMLButtonElement;
    expect(clear.textContent?.trim()).toBe('清除篩選');

    clear.click();
    fixture.detectChanges();

    expect(component['search']()).toBe('');
    expect(component['classFilter']()).toBeNull();
    expect(fixture.nativeElement.querySelector('.clear-filters')).toBeNull();
    expect(
      component['groups']()
        .flatMap((g: { students: Student[] }) => g.students.map((x) => x.name))
        .sort(),
    ).toEqual(['乙', '甲']);
  });

  it('有符合的學生時不出現「清除篩選」', async () => {
    await setup([student({ id: 'a', name: '甲' })]);

    expect(fixture.nativeElement.querySelector('.clear-filters')).toBeNull();
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

  /**
   * #1314 老師端學生對齊 A6：色面數字句、分頁拿到底、「找到 N 位」。
   * 分頁門檻：API 單頁上限 100 → 剛好 100 筆只打一次、101 筆要打第二頁（靜默截斷的邊界）。
   */
  describe('色面數字句與分頁（#1314）', () => {
    const many = (n: number, classNames = ['數學班 A']) =>
      Array.from({ length: n }, (_, i) => student({ id: `s${i}`, name: `學生${i}`, classNames }));

    /** 依 `page` 參數切片的替身，meta.total 是全部筆數 */
    async function setupPaged(all: Student[], failPage?: number) {
      listMock.mockReset();
      listMock.mockImplementation((params: { page?: number; pageSize?: number }) => {
        const page = params.page ?? 1;
        const size = params.pageSize ?? 20;
        if (page === failPage) return throwError(() => new Error('boom'));
        return of({
          data: all.slice((page - 1) * size, page * size),
          meta: {
            total: all.length,
            page,
            pageSize: size,
            totalPages: Math.ceil(all.length / size),
          },
        });
      });
      await TestBed.configureTestingModule({
        imports: [StudentsPage],
        providers: [{ provide: StudentsService, useValue: { list: listMock } }],
      }).compileComponents();
      fixture = TestBed.createComponent(StudentsPage);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_STUDENTS);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }
    const title = () =>
      fixture.nativeElement.querySelector('app-page-open h1').textContent as string;

    it('剛好 100 筆：只打一次 API、數字句 100 位', async () => {
      await setupPaged(many(100));
      expect(listMock).toHaveBeenCalledTimes(1);
      expect(title()).toContain('共 100 位學生');
    });

    it('101 筆：打第二頁、101 位都在、數字句 101 位（不被截成 100）', async () => {
      await setupPaged(many(101));
      expect(listMock).toHaveBeenCalledTimes(2);
      expect(listMock.mock.calls.map((c) => c[0].page)).toEqual([1, 2]);
      expect(component['students']()).toHaveLength(101);
      expect(title()).toContain('共 101 位學生');
    });

    it('201 筆：三頁（頁數是 ceil(total/100)，不是 +1）', async () => {
      await setupPaged(many(201));
      expect(listMock).toHaveBeenCalledTimes(3);
      expect(title()).toContain('共 201 位學生');
    });

    it('第二頁失敗：整體失敗，不拿半份名單配完整數字', async () => {
      await setupPaged(many(101), 2);
      expect(component['loadError']()).toBe(true);
      expect(component['students']()).toHaveLength(0);
      expect(title().trim()).toBe('學生');
    });

    it('翻頁途中同一人落在相鄰兩頁：去重', async () => {
      const all = many(101);
      listMock.mockReset();
      listMock.mockImplementation((params: { page?: number }) =>
        of({
          data: params.page === 2 ? [all[99], all[100]] : all.slice(0, 100),
          meta: { total: 101, page: params.page ?? 1, pageSize: 100, totalPages: 2 },
        }),
      );
      await TestBed.configureTestingModule({
        imports: [StudentsPage],
        providers: [{ provide: StudentsService, useValue: { list: listMock } }],
      }).compileComponents();
      fixture = TestBed.createComponent(StudentsPage);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_STUDENTS);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component['students']()).toHaveLength(101);
    });

    it('數字句：N 個班不含「未分班」，共 N 位是不重複學生（跨班只算一次）', async () => {
      await setup([
        student({ id: 'a', classNames: ['數學班 A', '英文班 B'] }),
        student({ id: 'b', classNames: ['數學班 A'] }),
        student({ id: 'c', classNames: [] }),
      ]);
      fixture.detectChanges();
      const t = fixture.nativeElement.querySelector('app-page-open h1').textContent;
      expect(t).toContain('2 個班');
      expect(t).toContain('共 3 位學生');
      expect(fixture.nativeElement.querySelectorAll('app-page-open h1 br').length).toBe(1);
    });

    it('數字句不隨搜尋／班級篩選變（它是任課總數）', async () => {
      await setup([
        student({ id: 'a', name: '王小明', classNames: ['數學班 A'] }),
        student({ id: 'b', name: '李大華', classNames: ['英文班 B'] }),
      ]);
      component['search'].set('王');
      component['classFilter'].set('數學班 A');
      fixture.detectChanges();
      const t = fixture.nativeElement.querySelector('app-page-open h1').textContent;
      expect(t).toContain('2 個班');
      expect(t).toContain('共 2 位學生');
    });

    it('載入中／失敗／沒有學生：色面退回頁名，不印數字句', async () => {
      await setup([]);
      expect(title().trim()).toBe('學生');
      expect(fixture.nativeElement.querySelectorAll('app-page-open h1 br').length).toBe(0);
    });

    it('「找到 N 位」：沒篩選不出現；篩選時數不重複學生，清除後消失', async () => {
      await setup([
        student({ id: 'a', name: '王小明', classNames: ['數學班 A', '英文班 B'] }),
        student({ id: 'b', name: '王大明', classNames: ['數學班 A'] }),
        student({ id: 'c', name: '李大華', classNames: ['英文班 B'] }),
      ]);
      expect(fixture.nativeElement.querySelector('.clear-filters')).toBeNull();

      component['search'].set('王');
      fixture.detectChanges();
      // 王小明在兩組、王大明在一組：組內加總 3，不重複 2
      expect(
        component['groups']().flatMap((g: { students: Student[] }) => g.students),
      ).toHaveLength(3);
      expect(fixture.nativeElement.textContent).toContain('找到 2 位');

      (fixture.nativeElement.querySelector('.clear-filters') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('找到');
    });

    it('章頭：班名＋人數；桌機 4 欄網格與手機單欄列的 class 都在', async () => {
      await setup([student({ id: 'a', classNames: ['數學班 A'] })]);
      const section = fixture.nativeElement.querySelector('section[aria-label="數學班 A"]');
      expect(section.querySelector('h2').textContent.trim()).toBe('數學班 A');
      expect(section.textContent).toContain('1');
      const ul = section.querySelector('ul') as HTMLElement;
      expect(ul.className).toContain('grid-cols-1');
      expect(ul.className).toContain('wide:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]');
      // 整列是按鈕（A6 `.who--btn`），版面 class 在按鈕上
      const row = section.querySelector('li > button') as HTMLElement;
      expect(row.className).toContain('flex');
      expect(row.className).toContain('wide:block');
      expect(row.textContent).toContain('國二');
    });
  });

  describe('學生面板（TST1）', () => {
    it('沒篩選時有說明句；篩選時換成「找到 N 位」', async () => {
      await setup();
      expect(fixture.nativeElement.textContent).toContain('點名字看家長電話、最近到班與成績');
      component['search'].set('陳');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('點名字看家長電話');
    });

    it('同名的兩個班分成兩章（依班 id 分組，不靠名字）', async () => {
      await setup([
        student({ id: 'a', classes: [{ id: 'k1', name: '數學班' }] }),
        student({ id: 'b', classes: [{ id: 'k2', name: '數學班' }] }),
      ]);
      expect(component['groups']().map((g) => g.classId).sort()).toEqual(['k1', 'k2']);
    });

    it('點名字：開 dialog，帶這位學生與點進來的那一班', async () => {
      const showModal = vi.fn();
      HTMLDialogElement.prototype.showModal = showModal;
      await setup([student({ id: 'a', classes: [{ id: 'k1', name: '數學班 A' }] })]);

      (fixture.nativeElement.querySelector('li > button') as HTMLButtonElement).click();
      await Promise.resolve();
      expect(component['panel']()).toMatchObject({
        student: { id: 'a' },
        classId: 'k1',
        className: '數學班 A',
      });
      expect(showModal).toHaveBeenCalled();
    });

    it('未分班的學生不是按鈕（沒有「這班」可看）', async () => {
      await setup([student({ classNames: [], classes: [] })]);
      expect(fixture.nativeElement.querySelector('li > button')).toBeNull();
    });
  });

  // #1983：「找到 N 位」是資料算出來、會隨篩選變的字，換字走 appTextSwap
  describe('「找到 N 位」換字（#1983）', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    });

    async function setupSwap(reduce = false) {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
      const animated: HTMLElement[] = [];
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
        this: HTMLElement,
      ) {
        animated.push(this);
        return { cancel: vi.fn(), finished: new Promise(() => undefined) };
      };
      await setup([
        student({ id: 'a', name: '王小明' }),
        student({ id: 'b', name: '王大明' }),
        student({ id: 'c', name: '李大華' }),
      ]);
      const search = async (q: string) => {
        component['search'].set(q);
        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve(); // MutationObserver 回呼
        await Promise.resolve(); // 合成一次換字的 microtask
      };
      await search('王'); // 找到 2 位：宿主第一次出現，只記不播
      const host = () => fixture.nativeElement.querySelector('span[apptextswap]') as HTMLElement;
      return { animated, search, host };
    }

    it('值變了會播', async () => {
      const { animated, search, host } = await setupSwap();
      expect(animated).toHaveLength(0);
      await search('王小');
      expect(host().textContent).toContain('找到 1 位');
      expect(animated).toContain(host());
    });

    it('值沒變不播', async () => {
      const { animated, search } = await setupSwap();
      await search('明'); // 還是 2 位
      expect(animated).toHaveLength(0);
    });

    it('減少動態不播', async () => {
      const { animated, search } = await setupSwap(true);
      await search('王小');
      expect(animated).toHaveLength(0);
    });
  });
});

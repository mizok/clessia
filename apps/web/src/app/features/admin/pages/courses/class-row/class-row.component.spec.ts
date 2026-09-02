import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { Class } from '@core/classes.service';

import { ClassRowComponent } from './class-row.component';

function makeClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 'c1',
    name: '國二數學 A',
    isActive: true,
    usesContactBook: false,
    schedules: [],
    ...overrides,
  } as Class;
}

describe('ClassRowComponent', () => {
  let fixture: ComponentFixture<ClassRowComponent>;

  async function setup(cls: Class = makeClass(), inputs: Record<string, unknown> = {}) {
    await TestBed.configureTestingModule({ imports: [ClassRowComponent] }).compileComponents();
    fixture = TestBed.createComponent(ClassRowComponent);
    fixture.componentRef.setInput('cls', cls);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('顯示班級名稱', async () => {
    await setup(makeClass({ name: '國三英文 B' }));

    expect(fixture.nativeElement.textContent).toContain('國三英文 B');
  });

  it('沒有時間表時顯示提示', async () => {
    await setup(makeClass({ schedules: [] }));

    expect(fixture.nativeElement.textContent).toContain('尚無時間表');
  });

  it('有時間表時顯示傳入的摘要', async () => {
    await setup(makeClass({ schedules: [{ id: 's1' }] as Class['schedules'] }), {
      scheduleSummary: '週三 19:00–21:00',
    });

    expect(fixture.nativeElement.textContent).toContain('週三 19:00–21:00');
  });

  // 歷史班級不該出現操作選單 —— 這是原本頁面上的行為，抽出來後要保住
  it('歷史班級不顯示操作按鈕', async () => {
    await setup(makeClass(), { historical: true });

    expect(fixture.nativeElement.querySelector('p-button')).toBeNull();
  });

  it('非歷史班級顯示操作按鈕', async () => {
    await setup(makeClass(), { historical: false });

    expect(fixture.nativeElement.querySelector('p-button')).not.toBeNull();
  });

  it('選取狀態反映在 checkbox 上', async () => {
    await setup(makeClass(), { selected: true });

    expect(fixture.nativeElement.querySelector('input[type=checkbox]').checked).toBe(true);
  });

  // 輸出刻意不帶脈絡：導去哪是頁面決定的，這一列只說「有人點了」
  it('點導覽時發出不帶酬載的事件', async () => {
    await setup();
    const spy = vi.fn();
    fixture.componentInstance.navigate.subscribe(spy);

    fixture.nativeElement.querySelector('.class-row__nav-btn')?.click();

    expect(spy).toHaveBeenCalled();
  });

  // 名稱看起來就像連結（hover 變色、旁邊一個 ›），點下去卻是勾選 —— 期待與行為不一致
  describe('班級名稱點擊', () => {
    it('點名稱進詳情', async () => {
      await setup();
      const spy = vi.fn();
      fixture.componentInstance.navigate.subscribe(spy);

      fixture.nativeElement.querySelector('.class-row__name').click();

      expect(spy).toHaveBeenCalled();
    });

    it('點名稱不會順便把班級勾起來', async () => {
      await setup();
      const spy = vi.fn();
      fixture.componentInstance.toggleSelection.subscribe(spy);

      fixture.nativeElement.querySelector('.class-row__name').click();

      expect(spy).not.toHaveBeenCalled();
    });

    // 批次選取仍然靠整列 —— 這次只把名稱讓出去，不是把整列的點擊拿掉
    it('點名稱以外的地方仍然是勾選', async () => {
      await setup();
      const spy = vi.fn();
      fixture.componentInstance.toggleSelection.subscribe(spy);

      fixture.nativeElement.querySelector('.class-row__schedules').click();

      expect(spy).toHaveBeenCalled();
    });
  });

  // 提示要連到修法。同一列的「N 堂未指派」早就是可點的，這顆是唯一的死路
  describe('無未來排程的入口', () => {
    const noUpcoming = makeClass({
      isActive: true,
      scheduleCount: 2,
      hasUpcomingSessions: false,
      upcomingCancelledCount: 0,
    });

    it('點了就發出產生課堂的請求', async () => {
      await setup(noUpcoming);
      const spy = vi.fn();
      fixture.componentInstance.generateSessions.subscribe(spy);

      fixture.nativeElement.querySelector('.class-row__completeness-info--action').click();

      expect(spy).toHaveBeenCalled();
    });

    it('點它不會順便把班級勾起來', async () => {
      await setup(noUpcoming);
      const spy = vi.fn();
      fixture.componentInstance.toggleSelection.subscribe(spy);

      fixture.nativeElement.querySelector('.class-row__completeness-info--action').click();

      expect(spy).not.toHaveBeenCalled();
    });

    // 沒有時間表就沒東西可產生 —— 那顆是「無時段」，修法在編輯班級不在這裡
    it('無時段的班不給產生課堂的入口', async () => {
      await setup(makeClass({ isActive: true, scheduleCount: 0 }));

      expect(
        fixture.nativeElement.querySelector('.class-row__completeness-info--action'),
      ).toBeNull();
    });

    // 課堂是有的，只是都停課了 —— 再產生一次不會讓它們復原
    it('未來皆停課維持不可點', async () => {
      await setup(
        makeClass({
          isActive: true,
          scheduleCount: 2,
          hasUpcomingSessions: false,
          upcomingCancelledCount: 3,
        }),
      );

      expect(fixture.nativeElement.textContent).toContain('未來皆停課');
      expect(
        fixture.nativeElement.querySelector('.class-row__completeness-info--action'),
      ).toBeNull();
    });
  });
});

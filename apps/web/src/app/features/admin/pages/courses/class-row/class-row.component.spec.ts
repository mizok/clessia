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
});

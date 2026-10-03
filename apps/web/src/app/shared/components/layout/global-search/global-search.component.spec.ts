import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StudentsService, type Student } from '@core/students.service';
import { GlobalSearchComponent, formatPhone, toSearchTerm } from './global-search.component';

describe('toSearchTerm / formatPhone', () => {
  it('電話樣子的輸入收成純數字；名字照原樣（去頭尾空白）', () => {
    expect(toSearchTerm(' 0912-345 678 ')).toBe('0912345678');
    expect(toSearchTerm(' 王小明 ')).toBe('王小明');
    expect(toSearchTerm('王5678')).toBe('王5678');
  });

  it('手機號碼排成 4-3-3，其他照原樣', () => {
    expect(formatPhone('0912345678')).toBe('0912-345-678');
    expect(formatPhone('02-2345-6789')).toBe('02-2345-6789');
  });
});

describe('GlobalSearchComponent', () => {
  let fixture: ComponentFixture<GlobalSearchComponent>;
  let el: HTMLElement;
  const list = vi.fn();
  const student = (id: string, name: string, extra: Partial<Student> = {}) =>
    ({
      id,
      name,
      isActive: true,
      parentNames: ['王媽'],
      primaryParentPhone: '0912345678',
      ...extra,
    }) as Student;

  beforeEach(() => {
    vi.useFakeTimers();
    list
      .mockReset()
      .mockReturnValue(of({ data: [student('s1', '王小明'), student('s2', '王大明')] }));
    TestBed.configureTestingModule({
      imports: [GlobalSearchComponent],
      providers: [provideRouter([]), { provide: StudentsService, useValue: { list } }],
    });
    fixture = TestBed.createComponent(GlobalSearchComponent);
    el = fixture.nativeElement;
    // jsdom 沒有 popover API
    const panel = el.querySelector<HTMLElement>('[popover]')!;
    // （瀏覽器開關時會發 toggle，元件靠它知道面板開著）
    const toggle = (newState: string) => () =>
      panel.dispatchEvent(Object.assign(new Event('toggle'), { newState }));
    panel.showPopover = vi.fn(toggle('open'));
    panel.hidePopover = vi.fn(toggle('closed'));
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  const head = () => el.querySelector<HTMLInputElement>('input[aria-label="全站搜尋"]')!;
  function type(value: string) {
    head().value = value;
    head().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
  }
  const key = (k: string) => {
    head().dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    fixture.detectChanges();
  };

  it('空白時提示怎麼搜，不打 API', () => {
    expect(el.textContent).toContain('打學生名字，或家長電話的後四碼');
    expect(list).not.toHaveBeenCalled();
  });

  it('停手 250ms 才查一次（最多 6 筆）；電話去掉 - 再送', () => {
    // signal → observable 要經過一次變更偵測（真的瀏覽器裡每個事件後都會有）
    head().value = '0912';
    head().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    vi.advanceTimersByTime(100);
    head().value = '0912-345';
    head().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    vi.advanceTimersByTime(250);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ search: '0912345', page: 1, pageSize: 6 });
  });

  it('結果：學生名＋主要家長與電話', () => {
    type('王');
    const opts = el.querySelectorAll('[role="option"]');
    expect(opts).toHaveLength(2);
    expect(opts[0].textContent).toContain('王小明');
    expect(opts[0].textContent).toContain('王媽 0912-345-678');
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
  });

  it('↓ 移到下一筆、Enter 開那位的學生檔案並清空', () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    type('王');
    key('ArrowDown');
    expect(head().getAttribute('aria-activedescendant')).toBe('global-search-opt-1');
    key('Enter');
    expect(nav).toHaveBeenCalledWith(['/admin/students', 's2']);
    expect(head().value).toBe('');
  });

  it('沒有結果與連線失敗各有自己的說法', () => {
    list.mockReturnValueOnce(of({ data: [] }));
    type('趙');
    expect(el.textContent).toContain('找不到「趙」');
    list.mockReturnValueOnce(throwError(() => new Error('x')));
    type('錢');
    expect(el.textContent).toContain('可能是連線問題');
  });
});

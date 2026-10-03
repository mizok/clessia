import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { StudentsService, type Student } from '@core/students.service';

/** 結果最多幾筆（A6 `search()`） */
const LIMIT = 6;

/** 電話樣子的輸入（`0912-345 678`）收成純數字 —— 後端只對 3 碼以上純數字比家長電話 */
export function toSearchTerm(raw: string): string {
  const q = raw.trim();
  const digits = q.replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) ? digits : q;
}

/** `0912345678` → `0912-345-678`；其他格式照原樣 */
export function formatPhone(phone: string): string {
  return /^09\d{8}$/.test(phone)
    ? `${phone.slice(0, 4)}-${phone.slice(4, 7)}-${phone.slice(7)}`
    : phone;
}

/**
 * 頂欄全站搜尋（A6 `search()`，#1138 H1）：打學生名字或家長電話就出結果，點了進學生檔案。
 * 桌機是頂欄輸入框、結果浮在它下面；手機是放大鏡鈕，從底部升起同一個面板（面板裡自己有輸入框）。
 * 面板是原生 popover：點外面、Esc 由瀏覽器關。只有管理員看得到（殼決定掛不掛）。
 */
@Component({
  selector: 'app-global-search',
  imports: [RouterLink],
  templateUrl: './global-search.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly router = inject(Router);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly head = viewChild.required<ElementRef<HTMLInputElement>>('head');
  private readonly own = viewChild.required<ElementRef<HTMLInputElement>>('own');

  protected readonly query = signal('');
  /** `null`＝還沒有結果（空白或第一次查詢還沒回來） */
  protected readonly results = signal<readonly Student[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly active = signal(0);
  protected readonly open = signal(false);
  /** 桌機：面板貼在頂欄輸入框下面（popover 在 top layer，要自己算位置） */
  protected readonly pos = signal<{ left: number; top: number; width: number } | null>(null);
  protected readonly activeId = computed(() =>
    this.open() && this.results()?.length ? `global-search-opt-${this.active()}` : null,
  );
  protected readonly formatPhone = formatPhone;

  constructor() {
    toObservable(this.query)
      .pipe(
        map(toSearchTerm),
        debounceTime(250),
        distinctUntilChanged(),
        tap(() => this.failed.set(false)),
        // switchMap：打下一個字就丟掉上一支還沒回來的
        switchMap((search) =>
          search
            ? this.studentsService.list({ search, page: 1, pageSize: LIMIT }).pipe(
                map((res) => res.data),
                catchError(() => {
                  this.failed.set(true);
                  return of([]);
                }),
              )
            : of(null),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.results.set(list);
        this.active.set(0);
      });
  }

  /** 桌機輸入框：打字就打開面板，焦點留在輸入框 */
  protected onHeadInput(value: string): void {
    this.query.set(value);
    if (!this.open()) this.show(true);
  }

  /** 手機放大鏡：清空、升起面板、焦點進面板裡的輸入框 */
  protected openSheet(): void {
    this.query.set('');
    this.own().nativeElement.value = '';
    this.show(false);
    this.own().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const n = this.results()?.length ?? 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!n) return;
      event.preventDefault();
      if (!this.open()) this.show(event.target === this.head().nativeElement);
      this.active.update((i) => (i + (event.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (event.key === 'Enter') {
      const s = this.results()?.[this.active()];
      if (!s) return;
      event.preventDefault();
      void this.router.navigate(['/admin/students', s.id]);
      this.done();
    } else if (event.key === 'Escape' && this.open()) {
      this.hide();
    }
  }

  /** 點了一筆（routerLink 負責導過去）：收起面板、清掉字 */
  protected done(): void {
    this.hide();
    this.query.set('');
    this.head().nativeElement.value = '';
    this.own().nativeElement.value = '';
  }

  protected onToggle(event: Event): void {
    this.open.set((event as ToggleEvent).newState === 'open');
  }

  private show(underHead: boolean): void {
    if (underHead) {
      // 對齊外框（label），不是裡面的 input —— 不然往右偏一個圖示寬
      const box = this.head().nativeElement.closest('label') ?? this.head().nativeElement;
      const r = box.getBoundingClientRect();
      this.pos.set({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 320) });
    } else {
      this.pos.set(null);
    }
    this.panel().nativeElement.showPopover();
  }

  private hide(): void {
    if (this.open()) this.panel().nativeElement.hidePopover();
  }
}

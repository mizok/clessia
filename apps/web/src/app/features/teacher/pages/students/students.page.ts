import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, map, mergeMap, of, type Observable } from 'rxjs';

import { GRADE_LEVEL_LABELS, StudentsService, type Student } from '@core/students.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/** 列表 API 單頁上限（`students.ts` 的 `max(100)`） */
const PAGE_SIZE = 100;

/** 沒有班級的學生不該憑空消失，給一個明確的組 */
const NO_CLASS = '未分班';

interface ClassGroup {
  readonly className: string;
  readonly students: Student[];
}

@Component({
  selector: 'app-students',
  imports: [TextSwapDirective, SkeletonComponent, SelectFieldComponent, PageOpenComponent],
  templateUrl: './students.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentsPage {
  readonly page = input.required<RouteObj>();

  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly GRADE_LABELS = GRADE_LEVEL_LABELS;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly students = signal<Student[]>([]);
  protected readonly search = signal('');
  protected readonly classFilter = signal<string | null>(null);

  /** 依班級分組。一個學生可能同時在兩個班，所以會出現在兩組裡 */
  protected readonly groups = computed<ClassGroup[]>(() => {
    const term = this.search().trim();
    const selected = this.classFilter();
    const byClass = new Map<string, Student[]>();

    for (const student of this.students()) {
      if (term && !student.name.includes(term)) continue;

      const names = student.classNames.length > 0 ? student.classNames : [NO_CLASS];
      for (const className of names) {
        if (selected && className !== selected) continue;
        byClass.set(className, [...(byClass.get(className) ?? []), student]);
      }
    }

    return [...byClass.entries()]
      .map(([className, students]) => ({ className, students }))
      .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hant'));
  });

  protected readonly classOptions = computed(() => [
    { label: '全部班級', value: null as string | null },
    ...Array.from(new Set(this.students().flatMap((s) => s.classNames)))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((name) => ({ label: name, value: name as string | null })),
  ]);

  protected readonly total = computed(() => this.students().length);

  /** 色面數字句的「N 個班」：全部任課班（不隨搜尋／篩選變），不含「未分班」那個備用組 */
  protected readonly classCount = computed(
    () => new Set(this.students().flatMap((s) => s.classNames)).size,
  );

  protected readonly filtered = computed(
    () => this.search().trim() !== '' || this.classFilter() !== null,
  );

  /** 篩選後的「找到 N 位」：數不重複的學生（跨班學生在兩組都出現，不能數組內人數加總） */
  protected readonly foundCount = computed(
    () => new Set(this.groups().flatMap((g) => g.students.map((s) => s.id))).size,
  );

  constructor() {
    this.loadAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (students) => {
          this.students.set(students);
          this.loading.set(false);
        },
        error: () => {
          this.students.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /**
   * 一頁一頁拿到底。API 單頁上限 100，老師任課學生超過就會被**靜默截斷**，而色面的
   * 「共 N 位」會把截斷當成事實。**用 `meta.total` 算頁數**，任何一頁失敗就整體失敗
   * （半份名單配上完整的數字句比錯誤畫面更糟）。這是一次性的鏈，沒有重送，不用 switchMap。
   */
  private loadAll(): Observable<Student[]> {
    // 範圍由後端依角色強制，這裡帶旗標只是表達意圖
    const fetchPage = (page: number) =>
      this.studentsService.list({ taughtByMe: true, pageSize: PAGE_SIZE, page });
    return fetchPage(1).pipe(
      mergeMap((first) => {
        const lastPage = Math.ceil(first.meta.total / PAGE_SIZE);
        if (lastPage <= 1) return of(first.data);
        const rest = Array.from({ length: lastPage - 1 }, (_, i) => fetchPage(i + 2));
        return forkJoin(rest).pipe(
          map((pages) => [first.data, ...pages.map((r) => r.data)].flat()),
        );
      }),
      // 翻頁途中資料有增減時，同一人可能落在相鄰兩頁
      map((all) => [...new Map(all.map((s) => [s.id, s])).values()]),
    );
  }

  protected gradeLabel(grade: string): string {
    return this.GRADE_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }
}

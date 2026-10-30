import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, map, mergeMap, of, type Observable } from 'rxjs';

import { GRADE_LEVEL_LABELS, StudentsService, type Student } from '@core/students.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

import { StudentPanelComponent } from './student-panel.component';

/** 列表 API 單頁上限（`students.ts` 的 `max(100)`） */
const PAGE_SIZE = 100;

/** 沒有班級的學生不該憑空消失，給一個明確的組 */
const NO_CLASS = '未分班';

interface ClassGroup {
  /** 班 id；「未分班」那組是 null */
  readonly classId: string | null;
  readonly className: string;
  readonly students: Student[];
}

/** 打開的面板：哪位學生、從哪一班點進來（面板只看「這班」） */
interface PanelTarget {
  readonly student: Student;
  readonly classId: string;
  readonly className: string;
}

@Component({
  selector: 'app-students',
  imports: [
    TextSwapDirective,
    SkeletonComponent,
    SelectFieldComponent,
    PageOpenComponent,
    StudentPanelComponent,
  ],
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
  /** 篩選的班 id（同名班分得開） */
  protected readonly classFilter = signal<string | null>(null);
  protected readonly panel = signal<PanelTarget | null>(null);
  private readonly panelDialog = viewChild<ElementRef<HTMLDialogElement>>('panelDialog');

  /** 依班級分組（以班 id 為鍵）。一個學生可能同時在兩個班，所以會出現在兩組裡 */
  protected readonly groups = computed<ClassGroup[]>(() => {
    const term = this.search().trim();
    const selected = this.classFilter();
    const byClass = new Map<string | null, ClassGroup>();

    for (const student of this.students()) {
      if (term && !student.name.includes(term)) continue;

      const classes = student.classes ?? [];
      const keys = classes.length > 0 ? classes : [{ id: null, name: NO_CLASS }];
      for (const { id, name } of keys) {
        if (selected && id !== selected) continue;
        const group = byClass.get(id) ?? { classId: id, className: name, students: [] };
        byClass.set(id, { ...group, students: [...group.students, student] });
      }
    }

    return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className, 'zh-Hant'));
  });

  protected readonly classOptions = computed(() => [
    { label: '全部班級', value: null as string | null },
    ...[...new Map(this.students().flatMap((s) => (s.classes ?? []).map((k) => [k.id, k]))).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .map((k) => ({ label: k.name, value: k.id as string | null })),
  ]);

  protected readonly total = computed(() => this.students().length);

  /** 色面數字句的「N 個班」：全部任課班（不隨搜尋／篩選變），不含「未分班」那個備用組 */
  protected readonly classCount = computed(
    () => new Set(this.students().flatMap((s) => (s.classes ?? []).map((k) => k.id))).size,
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

  /** 點名字開面板（A6 `panel()`）。「未分班」那組沒有班，不開 */
  protected openPanel(student: Student, group: ClassGroup): void {
    if (!group.classId) return;
    this.panel.set({ student, classId: group.classId, className: group.className });
    // 等 @if 把面板畫進 dialog 再 showModal（焦點才落得到裡面）
    queueMicrotask(() => this.panelDialog()?.nativeElement.showModal());
  }

  protected closePanel(): void {
    this.panelDialog()?.nativeElement.close();
  }

  /** 點背景（dialog 本身）關掉，同 A6 */
  protected onPanelBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closePanel();
  }

  protected gradeLabel(grade: string): string {
    return this.GRADE_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }
}

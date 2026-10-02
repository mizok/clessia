import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { ClassDetailPage } from './class-detail.page';
import { ClassesService } from '@core/classes.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

describe('ClassDetailPage', () => {
  let fixture: ComponentFixture<ClassDetailPage>;
  let component: ClassDetailPage;
  const seedCourseId = 'b29e3697-08da-4b50-8fc8-6834c23e954e';
  const seedClassId = '62000000-0000-0000-0000-000000000001';

  const classesServiceMock = {
    get: vi.fn(() =>
      of({
        data: {
          id: seedClassId,
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: seedCourseId,
          courseName: '英文',
          name: '英文班 B',
          maxStudents: 20,
          gradeLevels: ['J2'],
          nextClassId: null,
          isActive: true,
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
          schedules: [],
        },
      }),
    ),
  };
  const enrollmentsServiceMock = {
    // `data` 標型別 —— 不標會被推論成 `never[]`，之後餵真的 enrollment 進去編譯失敗
    list: vi.fn(() =>
      of({
        data: [] as Enrollment[],
        meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    classesServiceMock.get.mockClear();
    enrollmentsServiceMock.list.mockClear();
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as typeof ResizeObserver;

    await TestBed.configureTestingModule({
      imports: [ClassDetailPage],
      providers: [
        provideRouter([]),
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'classId' ? seedClassId : key === 'courseId' ? seedCourseId : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads class and enrollments from route params even without component input binding', () => {
    expect(component).toBeTruthy();
    expect(classesServiceMock.get).toHaveBeenCalledWith(seedClassId);
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      classId: seedClassId,
      pageSize: 100,
    });
  });

  /**
   * #998：取數失敗時畫面不能只剩麵包屑。課程列表在 #795 接上了 `app-load-failed`，這頁漏了 ——
   * toast 幾秒就消失，之後 `<main>` 裡沒有任何說明，也沒有重試。
   * 斷言**畫面主體**，不是某個 signal（同 courses.page.spec 的 #788 那條）。
   */
  it('取數失敗時渲染「載入失敗」與重試，而不是只剩麵包屑', () => {
    classesServiceMock.get.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadClass: () => void }).loadClass();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-load-failed')).not.toBeNull();
    expect(host.textContent).toContain('載入失敗');

    // 重試真的重打，而且成功後回到正常畫面
    const callsBefore = classesServiceMock.get.mock.calls.length;
    host.querySelector<HTMLButtonElement>('app-load-failed button')!.click();
    fixture.detectChanges();

    expect(classesServiceMock.get.mock.calls.length).toBe(callsBefore + 1);
    expect(host.querySelector('app-load-failed')).toBeNull();
    expect(host.querySelector('.class-detail__band-grade')).not.toBeNull();
  });

  /**
   * #999：移除學生的確認文案原本寫「此操作不留紀錄」—— 跟事實相反：刪除報名在後端會寫
   * `audit_logs`（`enrollment` / `delete`，#851 接上的）。後半句「無法復原」仍然成立。
   * 元件自己 `providers` 了 `DialogService`，所以從元件的 injector 拿，不是 TestBed 的 mock。
   */
  it('移除學生的確認文案不宣稱「不留紀錄」，並說明紀錄會保留', () => {
    const dialog = fixture.debugElement.injector.get(DialogService);
    const open = vi.spyOn(dialog, 'open').mockReturnValue(null as never);

    (component as unknown as { confirmRemove: (e: unknown) => void }).confirmRemove({
      id: 'enr-1',
      studentName: '王小明',
    });

    const message = (open.mock.calls[0][1] as { data: { message: string } }).data.message;
    expect(message).toContain('王小明');
    expect(message).toContain('無法復原');
    expect(message).toContain('操作紀錄會保留');
    expect(message).not.toContain('不留紀錄');
  });

  it('shows grade chips in the hero summary block', () => {
    // hero 併進橘帶之後 chip 改叫 __band-grade（同一個東西、同一個位置）
    const gradeChip = fixture.nativeElement.querySelector('.class-detail__band-grade');

    expect(gradeChip?.textContent).toContain('國二');
  });

  /**
   * #726：學生列是 `role="button"` 但只處理 Enter。
   *
   * 對 `role="button"` 來說 **Enter 與 Space 都是標準啟動鍵** —— 螢幕閱讀器告訴
   * 使用者「這是一顆按鈕」，而按下按鈕的慣用鍵沒有反應。
   *
   * `#725` 修掉 `student-detail` 之後，**這是全 repo 唯一一個
   * `role="button"` 而沒有 Space 的列**（`payments`、`contact-book` 都已經是
   * Enter + Space）—— 孤例比普遍缺陷更容易在下次 review 被當成「本來就是這樣」。
   */
  describe('#726 學生列的鍵盤操作', () => {
    const studentRow = () =>
      fixture.nativeElement.querySelector('.class-detail__student-item') as HTMLElement;

    async function renderWithOneStudent() {
      enrollmentsServiceMock.list.mockReturnValue(
        of({
          data: [
            {
              id: 'enrollment-1',
              studentId: 'student-9',
              studentName: '王小明',
              classId: seedClassId,
              status: 'active',
            } as unknown as Enrollment,
          ],
          meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
        }),
      );

      fixture = TestBed.createComponent(ClassDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return TestBed.inject(Router);
    }

    it('列是鍵盤觸達得到的 —— `role="button"` + `tabindex="0"`（前提確認）', async () => {
      await renderWithOneStudent();

      const row = studentRow();
      expect(row).toBeTruthy();
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
    });

    it('Enter 觸發導向（既有行為，反向對照）', async () => {
      const router = await renderWithOneStudent();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      studentRow().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );

      expect(navigate).toHaveBeenCalledWith(['/admin/students', 'student-9']);
    });

    it('Space 也要觸發導向 —— `role="button"` 的標準啟動鍵有兩個', async () => {
      const router = await renderWithOneStudent();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      studentRow().dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );

      expect(navigate).toHaveBeenCalledWith(['/admin/students', 'student-9']);
    });
  });
});

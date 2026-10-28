import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ScoreEntryComponent } from './score-entry.component';
import { environment } from '@env/environment';
import { ReferenceDataService } from '@core/reference-data.service';

describe('ScoreEntryComponent', () => {
  let component: ScoreEntryComponent;
  let fixture: ComponentFixture<ScoreEntryComponent>;
  let http: HttpTestingController;

  const mockAcademyDetail = {
    id: 'a1',
    name: '數學小考',
    examType: 'quiz',
    status: 'active',
    examDate: '2026-04-01',
    totalScore: 100,
    scopeNote: '第一章',
    campusId: 'c1',
    subjectId: 's1',
    subjectName: '數學',
    classes: [
      { classId: 'cls-1', className: '數學A班' },
      { classId: 'cls-2', className: '數學B班' },
    ],
    summary: {
      averageScore: 72.3,
      highestScore: 98,
      lowestScore: 35,
      absentCount: 2,
      recordedCount: 28,
    },
    createdBy: null,
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const mockScores = [
    {
      studentId: 'stu-1',
      studentName: '王小明',
      studentGrade: '國一',
      score: 85,
      status: 'scored',
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
  ];

  const refDataStub = {
    campuses: () => [],
    subjects: () => [],
    teachers: () => [],
    loadCampuses: () => undefined,
    loadSubjects: () => undefined,
    loadTeachers: () => undefined,
  };

  /** Flush both the exam detail and the child editor's getScores request */
  function flushAcademyRequests(examData = mockAcademyDetail): void {
    const examReq = http.expectOne(`${environment.apiUrl}/api/academy-exams/a1`);
    examReq.flush({ data: examData });

    // Child AcademyScoreEditorComponent fires getScores after exam loads
    fixture.detectChanges();
    const scoresReq = http.match(`${environment.apiUrl}/api/academy-exams/a1/scores`);
    scoresReq.forEach((r) => r.flush({ data: mockScores }));
  }

  async function setup(type: string, id: string) {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [ScoreEntryComponent],
      providers: [
        MessageService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ReferenceDataService, useValue: refDataStub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { params: { type, id } },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScoreEntryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges(); // ngOnInit
  }

  afterEach(() => {
    http.verify();
  });

  it('should create and load academy exam', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component['type']()).toBe('academy');
    expect(component['examInfo']()?.name).toBe('數學小考');
  });

  it('computes summary stats for academy', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    const stats = component['summaryStats']();
    expect(stats?.recordedCount).toBe(28);
    expect(stats?.average).toBe(72.3);
    expect(stats?.highest).toBe(98);
    expect(stats?.lowest).toBe(35);
  });

  it('builds meta line with type, subject, date, classes', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    const info = component['examInfo']();
    expect(info?.metaLine).toContain('小考');
    expect(info?.metaLine).toContain('數學');
    expect(info?.metaLine).toContain('數學A班');
  });

  it('loads school exam', async () => {
    await setup('school', 't1');

    const req = http.expectOne(`${environment.apiUrl}/api/school-exams/t1`);
    req.flush({
      data: {
        id: 't1',
        academicYear: 114,
        semester: 2,
        examType: 'term_exam',
        subjectId: 's1',
        subjectName: '國文',
        name: null,
        label: '114-2 段考',
        examDate: '2026-04-10',
        status: 'active',
        schoolId: 'sch-1',
        schoolName: '測試國中',
        summary: { bySubject: [], totalRecordedCount: 15 },
        createdAt: '2026-03-20T00:00:00Z',
        updatedAt: '2026-03-20T00:00:00Z',
      },
    });

    fixture.detectChanges();
    // Term editor fires getRecentStudents
    const recentReq = http.match(`${environment.apiUrl}/api/school-exams/t1/recent-students`);
    recentReq.forEach((r) => r.flush({ data: [] }));

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['type']()).toBe('school');
    expect(component['examInfo']()?.name).toBe('114-2 段考');
    expect(component['examInfo']()?.metaLine).toContain('科目：國文');
    expect(component['summaryStats']()?.recordedCount).toBe(15);
  });

  it('detects closed status', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests({ ...mockAcademyDetail, status: 'closed' as const });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['isClosed']()).toBe(true);
    expect(component['canSave']()).toBe(false);
  });

  it('canDeactivate returns true when not dirty', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    expect(component.canDeactivate()).toBe(true);
  });

  // #1020：dirty → 掛 beforeunload（會被 preventDefault 攔下）；存完 → 拿掉
  it('dirty 時掛 beforeunload 攔截，存檔後（dirty=false）移除', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();
    await fixture.whenStable();
    fixture.detectChanges();

    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };

    expect(fire()).toBe(false);

    component['dirty'].set(true);
    fixture.detectChanges();
    expect(fire()).toBe(true);

    component['dirty'].set(false);
    fixture.detectChanges();
    expect(fire()).toBe(false);
  });

  it('元件銷毀時移除 beforeunload，不留下孤兒 listener', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();
    await fixture.whenStable();
    component['dirty'].set(true);
    fixture.detectChanges();

    fixture.destroy();

    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('canSave is false when not dirty', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['canSave']()).toBe(false);
    component['dirty'].set(true);
    expect(component['canSave']()).toBe(true);
  });

  it('已完成仍可修改（#1931，照 A6）：頂上寫明改過的記在操作紀錄；編輯器不鎖；有變更照樣出現儲存列；工具列的批次動作收起', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests({ ...mockAcademyDetail, status: 'closed' as const });

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-part=closed-note]')?.textContent?.trim()).toBe(
      '這場考試已完成。成績仍可修改，改過的會記在操作紀錄。',
    );
    expect(host.textContent).not.toContain('重新開啟');
    expect(component['academyEditor']()!.disabled()).toBe(false);
    expect(host.querySelector('[data-part=complete]')).toBeNull();

    component['dirty'].set(true);
    fixture.detectChanges();
    expect(component['canSave']()).toBe(true);
    expect(host.querySelector('[role=region][aria-label=儲存]')).not.toBeNull();
  });

  it('有沒存的變更時出現底部儲存列（取代 FAB）', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    component['dirty'].set(true);
    fixture.detectChanges();

    const bar = (fixture.nativeElement as HTMLElement).querySelector(
      '[role=region][aria-label=儲存]',
    );
    expect(bar?.textContent).toContain('儲存成績');
  });

  // Q3（#991 grades）：站內導頁攔截改成頁內三選項對話框，不再用 window.confirm
  describe('離開攔截', () => {
    beforeEach(() => {
      // jsdom 沒有完整的 <dialog> modal 行為；只需要開關狀態
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        this.open = false;
      };
    });

    async function dirtyPage(): Promise<void> {
      await setup('academy', 'a1');
      flushAcademyRequests();
      await fixture.whenStable();
      component['dirty'].set(true);
      fixture.detectChanges();
    }

    it('留下來 → 不放行；不儲存離開 → 放行', async () => {
      await dirtyPage();
      const confirmSpy = vi.spyOn(window, 'confirm');

      const stay = component.canDeactivate() as Promise<boolean>;
      const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
      expect(dialog.open).toBe(true);
      component['resolveLeave']('stay');
      await expect(stay).resolves.toBe(false);
      expect(dialog.open).toBe(false);

      const leave = component.canDeactivate() as Promise<boolean>;
      component['resolveLeave']('discard');
      await expect(leave).resolves.toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('儲存後離開：存成功才放行，存失敗就留下', async () => {
      await dirtyPage();
      const save = vi.fn();
      (component as unknown as { saveScores: () => void }).saveScores = save;

      const ok = component.canDeactivate() as Promise<boolean>;
      component['resolveLeave']('save');
      expect(save).toHaveBeenCalled();
      component['onSaved']();
      http
        .expectOne((r) => r.url.endsWith('/api/academy-exams/a1'))
        .flush({ data: mockAcademyDetail }); // 存檔後重抓統計
      component['onSavingChange'](false);
      await expect(ok).resolves.toBe(true);

      component['dirty'].set(true);
      const failed = component.canDeactivate() as Promise<boolean>;
      component['resolveLeave']('save');
      component['onSavingChange'](false); // 沒有 onSaved —— 存檔失敗，dirty 還在
      await expect(failed).resolves.toBe(false);
    });
  });

  /**
   * #1925 A6 對齊：合計與批次動作在灰帶工具列；「標記完成」＝先存未存的變更、存成功才 close，
   * 完成後唯讀（#991 Q1；A6 的完成後可修改另排 #1931）。這組守的是寫入的順序與失敗時不誤標。
   */
  describe('灰帶工具列與標記完成（#1925）', () => {
    const API = `${environment.apiUrl}/api/academy-exams/a1`;
    const el = () => fixture.nativeElement as HTMLElement;
    const q = (part: string) => el().querySelector<HTMLButtonElement>(`[data-part="${part}"]`);

    async function ready(status: 'active' | 'closed' = 'active') {
      await setup('academy', 'a1');
      flushAcademyRequests({ ...mockAcademyDetail, status });
      await fixture.whenStable();
      fixture.detectChanges();
    }
    const editor = () => component['academyEditor']()!;
    function makeDirty() {
      const row = editor()['rows']()[0];
      editor()['onScoreChange'](row, 60);
      fixture.detectChanges();
    }
    function confirmComplete() {
      q('complete')!.click();
      fixture.detectChanges();
      q('complete-confirm')!.click();
      fixture.detectChanges();
    }

    it('進行中：工具列有合計、其餘標記缺考、加入其他學生、標記完成；已完成：只剩合計', async () => {
      await ready();
      expect(q('tally')!.textContent).toContain('已登錄');
      for (const part of ['mark-absent', 'add-student', 'complete']) expect(q(part)).not.toBeNull();

      await ready('closed');
      expect(q('tally')).not.toBeNull();
      for (const part of ['mark-absent', 'add-student', 'complete']) expect(q(part)).toBeNull();
    });

    it('「加入其他學生」打開編輯器的面板', async () => {
      await ready();
      q('add-student')!.click();
      fixture.detectChanges();
      expect(editor().addingStudent()).toBe(true);
    });

    it('沒有未存變更：確認後直接 close，成功後重抓考試（狀態變已完成）', async () => {
      await ready();
      confirmComplete();
      const close = http.expectOne(`${API}/close`);
      expect(close.request.method).toBe('PATCH');
      close.flush({ success: true });
      http.expectOne(API).flush({ data: { ...mockAcademyDetail, status: 'closed' } });
      fixture.detectChanges();
      expect(component['isClosed']()).toBe(true);
      expect(q('complete')).toBeNull();
    });

    it('有未存變更：先存成績、存成功才 close', async () => {
      await ready();
      makeDirty();
      confirmComplete();
      http.expectNone(`${API}/close`);
      const save = http.expectOne(`${API}/scores`);
      expect(save.request.method).toBe('POST');
      expect(save.request.body.scores).toEqual([
        expect.objectContaining({ studentId: 'stu-1', score: 60 }),
      ]);
      save.flush({ success: true, affected: 1 });
      http.expectOne(`${API}/close`).flush({ success: true });
      http.expectOne(API).flush({ data: { ...mockAcademyDetail, status: 'closed' } });
    });

    it('有未存變更但存檔失敗：不 close，之後再存成功也不會補 close', async () => {
      await ready();
      makeDirty();
      confirmComplete();
      http.expectOne(`${API}/scores`).flush('boom', { status: 500, statusText: 'err' });
      await new Promise((r) => setTimeout(r));
      http.expectNone(`${API}/close`);

      component['saveScores']();
      http.expectOne(`${API}/scores`).flush({ success: true, affected: 1 });
      http.expectNone(`${API}/close`);
      http.expectOne(API).flush({ data: mockAcademyDetail }); // 一般存檔後重抓統計
    });

    it('取消：什麼都不送', async () => {
      await ready();
      makeDirty();
      q('complete')!.click();
      fixture.detectChanges();
      component['resolveComplete'](false);
      http.expectNone(`${API}/scores`);
      http.expectNone(`${API}/close`);
    });

    it('close 失敗：維持進行中，按鈕還在', async () => {
      await ready();
      confirmComplete();
      http.expectOne(`${API}/close`).flush('boom', { status: 500, statusText: 'err' });
      fixture.detectChanges();
      expect(component['isClosed']()).toBe(false);
      expect(component['completing']()).toBe(false);
      expect(q('complete')).not.toBeNull();
    });

    it('只有一個班：副行的班名連到班級詳情（courseId 另外查）', async () => {
      await setup('academy', 'a1');
      flushAcademyRequests({
        ...mockAcademyDetail,
        campusName: '台北分校',
        classes: [{ classId: 'cls-1', className: '數學A班' }],
      } as typeof mockAcademyDetail);
      http
        .expectOne(`${environment.apiUrl}/api/classes/cls-1`)
        .flush({ data: { id: 'cls-1', courseId: 'course-9' } });
      await fixture.whenStable();
      fixture.detectChanges();
      const link = el().querySelector<HTMLAnchorElement>('app-page-open a[href*="/classes/"]')!;
      expect(link.textContent!.trim()).toBe('數學A班');
      expect(link.getAttribute('href')).toBe('/admin/courses/course-9/classes/cls-1');
      expect(el().querySelector('app-page-open')!.textContent).toContain('4/1（三）');
    });
  });
});

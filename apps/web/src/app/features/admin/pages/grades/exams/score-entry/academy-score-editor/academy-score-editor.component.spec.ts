import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService, type AcademyExamDetail } from '@core/academy-exams.service';
import { StudentsService, type Student } from '@core/students.service';
import { AcademyScoreEditorComponent } from './academy-score-editor.component';

describe('AcademyScoreEditorComponent', () => {
  let fixture: ComponentFixture<AcademyScoreEditorComponent>;
  let component: AcademyScoreEditorComponent;

  const mockScores = [
    {
      studentId: 'stu-1',
      studentName: '王小明',
      studentGrade: '國一',
      score: 85,
      status: 'scored' as const,
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
    {
      studentId: 'stu-2',
      studentName: '李小華',
      studentGrade: '國一',
      score: null,
      status: 'scored' as const,
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
  ];

  const mockExam: AcademyExamDetail = {
    id: 'exam-1',
    name: '數學小考',
    examType: 'quiz',
    status: 'active',
    examDate: '2026-04-01',
    totalScore: 100,
    passScore: null,
    scopeNote: '第一章',
    campusId: 'c1',
    campusName: '台北分校',
    subjectId: 's1',
    subjectName: '數學',
    classes: [{ classId: 'cls-1', className: 'A班', campusName: '台北分校', courseName: '數學' }],
    summary: {
      averageScore: 85,
      highestScore: 85,
      lowestScore: 85,
      absentCount: 0,
      recordedCount: 1,
    },
    createdBy: null,
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const academyExamsServiceMock = {
    getScores: vi.fn(() => of({ data: mockScores })),
    saveScores: vi.fn(() => of({ success: true, affected: 1 })),
  };

  const messageServiceMock = { add: vi.fn() };
  const studentsServiceMock = { list: vi.fn((..._a: unknown[]) => of({ data: [] as Student[] })) };

  beforeEach(async () => {
    academyExamsServiceMock.getScores.mockClear();
    academyExamsServiceMock.saveScores.mockClear();
    messageServiceMock.add.mockClear();

    await TestBed.configureTestingModule({
      imports: [AcademyScoreEditorComponent],
      providers: [
        { provide: AcademyExamsService, useValue: academyExamsServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcademyScoreEditorComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('exam', mockExam);
    fixture.componentRef.setInput('examId', 'exam-1');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads scores on init', () => {
    expect(academyExamsServiceMock.getScores).toHaveBeenCalledWith('exam-1');
    expect(component['rows']().length).toBe(2);
    expect(component['loading']()).toBe(false);
  });

  it('maps existing scores into rows', () => {
    const rows = component['rows']();
    expect(rows[0].studentName).toBe('王小明');
    expect(rows[0].score).toBe(85);
    expect(rows[0].status).toBe('scored');
    expect(rows[1].score).toBeNull();
  });

  it('detects dirty state when score changes', () => {
    expect(component['isDirty']()).toBe(false);
    component['onScoreChange'](component['rows']()[1], 72);
    expect(component['isDirty']()).toBe(true);
  });

  it('clears score when status changes to absent', () => {
    const row = component['rows']()[0];
    component['onStatusChange'](row, 'absent');
    expect(row.score).toBeNull();
    expect(row.status).toBe('absent');
  });

  it('saves only dirty rows', () => {
    component['onScoreChange'](component['rows']()[1], 72);
    component['save']();

    expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith(
      'exam-1',
      expect.arrayContaining([
        expect.objectContaining({ studentId: 'stu-2', score: 72, status: 'scored' }),
      ]),
    );
  });

  it('does not save empty unchanged rows', () => {
    // No changes
    component['save']();
    expect(academyExamsServiceMock.saveScores).not.toHaveBeenCalled();
  });

  it('hides class filter when only one class', () => {
    expect(component['classOptions']().length).toBe(0);
  });

  it('shows class filter when multiple classes', () => {
    const multiClassExam: AcademyExamDetail = {
      ...mockExam,
      classes: [
        { classId: 'cls-1', className: 'A班', campusName: '台北分校', courseName: '數學' },
        { classId: 'cls-2', className: 'B班', campusName: '台北分校', courseName: '數學' },
      ],
    };
    fixture.componentRef.setInput('exam', multiClassExam);
    fixture.detectChanges();
    // 3 items: "全部班級" + 2 classes
    expect(component['classOptions']().length).toBe(3);
  });

  it('renders mobile compact list with student info', () => {
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('[data-part=mobile-row]');

    expect(host.querySelector('[data-part=mobile-list]')).not.toBeNull();
    expect(rows.length).toBe(2);

    const firstRow = rows[0] as HTMLElement;
    expect(firstRow.textContent).toContain('王小明');
    expect(firstRow.textContent).toContain('國一');
  });

  // ── 未儲存移出色彩通道（刀 4）─────────────────────────────────────────────
  it('dirtyCount 數的是還沒存的筆數 —— 急迫性屬於整批不屬於單一格', () => {
    expect(component['dirtyCount']()).toBe(
      component['rows']().filter((r) => component['isRowDirty'](r)).length,
    );
  });

  // ── 存檔後計數要歸零 ──────────────────────────────────────────────────────
  // 實走 demo 抓到的：存檔成功、dirty 邊框清掉了、儲存鈕也消失了，
  // 但標題還掛著「3 筆未儲存」。原因是 `original` 是**原地改**的，
  // `rows` signal 的參照沒變，computed 就不重算。
  it('存檔成功之後 dirtyCount 歸零（原地改 original 不會讓 computed 重算）', () => {
    component['onScoreChange'](component['rows']()[1], 72);
    expect(component['dirtyCount']()).toBe(1);

    component['save']();

    expect(component['dirtyCount']()).toBe(0);
    expect(component['isDirty']()).toBe(false);
  });

  // ── 鍵盤：↑↓/Enter 是換列，不是改值（charter 坑 11）─────────────────────
  describe('分數欄的鍵盤動線', () => {
    /** 取第 i 列分數欄實際的 <input> */
    const fieldAt = (i: number) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        `[data-score-row="${i}"] input`,
      );

    const press = (key: string, index: number) => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      component['onScoreKeydown'](event, index);
      return event;
    };

    it('↓ 把焦點移到下一列，而且**不會**改掉目前這格的分數', () => {
      const before = component['rows']()[0].score;

      const event = press('ArrowDown', 0);

      // preventDefault 是關鍵：不擋的話 PrimeNG 會把 85 變成 84
      expect(event.defaultPrevented).toBe(true);
      expect(component['rows']()[0].score).toBe(before);
      expect(document.activeElement).toBe(fieldAt(1));
    });

    it('Enter 也是換列 —— 試算表的心智模型', () => {
      press('Enter', 0);
      expect(document.activeElement).toBe(fieldAt(1));
    });

    it('↑ 往回一列', () => {
      press('ArrowUp', 1);
      expect(document.activeElement).toBe(fieldAt(0));
    });

    // **這支測試需要三列才有鑑別力。** 第一版只用了 mock 的兩列（0 正常、1 缺考），
    // 結果拿掉「跳過 disabled」的邏輯它照樣綠 —— 因為 `focus()` 打在 disabled 元素上
    // 本來就是無效操作，焦點留在原地，跟「找不到可去的地方」長得一模一樣。
    // 要中間夾一列鎖住的、後面還有一列活的，才分得出「跳過去了」跟「卡住了」。
    it('跳過缺考那列，落在再下一列 —— 不是卡在原地', async () => {
      const rows = component['rows']();
      component['rows'].set([
        rows[0],
        { ...rows[1], status: 'absent' as const, score: null },
        {
          ...rows[0],
          studentId: 'stu-3',
          studentName: '陳小美',
          original: { score: null, status: 'scored' as const, notes: '' },
          score: null,
        },
      ]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fieldAt(1)?.disabled).toBe(true);
      expect(fieldAt(2)?.disabled).toBe(false);

      press('ArrowDown', 0);

      expect(document.activeElement).toBe(fieldAt(2));
    });

    it('其他按鍵不攔截 —— 打字要能正常進去', () => {
      const event = press('5', 0);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  // 這一欄的紅色原本是唯一的訊息 —— 色覺障礙的人看不出它跟一般文字的差別
  describe('不及格的形狀訊號', () => {
    /** mockScores 第一筆是 85 分、第二筆是 null，改第一筆就能造出各種分數 */
    function setScore(score: number | null) {
      component['onScoreChange'](component['rows']()[0], score);
      fixture.detectChanges();
      return fixture.nativeElement.querySelectorAll('[data-part=fail-icon]');
    }

    it('低於門檻時有 icon，而且螢幕閱讀器讀得到', () => {
      const icons = setScore(45);

      expect(icons.length).toBeGreaterThan(0);
      expect(icons[0].getAttribute('aria-label')).toBe('不及格');
    });

    it('及格就不出現 —— 形狀訊號只在需要時現身', () => {
      expect(setScore(85).length).toBe(0);
    });

    // 還沒登錄不是考差了（跟「還沒點名不是缺席」同一族）
    it('沒有分數時不出現', () => {
      expect(setScore(null).length).toBe(0);
    });

    it('0 分會出現 —— 那是一個真的分數', () => {
      expect(setScore(0).length).toBeGreaterThan(0);
    });

    it('判斷走共用的門檻函式，不是模板裡的字面值', () => {
      expect(component['isFailing'](59)).toBe(true);
      expect(component['isFailing'](60)).toBe(false);
    });

    it('這場考試設了及格線時，優先用及格線而不是總分的六成', () => {
      fixture.componentRef.setInput('exam', { ...mockExam, passScore: 70 });
      fixture.detectChanges();

      expect(component['isFailing'](65)).toBe(true);
      expect(component['isFailing'](70)).toBe(false);
      // 60 分在總分六成的舊門檻下剛好及格；設了及格線 70 之後變成不及格，
      // 證明門檻確實換成及格線，不是還停在總分比例
      expect(component['isFailing'](60)).toBe(true);
    });
  });

  /**
   * **#886：清空分數後儲存 = 刪除那一列。**
   *
   * 原本 `save()` 把「`score === null` 且 `status === 'scored'`」的列整個濾掉，
   * 於是清空之後按儲存**什麼都不會發生** —— 沒有 toast、沒有請求，
   * 而標題上的「N 筆未儲存」與 FAB 都還在。使用者會以為畫面當掉了。
   *
   * 這兩條釘的是「**那一列有沒有被送出去**」，不是 toast 文字 ——
   * 這個 bug 的形狀就是「畫面說有改動、網路上什麼都沒發生」。
   */
  describe('清空分數（#886）', () => {
    it('把已有分數的列清空之後，那一列會被送出（score: null）', () => {
      const row = component['rows']()[0];
      const originalScore = row.original.score;
      expect(originalScore).not.toBeNull();

      component['onScoreChange'](row, null);
      component['save']();

      expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith(
        'exam-1',
        expect.arrayContaining([
          expect.objectContaining({ studentId: row.studentId, score: null, status: 'scored' }),
        ]),
      );
    });

    // 缺考的 null **不是**清空 —— 它是被登錄過的事實。
    // 這一條跟上一條一起，才說得出「送出去的是哪一種 null」。
    it('改成缺考仍然送出，而且 status 是 absent', () => {
      const row = component['rows']()[0];

      component['onStatusChange'](row, 'absent');
      component['save']();

      expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith(
        'exam-1',
        expect.arrayContaining([
          expect.objectContaining({ studentId: row.studentId, score: null, status: 'absent' }),
        ]),
      );
    });

    // 「完全沒有改動」這條路仍然存在（清空的列不再被濾掉之後也一樣），
    // 而它原本是靜默的 —— 現在要說話。
    it('完全沒有改動時不送請求，但要給訊息', () => {
      component['save']();

      expect(academyExamsServiceMock.saveScores).not.toHaveBeenCalled();
      expect(messageServiceMock.add).toHaveBeenCalledWith(
        expect.objectContaining({ summary: expect.stringContaining('沒有') }),
      );
    });
  });

  // #1314 G11
  describe('批次動作', () => {
    it('其餘標記缺考：只動沒分數的人，已登分的不被蓋掉，存檔送 absent＋score:null', () => {
      component.markRestAbsent();
      const rows = component['rows']();
      expect(rows[0]).toMatchObject({ score: 85, status: 'scored' });
      expect(rows[1]).toMatchObject({ score: null, status: 'absent' });
      expect(component['dirtyCount']()).toBe(1);

      component.save();
      expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith('exam-1', [
        { studentId: 'stu-2', score: null, status: 'absent', notes: null },
      ]);
    });

    it('其餘標記缺考：補考列（makeup、沒分數）不被改成缺考', () => {
      const makeupRow = component['rows']()[1];
      component['onStatusChange'](makeupRow, 'makeup');
      component['rows']()[1].original.status = 'makeup'; // 當作上次儲存就是補考

      component.markRestAbsent();
      expect(component['rows']()[1]).toMatchObject({ score: null, status: 'makeup' });
      expect(component['dirtyCount']()).toBe(0);
    });

    it('其餘標記缺考：每位都有分數或缺考時只提示、不改任何列', () => {
      component.markRestAbsent();
      messageServiceMock.add.mockClear();
      component.markRestAbsent();
      expect(component['dirtyCount']()).toBe(1);
      expect(messageServiceMock.add).toHaveBeenCalledWith(
        expect.objectContaining({ summary: expect.stringContaining('每位都已經') }),
      );
    });

    it('復原變更：改過的分數、狀態都退回上次儲存', () => {
      component['onScoreChange'](component['rows']()[0], 10);
      component.markRestAbsent();
      expect(component['dirtyCount']()).toBe(2);

      component.revert();
      const rows = component['rows']();
      expect(rows[0]).toMatchObject({ score: 85, status: 'scored' });
      expect(rows[1]).toMatchObject({ score: null, status: 'scored' });
      expect(component['isDirty']()).toBe(false);
    });

    it('已結束的考試不出現「其餘標記缺考」鈕', () => {
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-part="mark-absent"]')).not.toBeNull();
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();
      expect(host.querySelector('[data-part="mark-absent"]')).toBeNull();
    });
  });

  // #1314 G4
  describe('加入其他學生', () => {
    const outsider = { id: 'stu-9', name: '陳插班', grade: 'J2' } as unknown as Student;

    it('選到學生：加一列、不算未存變更；輸入分數後才 dirty，存檔送出該生', () => {
      component['onStudentPicked'](outsider);
      const rows = component['rows']();
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ studentId: 'stu-9', studentName: '陳插班', score: null });
      expect(component['dirtyCount']()).toBe(0);

      component['onScoreChange'](rows[2], 77);
      component.save();
      expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith('exam-1', [
        { studentId: 'stu-9', score: 77, status: 'scored', notes: null },
      ]);
    });

    it('已在名單裡的人不重複加；打字中的字串不算選定', () => {
      component['onStudentPicked']({ ...outsider, id: 'stu-1' } as Student);
      component['onStudentPicked']('陳');
      expect(component['rows']()).toHaveLength(2);
    });

    it('加入時清掉班級篩選，否則沒有 classIds 的班外學生會被篩掉看不到', () => {
      component['classFilter'].set('cls-1');
      component['onStudentPicked'](outsider);
      expect(component['classFilter']()).toBeNull();
      expect(component['filteredRows']().some((r) => r.studentId === 'stu-9')).toBe(true);
    });

    it('班外學生的列標「加入」，原名單的人沒有', () => {
      component['onStudentPicked'](outsider);
      fixture.detectChanges();
      const tags = [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-part="added-tag"]'),
      ];
      expect(tags.length).toBeGreaterThan(0);
      expect(component['rows']().map((r) => !!r.added)).toEqual([false, false, true]);
    });

    it('連打查詢時舊查詢慢回來不會蓋掉新結果（switchMap）', () => {
      const slow = new Subject<{ data: Student[] }>();
      const fast = new Subject<{ data: Student[] }>();
      studentsServiceMock.list
        .mockReturnValueOnce(slow as never)
        .mockReturnValueOnce(fast as never);
      component['onStudentQuery']('陳');
      component['onStudentQuery']('陳插');
      fast.next({ data: [outsider] });
      slow.next({ data: [{ ...outsider, id: 'old', name: '舊結果' } as Student] });
      expect(component['studentSuggestions']().map((x) => x.name)).toEqual(['陳插班']);
    });

    it('按鈕開關面板；已結束的考試不出鈕', () => {
      const host = fixture.nativeElement as HTMLElement;
      host.querySelector<HTMLButtonElement>('[data-part="add-student"]')!.click();
      fixture.detectChanges();
      expect(host.querySelector('[data-part="add-student-panel"]')).not.toBeNull();
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();
      expect(host.querySelector('[data-part="add-student"]')).toBeNull();
    });
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';

import { ScoresService } from '@core/scores.service';
import { StudentScoreDetailDialogComponent } from './student-score-detail-dialog.component';

describe('StudentScoreDetailDialogComponent', () => {
  let component: StudentScoreDetailDialogComponent;
  let fixture: ComponentFixture<StudentScoreDetailDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentScoreDetailDialogComponent],
      providers: [
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: { close: () => undefined } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              student: {
                id: 's1',
                name: '王小明',
                grade: 'J1',
                campusNames: [],
              },
            },
          },
        },
        {
          provide: ScoresService,
          useValue: {
            list: () => of({ data: [] }),
            getStudentSummary: () => of({ data: { subjects: [] } }),
          },
        },
        { provide: MessageService, useValue: { add: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentScoreDetailDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('補習班科目平均顯示「總得分 / 總滿分」，低於六成標記不及格', () => {
    (component as unknown as { summary: { set: (v: unknown) => void } }).summary.set([
      {
        subjectName: '數學',
        academySum: 50,
        academyTotalSum: 100,
        schoolAvg: null,
        totalRecords: 2,
      },
    ]);
    fixture.detectChanges();

    const values = fixture.nativeElement.querySelectorAll('[data-part=summary-value]');
    expect(values[0].textContent.trim()).toBe('50 / 100');
    expect(values[0].hasAttribute('data-fail')).toBe(true);
  });

  it('補習班科目平均達六成門檻時不標記不及格', () => {
    (component as unknown as { summary: { set: (v: unknown) => void } }).summary.set([
      {
        subjectName: '數學',
        academySum: 60,
        academyTotalSum: 100,
        schoolAvg: null,
        totalRecords: 2,
      },
    ]);
    fixture.detectChanges();

    const values = fixture.nativeElement.querySelectorAll('[data-part=summary-value]');
    expect(values[0].hasAttribute('data-fail')).toBe(false);
  });

  it('補習班科目沒有任何小考成績時（sum 為 null）顯示 — 且不標記不及格', () => {
    (component as unknown as { summary: { set: (v: unknown) => void } }).summary.set([
      {
        subjectName: '數學',
        academySum: null,
        academyTotalSum: null,
        schoolAvg: null,
        totalRecords: 0,
      },
    ]);
    fixture.detectChanges();

    const values = fixture.nativeElement.querySelectorAll('[data-part=summary-value]');
    expect(values[0].textContent.trim()).toBe('—');
    expect(values[0].hasAttribute('data-fail')).toBe(false);
  });

  // #1314 G10：每場帶班平均、名次、這場全班的成績連結（只有補習班考試有）
  it('每場顯示班平均與名次，補習班考試多一條「這場全班的成績」連結，校內段考沒有', () => {
    const base = {
      studentId: 's1',
      studentName: '王小明',
      subjectName: '數學',
      totalScore: 100,
      status: 'scored',
    };
    // 固定日期的資料：關掉預設的近 3 個月，免得過幾個月後被篩掉（#670）
    (component as unknown as { timeRange: { set: (v: string) => void } }).timeRange.set('all');
    (component as unknown as { scores: { set: (v: unknown) => void } }).scores.set([
      {
        ...base,
        id: 'a',
        type: 'academy',
        examId: 'e1',
        examName: '第三次小考',
        examDate: '2026-09-24',
        score: 80,
        classAvg: 76.5,
        rank: 3,
        classSize: 18,
      },
      {
        ...base,
        id: 'b',
        type: 'school',
        examId: 'e2',
        examName: '期中段考',
        examDate: '2026-09-10',
        score: 70,
        classAvg: null,
        rank: null,
        classSize: null,
      },
    ]);
    fixture.detectChanges();
    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-part="record"]'),
    ];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('班平均 76.5');
    expect(rows[0].textContent).toContain('第 3 名／18 人');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      '/admin/grades/exams/academy/e1/scores',
    );
    expect(rows[1].textContent).not.toContain('班平均');
    expect(rows[1].querySelector('a')).toBeNull();
  });

  // #1314 G10：只有 1 人考的場次，「第 1 名／1 人」沒有資訊量，不寫名次
  // #1314 Z 批：A6 精簡版分頁器（app-pager），不再是 PrimeNG 的 p-paginator
  it('超過一頁：精簡版分頁器，按下一頁換到第 2 頁的紀錄', () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      studentId: 's1',
      studentName: '王小明',
      subjectName: '數學',
      totalScore: 100,
      status: 'scored',
      type: 'school',
      examId: `e${i}`,
      examName: `第 ${i + 1} 次`,
      examDate: today,
      score: 80,
      classAvg: null,
      rank: null,
      classSize: null,
    }));
    (component as unknown as { scores: { set: (v: unknown) => void } }).scores.set(rows);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('p-paginator')).toBeNull();
    expect(el.querySelector('app-pager [data-part="status"]')?.textContent?.trim()).toBe(
      '第 1／2 頁',
    );
    expect(el.querySelectorAll('[data-part="record"]')).toHaveLength(10);
    Array.from(el.querySelectorAll<HTMLButtonElement>('app-pager button'))
      .find((b) => b.textContent?.includes('下一頁'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-part="record"]')).toHaveLength(2);
  });

  it('classSize 為 1 時只寫班平均，不顯示名次；2 人以上才顯示', () => {
    const base = {
      studentId: 's1',
      studentName: '王小明',
      subjectName: '數學',
      totalScore: 100,
      status: 'scored',
      type: 'academy',
      examDate: '2026-09-24',
      score: 80,
      classAvg: 80,
    };
    // 固定日期的資料：關掉預設的近 3 個月，免得過幾個月後被篩掉（#670）
    (component as unknown as { timeRange: { set: (v: string) => void } }).timeRange.set('all');
    (component as unknown as { scores: { set: (v: unknown) => void } }).scores.set([
      { ...base, id: 'solo', examId: 'e1', examName: '一人考', rank: 1, classSize: 1 },
      { ...base, id: 'pair', examId: 'e2', examName: '兩人考', rank: 2, classSize: 2 },
    ]);
    fixture.detectChanges();
    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-part="record"]'),
    ];
    expect(rows[0].textContent).toContain('班平均 80');
    expect(rows[0].textContent).not.toContain('名');
    expect(rows[1].textContent).toContain('第 2 名／2 人');
  });
  // #1314 成績明細歸零：標題是 h2（appDialogTitle 掛對話框可及名稱），副標「年級 · 學校」
  it('標題是 h2「{名} 的成績」，副標寫年級', () => {
    fixture.detectChanges();
    const h2 = (fixture.nativeElement as HTMLElement).querySelector('h2');
    expect(h2?.textContent?.trim()).toBe('王小明 的成績');
    expect(h2?.id).toMatch(/^dialog-title-/);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.dialog-header-inline__sub')
        ?.textContent,
    ).toContain('國一');
  });

  // #2291：手機標頭上方的綠色格狀圖示是舊版的 jdenticon 頭像（稿沒有）；標頭只留 h2、副標、關閉鈕
  it('標頭只有 h2、副標與關閉鈕 —— 沒有頭像', () => {
    fixture.detectChanges();
    const head = (fixture.nativeElement as HTMLElement).querySelector('.dialog-header-inline')!;
    expect(head.querySelector('app-jdenticon-avatar, svg, img, canvas')).toBeNull();
    const parts = [...head.querySelectorAll('h2, p, button')].map((e) => e.tagName);
    expect(parts).toEqual(['H2', 'P', 'BUTTON']);
    expect(head.querySelector('button')?.getAttribute('aria-label')).toBe('關閉');
  });

  // #2079(c)／#2166：預設期間跟成績總覽一樣是近 3 個月
  it('預設只列近 3 個月，按「全部」才列出更早的', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const row = (id: string, examDate: string) => ({
      id,
      studentId: 's1',
      studentName: '王小明',
      subjectName: '數學',
      totalScore: 100,
      status: 'scored',
      type: 'school',
      examId: id,
      examName: id,
      examDate,
      score: 80,
      classAvg: null,
      rank: null,
      classSize: null,
    });
    (component as unknown as { scores: { set: (v: unknown) => void } }).scores.set([
      row('recent', daysAgo(30)),
      row('old', daysAgo(150)),
    ]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-part="record"]')).toHaveLength(1);
    const all = Array.from(
      el.querySelectorAll<HTMLButtonElement>('[aria-label="期間"] button'),
    ).find((b) => b.textContent?.trim() === '全部')!;
    expect(all.getAttribute('aria-pressed')).toBe('false');
    all.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-part="record"]')).toHaveLength(2);
  });
});

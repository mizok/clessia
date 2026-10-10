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
});

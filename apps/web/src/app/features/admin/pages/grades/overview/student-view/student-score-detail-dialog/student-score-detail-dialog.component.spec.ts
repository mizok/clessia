import { ComponentFixture, TestBed } from '@angular/core/testing';
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

    const values = fixture.nativeElement.querySelectorAll(
      '.student-score-detail-dialog__summary-value',
    );
    expect(values[0].textContent.trim()).toBe('50 / 100');
    expect(values[0].classList).toContain('student-score-detail-dialog__summary-value--fail');
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

    const values = fixture.nativeElement.querySelectorAll(
      '.student-score-detail-dialog__summary-value',
    );
    expect(values[0].classList).not.toContain('student-score-detail-dialog__summary-value--fail');
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

    const values = fixture.nativeElement.querySelectorAll(
      '.student-score-detail-dialog__summary-value',
    );
    expect(values[0].textContent.trim()).toBe('—');
    expect(values[0].classList).not.toContain('student-score-detail-dialog__summary-value--fail');
  });
});

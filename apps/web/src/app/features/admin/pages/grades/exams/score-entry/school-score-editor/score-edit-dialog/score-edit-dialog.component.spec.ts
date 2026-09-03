import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';

import { SchoolExamsService } from '@core/school-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { ScoreEditDialogComponent } from './score-edit-dialog.component';

describe('ScoreEditDialogComponent', () => {
  let component: ScoreEditDialogComponent;
  let fixture: ComponentFixture<ScoreEditDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScoreEditDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: () => undefined } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              examId: 't1',
              examSubjectId: null,
              examSubjectName: null,
              disabled: false,
              studentId: 'stu-1',
              studentName: '王小明',
              studentGrade: 'J1',
            },
          },
        },
        {
          provide: SchoolExamsService,
          useValue: {
            getScores: () => of({ data: [] }),
            saveScores: () => of({ affected: 0 }),
          },
        },
        {
          provide: ReferenceDataService,
          useValue: {
            loadSubjects: () => undefined,
            subjects: () => [],
          },
        },
        { provide: MessageService, useValue: { add: () => undefined } },
        { provide: ConfirmationService, useValue: { confirm: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScoreEditDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // 這張表跟 academy-score-editor 是同一種東西，手感必須一樣（#161 只修了那一份）
  describe('鍵盤動線', () => {
    function keydown(key: string) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      (component as never as { onScoreKeydown(e: KeyboardEvent, i: number): void }).onScoreKeydown(
        event,
        0,
      );
      return event;
    }

    it('↓ 被攔下來換列，不會讓 p-inputnumber 把分數減 1', () => {
      expect(keydown('ArrowDown').defaultPrevented).toBe(true);
    });

    it('Enter 也是換列', () => {
      expect(keydown('Enter').defaultPrevented).toBe(true);
    });

    it('↑ 是往上一列', () => {
      expect(keydown('ArrowUp').defaultPrevented).toBe(true);
    });

    // 攔錯的話連數字都打不進去
    it('數字鍵原樣放行', () => {
      expect(keydown('5').defaultPrevented).toBe(false);
    });

    it('Tab 不攔 —— 那是欄位之間的移動，不是換列', () => {
      expect(keydown('Tab').defaultPrevented).toBe(false);
    });
  });
});

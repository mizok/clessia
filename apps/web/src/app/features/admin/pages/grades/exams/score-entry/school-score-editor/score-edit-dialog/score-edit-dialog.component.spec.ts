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
});

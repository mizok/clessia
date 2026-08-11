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
});

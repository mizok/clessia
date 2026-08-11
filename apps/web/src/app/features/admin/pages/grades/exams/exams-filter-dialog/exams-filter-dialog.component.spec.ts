import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ExamsFilterDialogComponent } from './exams-filter-dialog.component';

describe('ExamsFilterDialogComponent', () => {
  let component: ExamsFilterDialogComponent;
  let fixture: ComponentFixture<ExamsFilterDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExamsFilterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: () => undefined } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              initial: {
                examType: 'academy',
                campusId: null,
                schoolId: null,
                subjectId: null,
                status: 'all',
                timeRange: 'all',
              },
              options: {
                campusOptions: [],
                schoolOptions: [],
                subjectOptions: [],
                statusOptions: [],
                examTypeOptions: [],
                timeRangeOptions: [],
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExamsFilterDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

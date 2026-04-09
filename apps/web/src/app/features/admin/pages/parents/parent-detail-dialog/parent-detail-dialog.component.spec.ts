import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ParentsService, type ParentDetail } from '@core/parents.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { ParentDetailDialogComponent } from './parent-detail-dialog.component';

describe('ParentDetailDialogComponent', () => {
  let fixture: ComponentFixture<ParentDetailDialogComponent>;

  const parentDetail: ParentDetail = {
    id: 'parent-1',
    userId: 'user-1',
    orgId: 'org-1',
    name: '王媽媽',
    phone: '0912345678',
    email: 'mom@example.com',
    loginAccount: 'mom@example.com',
    status: 'active',
    studentCount: 1,
    studentNames: ['王小明'],
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    students: [
      {
        id: 'student-1',
        name: '王小明',
        grade: 'P5',
        relation: 'mother',
        isPrimary: true,
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentDetailDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              parentId: 'parent-1',
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: ParentsService,
          useValue: {
            get: vi.fn(() => of({ data: parentDetail })),
          },
        },
        {
          provide: EnrollmentsService,
          useValue: {
            create: vi.fn(),
          },
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: vi.fn(() => null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentDetailDialogComponent);
    fixture.detectChanges();
  });

  it('renders linked students and enrollment action', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('王小明');
    expect(text).toContain('小五');
    expect(text).toContain('報名班級');
  });
});

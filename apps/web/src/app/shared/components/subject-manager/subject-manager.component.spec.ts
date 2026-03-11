import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SubjectsService } from '@core/subjects.service';
import type { Subject } from '@core/subjects.service';
import { SubjectManagerComponent } from './subject-manager.component';

describe('SubjectManagerComponent', () => {
  let fixture: ComponentFixture<SubjectManagerComponent>;
  let component: SubjectManagerComponent;

  const subjects: Subject[] = [{ id: 'subject-1', name: '數學', sortOrder: 0 }];
  const subjectsServiceMock = {
    list: vi.fn(() => of({ data: subjects })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    subjectsServiceMock.list.mockClear();
    subjectsServiceMock.create.mockReset();
    subjectsServiceMock.update.mockReset();
    subjectsServiceMock.delete.mockReset();
    subjectsServiceMock.list.mockReturnValue(of({ data: subjects }));

    await TestBed.configureTestingModule({
      imports: [SubjectManagerComponent],
      providers: [
        { provide: SubjectsService, useValue: subjectsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubjectManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders an inline error notice when delete fails', () => {
    subjectsServiceMock.delete.mockReturnValue(
      throwError(() => ({
        error: {
          error: '此科目有 11 門課程使用中，無法刪除',
        },
      })),
    );

    (component as unknown as { confirmDelete: (subject: Subject) => void }).confirmDelete(subjects[0]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('無法刪除');
    expect(fixture.nativeElement.textContent).toContain('此科目有 11 門課程使用中，無法刪除');
  });
});

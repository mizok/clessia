import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ExamsFilterDialogComponent } from './exams-filter-dialog.component';

describe('ExamsFilterDialogComponent', () => {
  let component: ExamsFilterDialogComponent;
  let fixture: ComponentFixture<ExamsFilterDialogComponent>;

  const close = vi.fn();

  beforeEach(async () => {
    close.mockClear();
    await TestBed.configureTestingModule({
      imports: [ExamsFilterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              initial: {
                examType: 'academy',
                schoolId: null,
                subjectId: null,
                status: 'all',
                timeRange: 'all',
              },
              options: {
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

  // #2290：共用殼 —— h2「篩選條件」是對話框的可及名稱；✕ 不套用、直接關（不回傳結果）
  it('共用殼：h2 標題，按關閉不套用', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-dialog-frame h2')?.textContent?.trim()).toBe('篩選條件');
    el.querySelector<HTMLButtonElement>('.dialog-header-inline__close')!.click();
    expect(close).toHaveBeenCalledWith();
  });
});

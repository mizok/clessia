import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { SchoolsService, type School } from '@core/schools.service';
import { SchoolFormDialogComponent } from './school-form-dialog.component';

/** #1314 SE4：表單的學制與狀態 */
describe('SchoolFormDialogComponent', () => {
  const create = vi.fn(() => of({ data: {} }));
  const update = vi.fn(() => of({ success: true }));

  async function render(editing: School | null) {
    create.mockClear();
    update.mockClear();
    await TestBed.configureTestingModule({
      imports: [SchoolFormDialogComponent],
      providers: [
        MessageService,
        { provide: SchoolsService, useValue: { create, update } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { editing } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SchoolFormDialogComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      name: { set(v: string): void };
      level: { (): string | null; set(v: string | null): void };
      submit(): void;
    };
  }

  it('新增預設學制是國中（A6），送出帶 level', async () => {
    const c = await render(null);
    expect(c.level()).toBe('junior');
    c.name.set('明湖國中');
    c.submit();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ level: 'junior' }));
  });

  it('編輯未分類的學校：不替它猜學制，原樣送 null', async () => {
    const c = await render({
      id: 's1',
      name: '某補校',
      shortName: null,
      level: null,
      isActive: true,
      studentCount: 0,
      createdAt: '',
      updatedAt: '',
    });
    expect(c.level()).toBeNull();
    c.submit();
    expect(update).toHaveBeenCalledWith('s1', expect.objectContaining({ level: null }));
  });

  it('改學制會送出新的值', async () => {
    const c = await render({
      id: 's1',
      name: '明湖國中',
      shortName: null,
      level: 'junior',
      isActive: true,
      studentCount: 0,
      createdAt: '',
      updatedAt: '',
    });
    c.level.set('senior');
    c.submit();
    expect(update).toHaveBeenCalledWith('s1', expect.objectContaining({ level: 'senior' }));
  });
});

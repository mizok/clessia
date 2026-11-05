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
  let el: HTMLElement;

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
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance as unknown as {
      name: { set(v: string): void };
      level: { (): string | null; set(v: string | null): void };
      submit(): void;
    };
  }

  it('共用殼（#2290）：新增寫「新增學校」；沒填全名時按儲存不送、左邊寫還差什麼', async () => {
    const c = await render(null);
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('新增學校');
    expect(el.querySelector('.form-dialog__why')?.textContent).toContain('還沒填：學校全名');
    c.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('編輯的標題寫簡稱（A6「編輯學校：明湖國中」）', async () => {
    await render({
      id: 's1',
      name: '台北市立明湖國中',
      shortName: '明湖國中',
      level: 'junior',
      isActive: true,
      studentCount: 0,
      createdAt: '',
      updatedAt: '',
    });
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('編輯學校：明湖國中');
  });

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

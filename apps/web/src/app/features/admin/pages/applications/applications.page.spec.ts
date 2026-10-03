import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  PublicApplicationsService,
  type PublicApplication,
} from '@core/public-applications.service';
import { ApplicationsPage } from './applications.page';

/**
 * #1245：管理端看公開申請。預設只列待處理（new＋contacted）；改狀態、寫備註；
 * 「建立家長」開既有的新增家長表單並預填 —— 不自動改狀態、不自動建學生或報名。
 */

const app = (extra: Partial<PublicApplication> = {}): PublicApplication => ({
  id: 'a1',
  kind: 'enrollment',
  status: 'new',
  createdAt: '2026-10-04T01:00:00Z',
  parent: { name: '王媽媽', email: null, phone: '0912345678', relation: 'mother' },
  student: { name: '王小明', grade: 'J2', school: '信義國中' },
  preferredStartDate: null,
  preferredTimes: null,
  note: '想週三上課',
  staffNote: null,
  targets: [
    { type: 'class', name: '國二數學 A', campusName: '信義校', isWaitlist: true, deleted: false },
    { type: 'class', name: null, campusName: null, isWaitlist: false, deleted: true },
  ],
  ...extra,
});

async function setup() {
  const service = {
    list: vi.fn().mockReturnValue(of({ data: [app()] })),
    update: vi.fn((_id: string, patch: object) =>
      of({ data: app(patch as Partial<PublicApplication>) }),
    ),
  };
  const dialog = { open: vi.fn().mockReturnValue({ onClose: of(undefined) }) };
  await TestBed.configureTestingModule({
    imports: [ApplicationsPage],
    providers: [
      { provide: PublicApplicationsService, useValue: service },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  })
    .overrideComponent(ApplicationsPage, {
      set: { providers: [{ provide: DialogService, useValue: dialog }] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(ApplicationsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, service, dialog, el: fixture.nativeElement as HTMLElement };
}

describe('ApplicationsPage（#1245）', () => {
  it('預設讀待處理；卡片有學生、家長、目標班（候補、已刪除）與家長備註', async () => {
    const { service, el } = await setup();

    expect(service.list).toHaveBeenCalledWith({ statuses: ['new', 'contacted'], kind: null });
    const card = el.querySelector('[data-testid="application-card"]')!;
    expect(card.textContent).toContain('王小明');
    expect(card.textContent).toContain('國二');
    expect(card.textContent).toContain('王媽媽（母親）');
    expect(card.textContent).toContain('國二數學 A');
    expect(card.textContent).toContain('候補');
    expect(card.textContent).toContain('已刪除的班');
    expect(card.textContent).toContain('想週三上課');
    expect(card.querySelector('a[href="tel:0912345678"]')).not.toBeNull();
  });

  it('改狀態送 PATCH', async () => {
    const { fixture, service } = await setup();

    (fixture.componentInstance as any).setStatus(app(), 'contacted');

    expect(service.update).toHaveBeenCalledWith('a1', { status: 'contacted' });
  });

  it('備註沒改不送；改了才送', async () => {
    const { fixture, service } = await setup();
    const page = fixture.componentInstance as any;

    page.saveNote(app(), '');
    expect(service.update).not.toHaveBeenCalled();
    page.saveNote(app(), ' 10/4 打過電話 ');
    expect(service.update).toHaveBeenCalledWith('a1', { staffNote: '10/4 打過電話' });
  });

  it('「建立家長」開新增家長表單、預填申請人；不改狀態', async () => {
    const { fixture, service, dialog } = await setup();

    (fixture.componentInstance as any).createParent(app());

    expect(dialog.open.mock.calls[0][1].data).toEqual({
      parent: null,
      prefill: { name: '王媽媽', email: null, phone: '0912345678' },
    });
    expect(service.update).not.toHaveBeenCalled();
  });
});

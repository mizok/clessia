import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

import { EnrollmentsService } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { StudentsService } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';
import { DirectEnrollDialogComponent } from './direct-enroll-dialog.component';

const STUDENT = { id: 'stu-1', name: '陳大同' };
const TEMPLATES = [
  { id: 'ft-m', name: '國中月繳', billingMode: 'monthly', amount: 3000 },
  { id: 'ft-p', name: '國中期繳', billingMode: 'period', amount: 15000 },
];

function setup() {
  const create = vi.fn((_input: unknown) => of({ data: { id: 'enr-new' } }));
  const add = vi.fn();
  const proto = HTMLDialogElement.prototype as any;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  TestBed.configureTestingModule({
    imports: [DirectEnrollDialogComponent],
    providers: [
      { provide: EnrollmentsService, useValue: { create } },
      { provide: StudentsService, useValue: { list: vi.fn(() => of({ data: [STUDENT] })) } },
      { provide: FeeTemplatesService, useValue: { list: () => of({ data: TEMPLATES }) } },
      { provide: SystemClockService, useValue: { todayTaipei: signal('2027-03-15') } },
      { provide: MessageService, useValue: { add } },
    ],
  });
  const fixture = TestBed.createComponent(DirectEnrollDialogComponent);
  fixture.componentRef.setInput('classes', [{ label: '國二數學 A', value: 'class-1' }]);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.open();
  fixture.detectChanges();
  const cmp = fixture.componentInstance as any;
  const el = fixture.nativeElement as HTMLElement;
  const fill = () => {
    cmp.onStudent(STUDENT);
    cmp.classId.set('class-1');
    fixture.detectChanges();
  };
  const hint = () => el.querySelector('[data-testid="direct-enroll-hint"]')?.textContent?.trim();
  return { fixture, cmp, el, create, add, closed, fill, hint };
}

describe('DirectEnrollDialogComponent（#1314 EN2）', () => {
  it('必填沒填：寫還差什麼、不送', () => {
    const { cmp, create, hint } = setup();
    expect(hint()).toBe('還沒填：學生、開課班');
    cmp.save();
    expect(create).not.toHaveBeenCalled();
  });

  it('只打字沒選到人不算選了學生', () => {
    const { cmp, fixture, hint } = setup();
    cmp.onStudent('陳');
    cmp.classId.set('class-1');
    fixture.detectChanges();
    expect(hint()).toBe('還沒填：學生');
  });

  it('送出建 active（計畫席 11-05 裁 (a)），生效起預設台北今天，迄留白＝null', () => {
    const { cmp, create, add, closed, fill } = setup();
    fill();
    cmp.save();
    expect(create).toHaveBeenCalledWith({
      classId: 'class-1',
      studentId: 'stu-1',
      status: 'active',
      effectiveFrom: '2027-03-15',
      effectiveTo: null,
      skipConflictCheck: false,
    });
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '已幫 陳大同 報名 國二數學 A' }),
    );
    expect(closed).toHaveBeenCalledWith({ id: 'enr-new' });
  });

  it('計費模式與方案一起送；方案只列選定模式的，換模式清掉方案', () => {
    const { cmp, create, fill } = setup();
    fill();
    cmp.onMode('monthly');
    expect(cmp.templateOptions().map((o: { value: string | null }) => o.value)).toEqual([
      null,
      'ft-m',
    ]);
    cmp.feeTemplateId.set('ft-m');
    cmp.save();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ billingMode: 'monthly', feeTemplateId: 'ft-m' }),
    );
    cmp.onMode('period');
    expect(cmp.feeTemplateId()).toBeNull();
  });

  it('生效迄早於生效起：不送', () => {
    const { cmp, create, fill, fixture, hint } = setup();
    fill();
    cmp.to.set('2027-03-01');
    fixture.detectChanges();
    expect(hint()).toBe('生效迄不能早於生效起');
    cmp.save();
    expect(create).not.toHaveBeenCalled();
  });

  it('409 撞課：列出衝突、按鈕變「仍要報名」，再按帶 skipConflictCheck', () => {
    const { cmp, create, fill, fixture, el, closed } = setup();
    fill();
    create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              conflictingClassId: 'c9',
              conflictingClassName: '國二英文',
              weekday: 2,
              startTime: '18:00:00',
              endTime: '19:30:00',
            },
          ],
        },
      })) as never,
    );
    cmp.save();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="direct-enroll-conflict"]')?.textContent).toContain(
      '國二英文 · 週二 18:00–19:30',
    );
    expect(el.querySelector('[data-testid="direct-enroll-submit"]')?.textContent?.trim()).toBe(
      '仍要報名',
    );
    expect(closed).not.toHaveBeenCalled();
    cmp.save();
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ skipConflictCheck: true }));
  });

  it('額滿：對話框內寫原因、不關', () => {
    const { cmp, create, fill, fixture, hint, closed } = setup();
    fill();
    create.mockReturnValueOnce(throwError(() => ({ error: { code: 'OVER_QUOTA' } })) as never);
    cmp.save();
    fixture.detectChanges();
    expect(hint()).toBe('這個班已經額滿');
    expect(closed).not.toHaveBeenCalled();
  });
});

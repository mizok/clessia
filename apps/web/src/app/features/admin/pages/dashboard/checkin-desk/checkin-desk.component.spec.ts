import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import type { WorkbenchExpectedStudent } from '@core/workbench.service';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { CheckinDeskComponent } from './checkin-desk.component';

const student = (id: string, name: string, grade: string | null): WorkbenchExpectedStudent => ({
  studentId: id,
  studentName: name,
  grade,
  campusId: 'c1',
  campusName: '本館',
  firstSession: { startTime: '14:00', className: '數學班 A' },
  primaryParent: null,
  lastContact: null,
});

describe('CheckinDeskComponent（櫃台代刷到班，#2314）', () => {
  function setup(candidates: WorkbenchExpectedStudent[]) {
    const fixture = TestBed.createComponent(CheckinDeskComponent);
    fixture.componentRef.setInput('candidates', candidates);
    fixture.detectChanges();
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    const submitBtn = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="checkin-desk-submit"]',
      ) as HTMLButtonElement;
    return { fixture, submitted, submitBtn };
  }

  it('選項是「姓名（年級）」；沒選人送出鈕停用，選了送出那一位', () => {
    const { fixture, submitted, submitBtn } = setup([
      student('a', '林小明', '七年級'),
      student('b', '王小華', null),
    ]);
    const field = fixture.debugElement.query(By.directive(SelectFieldComponent))
      .componentInstance as SelectFieldComponent<string>;
    expect(field.options().map((o) => o.label)).toEqual(['林小明（七年級）', '王小華']);
    // 稿：必填沒填不鎖死，左邊寫還差什麼；按了也不送
    expect(submitBtn().getAttribute('aria-disabled')).toBe('true');
    expect(fixture.nativeElement.querySelector('.form-dialog__why').textContent).toContain(
      '還沒填：學生（今天還沒到的）',
    );
    submitBtn().click();
    expect(submitted).not.toHaveBeenCalled();

    field.value.set('b');
    fixture.detectChanges();
    submitBtn().click();
    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ studentId: 'b' }));
  });

  it('沒有還沒到的人：下拉照畫但鎖住，框裡說原因（版面同稿）', () => {
    const { fixture } = setup([]);
    const field = fixture.debugElement.query(By.directive(SelectFieldComponent))
      .componentInstance as SelectFieldComponent<string>;
    expect(field.disabled()).toBe(true);
    expect(field.placeholder()).toContain('都到了或請假了');
  });
});

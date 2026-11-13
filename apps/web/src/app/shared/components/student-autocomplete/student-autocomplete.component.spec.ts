import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { onTestFinished, vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { AutoComplete } from 'primeng/autocomplete';

import { StudentAutocompleteComponent } from './student-autocomplete.component';

describe('StudentAutocompleteComponent', () => {
  let fixture: ComponentFixture<StudentAutocompleteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentAutocompleteComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentAutocompleteComponent);
    fixture.detectChanges();
  });

  it('does not force selection by default to avoid clearing IME input prematurely', () => {
    const autoComplete = fixture.debugElement.query(By.directive(AutoComplete))
      .componentInstance as AutoComplete;

    expect(autoComplete.forceSelection).toBe(false);
  });

  // #2468：placeholder 不是可及名稱 —— 三種接法都要落在真正的 input 上
  it('inputId／ariaLabelledBy／ariaLabel 落在真正的 input', () => {
    const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input().getAttribute('aria-label')).toBeNull();
    fixture.componentRef.setInput('inputId', 'stu-x');
    fixture.componentRef.setInput('ariaLabelledBy', 'lbl-x');
    fixture.componentRef.setInput('ariaLabel', '篩選學生');
    fixture.detectChanges();
    expect(input().id).toBe('stu-x');
    expect(input().getAttribute('aria-labelledby')).toBe('lbl-x');
    expect(input().getAttribute('aria-label')).toBe('篩選學生');
  });

  // #2205（使用者 11-03 裁定）：登記請假彈窗是 showModal() 的 top layer，手機改成內嵌清單
  describe('inline（#2205）', () => {
    const ac = () =>
      fixture.debugElement.query(By.directive(AutoComplete)).componentInstance as AutoComplete;
    const students = ['王一', '王二', '王三'].map((name, i) => ({ id: `s${i}`, name }) as never);

    it('預設不是內嵌：沒有 modifier、捲動照 PrimeNG 預設收起', () => {
      expect(ac().styleClass ?? '').not.toContain('student-autocomplete--inline');
      expect(ac().overlayOptions?.listener).toBeUndefined();
    });

    it('inline：掛 modifier、清單留在自己旁邊；捲動不收起，點外面照常收', () => {
      fixture.componentRef.setInput('inline', true);
      fixture.detectChanges();
      expect(ac().styleClass).toContain('student-autocomplete--inline');
      expect(ac().appendTo()).toBeUndefined(); // 預設 self：不掛 body（top layer 會蓋住）
      const listener = ac().overlayOptions!.listener!;
      const e = new Event('x');
      expect(listener(e, { type: 'scroll', mode: 'overlay', valid: true })).toBe(false);
      expect(listener(e, { type: 'outside', mode: 'overlay', valid: true })).toBe(true);
      expect(listener(e, { type: 'outside', mode: 'overlay', valid: false })).toBe(false);
    });

    it('inline：上下鍵選取照舊（aria-activedescendant 跟著移、Enter 選中）', async () => {
      // PrimeNG overlay 會查 matchMedia（jsdom 沒有）
      vi.stubGlobal('matchMedia', () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
      }));
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const picked: unknown[] = [];
      fixture.componentInstance.valueChange.subscribe((v) => picked.push(v));
      fixture.componentRef.setInput('inline', true);
      fixture.componentRef.setInput('suggestions', students);
      fixture.detectChanges();
      const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
      input.focus();
      input.dispatchEvent(new FocusEvent('focus'));
      ac().show();
      fixture.detectChanges();
      await fixture.whenStable();

      const key = (k: string) =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true }));
      key('ArrowDown');
      key('ArrowDown');
      fixture.detectChanges();
      expect(input.getAttribute('aria-activedescendant')).toMatch(/_1$/);
      key('Enter');
      fixture.detectChanges();
      expect(picked.at(-1)).toMatchObject({ id: 's1' });
    });

    // jsdom 不載全域樣式：直接讀 styles.css 守「內嵌版的 .p-overlay 排進版面、清單不內捲」，而且不分寬度
    it('styles.css：內嵌版的 .p-overlay 是 static、清單沒有 200px 上限（不包在 media query 裡）', () => {
      const css = readFileSync(join(resolve(process.cwd(), 'apps/web/src'), 'styles.css'), 'utf8');
      const block = css.match(
        /\n {2}\.student-autocomplete--inline \.p-overlay \{([^}]*)\}\s*\.student-autocomplete--inline \.p-autocomplete-list-container \{([^}]*)\}/,
      );
      expect(block).not.toBeNull();
      expect(block![1]).toMatch(/position:\s*static !important/);
      expect(block![2]).toMatch(/max-height:\s*none !important/);
      // 桌機浮動也會超出對話框底邊（計畫席 11-03）：不能再包回只在手機生效的 media query
      expect(css).not.toMatch(/@media[^{]*\{\s*\.student-autocomplete--inline/);
    });
  });

  it('formats student secondary metadata for duplicate-name disambiguation', () => {
    const component = fixture.componentInstance as any;

    expect(
      component.formatStudentMeta({
        id: 'student-1',
        orgId: 'org-1',
        name: '王小明',
        grade: 'J2',
        school: { id: 'school-1', name: '示範國中', shortName: null },
        birthday: null,
        gender: null,
        phone: null,
        email: null,
        address: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
        isActive: true,
        parentNames: [],
        campusNames: [],
        hasEnrollments: true,
        createdAt: '2026-04-02T00:00:00Z',
        updatedAt: '2026-04-02T00:00:00Z',
      }),
    ).toBe('國二 · 示範國中');
  });
});

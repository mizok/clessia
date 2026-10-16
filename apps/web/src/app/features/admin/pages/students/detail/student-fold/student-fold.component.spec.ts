import { TestBed } from '@angular/core/testing';

import { StudentFoldComponent } from './student-fold.component';

describe('StudentFoldComponent', () => {
  // #1705：A6 `.coll` 共用樣式；學生檔案的摺疊列（含帳單章）同一組，一次只開一個
  it('是 details.coll，name 跟帳單章同一組；標題與摘要在 coll__sum 裡', async () => {
    await TestBed.configureTestingModule({ imports: [StudentFoldComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StudentFoldComponent);
    fixture.componentRef.setInput('title', '成績');
    fixture.componentRef.setInput('meta', '3 科');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const details = el.querySelector('details.coll')!;
    expect(details.getAttribute('name')).toBe('student-folds');
    expect(details.querySelector('.coll__sum .coll__t')?.textContent?.trim()).toBe('成績');
    expect(details.querySelector('.coll__sum .coll__m')?.textContent?.trim()).toBe('3 科');
    expect(details.querySelector(':scope > .coll__body')).not.toBeNull();
  });
});

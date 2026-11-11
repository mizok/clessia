import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PageDialogRef, formPageLeaveGuard } from './form-page.util';

/** #2396 L4：整頁表單的 ref —— close 回來源頁 */
describe('PageDialogRef', () => {
  const ref = (previous: boolean) => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), PageDialogRef] });
    const router = TestBed.inject(Router);
    vi.spyOn(router as any, 'lastSuccessfulNavigation', 'get').mockReturnValue(() => ({
      previousNavigation: previous ? {} : null,
    }));
    const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const pageRef = TestBed.inject(PageDialogRef);
    pageRef.fallback = ['/admin/courses'];
    return { pageRef, back, navigate };
  };

  afterEach(() => TestBed.resetTestingModule());

  it('站內進來：上一頁；帶結果＝已存', () => {
    const { pageRef, back, navigate } = ref(true);
    pageRef.close({ classId: 'x' });
    expect(back).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(pageRef.saved).toBe(true);
  });

  it('直接打網址進來：導到後備頁；取消不算已存', () => {
    const { pageRef, back, navigate } = ref(false);
    pageRef.close();
    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/admin/courses']);
    expect(pageRef.saved).toBe(false);
  });

  it('離開保護 guard 問頁面的 canLeave', () => {
    const guard = (answer: boolean) =>
      formPageLeaveGuard({ canLeave: () => answer }, null!, null!, null!);
    expect(guard(true)).toBe(true);
    expect(guard(false)).toBe(false);
  });
});

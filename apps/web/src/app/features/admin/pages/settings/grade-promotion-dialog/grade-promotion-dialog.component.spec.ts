import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { GradePromotionsService, type GradePromotionPreview } from '@core/grade-promotions.service';

import { GradePromotionDialogComponent } from './grade-promotion-dialog.component';

const PREVIEW: GradePromotionPreview = {
  academicYear: 115,
  alreadyPromoted: false,
  transitions: [
    { from: 'J3', to: 'S1', count: 13 },
    { from: 'S3', to: null, count: 2 },
  ],
  promotedCount: 13,
  graduatedCount: 2,
  schoolMismatch: [{ studentId: 's-1', name: '林小華', schoolName: '明湖國中', newGrade: 'S1' }],
  graduatesWithEnrollments: [
    { studentId: 's-2', name: '陳大同', classNames: ['高三數學', '高三英文'] },
  ],
};

describe('GradePromotionDialogComponent', () => {
  let fixture: ComponentFixture<GradePromotionDialogComponent>;
  const service = { preview: vi.fn(), execute: vi.fn() };
  const ref = { close: vi.fn() };

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [GradePromotionDialogComponent],
      providers: [
        provideRouter([]),
        { provide: GradePromotionsService, useValue: service },
        { provide: DynamicDialogRef, useValue: ref },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GradePromotionDialogComponent);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const button = (label: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    service.preview.mockReturnValue(of(PREVIEW));
  });

  it('預覽列出各變動人數、學校要更新、高三有在籍報名', async () => {
    await setup();

    expect(text()).toContain('國三 → 高一');
    expect(text()).toContain('13 位');
    expect(text()).toContain('高三 → 畢業');
    expect(text()).toContain('學校要更新（1 位）');
    expect(text()).toContain('林小華');
    expect(text()).toContain('高三還有在籍報名（1 位）');
    expect(text()).toContain('高三數學、高三英文');
  });

  /** 設計稿 §2：確認鈕寫死後果 */
  it('確認鈕寫出後果，按下才執行', async () => {
    await setup();

    const confirm = button('把 13 位學生升一個年級；2 位高三改成停用（畢業）');
    expect(confirm).toBeTruthy();
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('執行完換成完成畫面，名單還在；關閉回傳 true', async () => {
    service.execute.mockReturnValue(
      of({ promotionId: 'gp-1', academicYear: 115, promotedCount: 13, graduatedCount: 2 }),
    );
    await setup();

    button('把 13 位')!.click();
    fixture.detectChanges();

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(text()).toContain('學年升級完成');
    expect(text()).toContain('林小華');
    expect(button('把 13 位')).toBeUndefined();
    button('關閉')!.click();
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('已經升過：不給執行鈕', async () => {
    service.preview.mockReturnValue(of({ ...PREVIEW, alreadyPromoted: true }));
    await setup();

    expect(text()).toContain('115 學年已經升級過了');
    expect(button('把 13 位')).toBeUndefined();
  });

  it('執行失敗（409）：訊息留在對話框，還沒執行 → 關閉回傳 false', async () => {
    service.execute.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: '115 學年已經升級過了', code: 'ALREADY_PROMOTED' },
          }),
      ),
    );
    await setup();

    button('把 13 位')!.click();
    fixture.detectChanges();

    expect(text()).toContain('115 學年已經升級過了');
    button('取消')!.click();
    expect(ref.close).toHaveBeenCalledWith(false);
  });

  it('預覽讀不到：顯示失敗態，不畫執行鈕', async () => {
    service.preview.mockReturnValue(throwError(() => new Error('boom')));
    await setup();

    expect(text()).toContain('載入失敗');
    expect(button('把')).toBeUndefined();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InlineNoticeComponent } from './inline-notice.component';

describe('InlineNoticeComponent', () => {
  let component: InlineNoticeComponent;
  let fixture: ComponentFixture<InlineNoticeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InlineNoticeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineNoticeComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // 全站 32 個使用點沒有一個依賴這個預設值（都明寫 severity），改這個值對現有
  // 畫面零影響——這條測試釘住的是「忘記指定時」的失效方向：不夠醒目，不是假警報
  it('沒指定 severity 時預設是 info，不是 error', () => {
    fixture.detectChanges();
    const root = fixture.nativeElement.querySelector('.inline-notice');
    expect(root.classList).toContain('inline-notice--info');
    expect(root.classList).not.toContain('inline-notice--error');
  });
});

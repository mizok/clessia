import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

import { PageBandComponent } from './page-band.component';

describe('PageBandComponent', () => {
  let fixture: ComponentFixture<PageBandComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageBandComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PageBandComponent);
    await fixture.whenStable();
  });

  const flowField = (): FlowFieldComponent | null =>
    fixture.debugElement.query(By.directive(FlowFieldComponent))?.componentInstance ?? null;

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  // D 明令「資料表格後面永遠不放持續動態」。這條規則寫死在元件裡而不是文件裡，
  // 所以要有測試釘住 —— 誰把 frozen 改成可設定的，這裡會紅。
  it('流場一律凍結，呼叫端關不掉', () => {
    expect(flowField()?.frozen()).toBe(true);
  });

  it('密度預設是登入頁的三分之一', () => {
    expect(flowField()?.density()).toBeCloseTo(0.28);
  });

  it('密度設 0 就完全不掛流場（儀表板那種帶裡已經有資訊圖時用）', async () => {
    fixture.componentRef.setInput('fieldDensity', 0);
    await fixture.whenStable();

    expect(flowField()).toBeNull();
  });
});

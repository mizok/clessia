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
});

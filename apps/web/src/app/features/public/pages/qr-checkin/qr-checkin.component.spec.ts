import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QrCheckinComponent } from './qr-checkin.component';

describe('QrCheckinComponent', () => {
  let component: QrCheckinComponent;
  let fixture: ComponentFixture<QrCheckinComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QrCheckinComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(QrCheckinComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

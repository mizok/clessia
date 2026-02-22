import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PaymentsPage } from './payments.page';

describe('PaymentsPage', () => {
  let component: PaymentsPage;
  let fixture: ComponentFixture<PaymentsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaymentsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

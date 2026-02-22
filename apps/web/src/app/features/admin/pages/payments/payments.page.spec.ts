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
    fixture.componentRef.setInput('page', { label: 'Test', relativePath: '', absolutePath: '', role: undefined, icon: '', showInMenu: true });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

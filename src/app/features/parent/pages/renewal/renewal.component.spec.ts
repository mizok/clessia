import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RenewalComponent } from './renewal.component';

describe('RenewalComponent', () => {
  let component: RenewalComponent;
  let fixture: ComponentFixture<RenewalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RenewalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RenewalComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

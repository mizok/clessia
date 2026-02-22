import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LeavePage } from './leave.page';

describe('LeavePage', () => {
  let component: LeavePage;
  let fixture: ComponentFixture<LeavePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeavePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LeavePage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

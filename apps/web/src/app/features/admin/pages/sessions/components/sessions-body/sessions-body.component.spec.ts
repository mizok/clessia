import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionsBodyComponent } from './sessions-body.component';

describe('SessionsBodyComponent', () => {
  let component: SessionsBodyComponent;
  let fixture: ComponentFixture<SessionsBodyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionsBodyComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsBodyComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentDate', new Date('2026-03-07T00:00:00.000Z'));
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionsHeaderComponent } from './sessions-header.component';

describe('SessionsHeaderComponent', () => {
  let component: SessionsHeaderComponent;
  let fixture: ComponentFixture<SessionsHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionsHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsHeaderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentDate', new Date('2026-03-07T00:00:00.000Z'));
    fixture.componentRef.setInput('weekLabel', '本週');
    fixture.componentRef.setInput('dayLabel', '今天');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

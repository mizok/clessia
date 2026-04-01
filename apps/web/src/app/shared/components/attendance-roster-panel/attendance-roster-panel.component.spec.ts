import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AttendanceRosterPanelComponent } from './attendance-roster-panel.component';

describe('AttendanceRosterPanelComponent', () => {
  let component: AttendanceRosterPanelComponent;
  let fixture: ComponentFixture<AttendanceRosterPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AttendanceRosterPanelComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AttendanceRosterPanelComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

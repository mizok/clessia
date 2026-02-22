import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SchedulePage } from './schedule.page';

describe('SchedulePage', () => {
  let component: SchedulePage;
  let fixture: ComponentFixture<SchedulePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchedulePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SchedulePage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: 'Test', relativePath: '', absolutePath: '', role: undefined, icon: '', showInMenu: true });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

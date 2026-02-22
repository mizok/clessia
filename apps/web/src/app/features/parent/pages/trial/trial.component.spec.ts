import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrialComponent } from './trial.component';

describe('TrialComponent', () => {
  let component: TrialComponent;
  let fixture: ComponentFixture<TrialComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrialComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TrialComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: 'Test', relativePath: '', absolutePath: '', role: undefined, icon: '', showInMenu: true });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

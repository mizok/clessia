import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AcademyExamsComponent } from './academy-exams.component';

describe('AcademyExamsComponent', () => {
  let component: AcademyExamsComponent;
  let fixture: ComponentFixture<AcademyExamsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AcademyExamsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AcademyExamsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '補習班考試',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

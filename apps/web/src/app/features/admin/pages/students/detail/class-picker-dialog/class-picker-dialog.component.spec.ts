import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClassPickerDialogComponent } from './class-picker-dialog.component';

describe('ClassPickerDialogComponent', () => {
  let component: ClassPickerDialogComponent;
  let fixture: ComponentFixture<ClassPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClassPickerDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClassPickerDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

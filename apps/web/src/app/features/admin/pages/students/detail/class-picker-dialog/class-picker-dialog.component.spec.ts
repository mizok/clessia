import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ClassPickerDialogComponent } from './class-picker-dialog.component';
import { ClassesService } from '@core/classes.service';

describe('ClassPickerDialogComponent', () => {
  let component: ClassPickerDialogComponent;
  let fixture: ComponentFixture<ClassPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClassPickerDialogComponent],
      providers: [
        {
          provide: ClassesService,
          useValue: { list: () => of({ data: [], meta: { total: 0 } }) },
        },
        { provide: DynamicDialogRef, useValue: { close: () => undefined } },
        { provide: DynamicDialogConfig, useValue: { data: {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassPickerDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

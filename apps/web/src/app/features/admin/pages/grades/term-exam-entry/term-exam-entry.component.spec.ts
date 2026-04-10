import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TermExamEntryComponent } from './term-exam-entry.component';

describe('TermExamEntryComponent', () => {
  let component: TermExamEntryComponent;
  let fixture: ComponentFixture<TermExamEntryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TermExamEntryComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TermExamEntryComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '段考登錄',
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

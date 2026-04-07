import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AutoComplete } from 'primeng/autocomplete';

import { StudentAutocompleteComponent } from './student-autocomplete.component';

describe('StudentAutocompleteComponent', () => {
  let fixture: ComponentFixture<StudentAutocompleteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentAutocompleteComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentAutocompleteComponent);
    fixture.detectChanges();
  });

  it('does not force selection by default to avoid clearing IME input prematurely', () => {
    const autoComplete = fixture.debugElement.query(By.directive(AutoComplete)).componentInstance as AutoComplete;

    expect(autoComplete.forceSelection).toBe(false);
  });

  it('formats student secondary metadata for duplicate-name disambiguation', () => {
    const component = fixture.componentInstance as any;

    expect(
      component.formatStudentMeta({
        id: 'student-1',
        orgId: 'org-1',
        name: '王小明',
        grade: 'J2',
        school: '示範國中',
        birthday: null,
        gender: null,
        phone: null,
        email: null,
        address: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
        isActive: true,
        parentNames: [],
        campusNames: [],
        hasEnrollments: true,
        createdAt: '2026-04-02T00:00:00Z',
        updatedAt: '2026-04-02T00:00:00Z',
      }),
    ).toBe('國二 · 示範國中');
  });
});

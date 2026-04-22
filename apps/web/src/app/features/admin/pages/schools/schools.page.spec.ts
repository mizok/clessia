import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SchoolsPage } from './schools.page';

describe('SchoolsPage', () => {
  let component: SchoolsPage;
  let fixture: ComponentFixture<SchoolsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchoolsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SchoolsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CampusesPage } from './campuses.page';

describe('CampusesPage', () => {
  let component: CampusesPage;
  let fixture: ComponentFixture<CampusesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampusesPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CampusesPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

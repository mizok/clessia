import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentsPage } from './parents.page';

describe('ParentsPage', () => {
  let component: ParentsPage;
  let fixture: ComponentFixture<ParentsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: 'Test', relativePath: '', absolutePath: '', role: undefined, icon: '', showInMenu: true });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MealsComponent } from './meals.component';

describe('MealsComponent', () => {
  let component: MealsComponent;
  let fixture: ComponentFixture<MealsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MealsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MealsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: 'Test', relativePath: '', absolutePath: '', role: undefined, icon: '', showInMenu: true });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

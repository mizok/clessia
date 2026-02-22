import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectRoleComponent } from './select-role.component';

describe('SelectRoleComponent', () => {
  let component: SelectRoleComponent;
  let fixture: ComponentFixture<SelectRoleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectRoleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SelectRoleComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

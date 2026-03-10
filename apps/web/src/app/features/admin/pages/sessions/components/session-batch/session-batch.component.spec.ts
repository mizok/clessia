import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionBatchComponent } from './session-batch.component';

describe('SessionBatchComponent', () => {
  let component: SessionBatchComponent;
  let fixture: ComponentFixture<SessionBatchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionBatchComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SessionBatchComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

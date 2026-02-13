import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommunicationPage } from './communication.page';

describe('CommunicationPage', () => {
  let component: CommunicationPage;
  let fixture: ComponentFixture<CommunicationPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommunicationPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CommunicationPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

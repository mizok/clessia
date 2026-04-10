import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScoreRecordsComponent } from './score-records.component';

describe('ScoreRecordsComponent', () => {
  let component: ScoreRecordsComponent;
  let fixture: ComponentFixture<ScoreRecordsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScoreRecordsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ScoreRecordsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '成績查閱',
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

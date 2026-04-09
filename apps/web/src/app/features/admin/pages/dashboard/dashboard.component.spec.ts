import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    fixture.componentRef.setInput('page', {
      label: '總覽',
      relativePath: '',
      absolutePath: '/admin',
      role: undefined,
      icon: 'pi pi-home',
      showInMenu: true,
    });
    fixture.detectChanges();
  });

  it('renders static dashboard sections and empty states', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('總覽');
    expect(text).toContain('今日課表');
    expect(text).toContain('今日尚無排課');
    expect(text).toContain('待確認請假');
    expect(text).toContain('待審核報名');
  });
});

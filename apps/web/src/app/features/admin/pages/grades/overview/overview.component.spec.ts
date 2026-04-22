import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';

import { OverviewComponent } from './overview.component';

describe('OverviewComponent', () => {
  let fixture: ComponentFixture<OverviewComponent>;
  let component: OverviewComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders portal buttons for student and class views', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const portals = host.querySelectorAll('.overview__portal');

    expect(portals.length).toBe(2);
    expect(portals[0].textContent).toContain('學生視角');
    expect(portals[1].textContent).toContain('班級視角');
  });

  it('navigates to student view on portal click', () => {
    fixture.detectChanges();
    const spy = vi.spyOn(router, 'navigate');

    component['goTo']('student');

    expect(spy).toHaveBeenCalledWith(['/admin/grades/overview', 'student']);
  });

  it('navigates to class view on portal click', () => {
    fixture.detectChanges();
    const spy = vi.spyOn(router, 'navigate');

    component['goTo']('class');

    expect(spy).toHaveBeenCalledWith(['/admin/grades/overview', 'class']);
  });
});

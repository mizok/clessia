import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageBreadcrumbComponent, type BreadcrumbItem } from './page-breadcrumb.component';

describe('PageBreadcrumbComponent', () => {
  let fixture: ComponentFixture<PageBreadcrumbComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageBreadcrumbComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(PageBreadcrumbComponent);
  });

  it('renders all items', () => {
    const items: BreadcrumbItem[] = [
      { label: '學務管理' },
      { label: '學生', routerLink: '/admin/students' },
      { label: '王小明' },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('學務管理');
    expect(el.textContent).toContain('學生');
    expect(el.textContent).toContain('王小明');
  });

  it('last item has no routerLink', () => {
    const items: BreadcrumbItem[] = [
      { label: '學生', routerLink: '/admin/students' },
      { label: '王小明' },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('a');
    expect(links.length).toBe(1); // 只有第一項有連結
  });
});

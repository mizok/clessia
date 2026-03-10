import { Component, TemplateRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResponsiveTableComponent } from './responsive-table.component';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from './responsive-table.models';
import { RtColDefDirective } from './rt-col-def.directive';
import { RtColCellDirective } from './rt-col-cell.directive';
import { RtRowDirective } from './rt-row.directive';

interface StudentRow {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly address: string;
}

let mockedWidth = 960;
const resizeObservers = new Set<MockResizeObserver>();

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this);
  }

  observe(): void {
    this.emit();
  }

  unobserve(): void {}

  disconnect(): void {
    resizeObservers.delete(this);
  }

  emit(): void {
    const entry = {
      contentRect: { width: mockedWidth },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function triggerResize(width: number): void {
  mockedWidth = width;
  resizeObservers.forEach((observer) => observer.emit());
}

@Component({
  standalone: true,
  imports: [ResponsiveTableComponent, RtColDefDirective, RtColCellDirective, RtRowDirective],
  template: `
    <app-responsive-table
      [headTemplate]="headTemplate"
      [bodyTemplate]="bodyTemplate"
      [accordionBehavior]="accordionBehavior"
      [pagination]="pagination"
      (page)="onPageChange($event)"
    />

    <ng-template #headTemplate>
      <tr>
        <th appRtColDef="name" [appRtColDefMinWidth]="160" [appRtColDefPriority]="1">姓名</th>
        <th appRtColDef="phone" [appRtColDefMinWidth]="160" [appRtColDefPriority]="2">電話</th>
        <th appRtColDef="address" [appRtColDefMinWidth]="220" [appRtColDefPriority]="3">地址</th>
      </tr>
    </ng-template>

    <ng-template #bodyTemplate let-state="state">
      @for (student of students; track student.id) {
        <tr appRtRow [appRtRow]="student" [appRtRowId]="student.id">
          <td appRtColCell="name">{{ student.name }}</td>
          <td appRtColCell="phone">{{ student.phone }}</td>
          <td appRtColCell="address">
            <button class="address-action" type="button" (click)="onAddressClick(student.id)">
              {{ student.address }}
            </button>
          </td>
        </tr>
      }
    </ng-template>
  `,
})
class HostComponent {
  protected readonly students: readonly StudentRow[] = [
    { id: 's1', name: '王小明', phone: '0912-111-111', address: '台北市中山區' },
    { id: 's2', name: '陳小華', phone: '0922-222-222', address: '新北市板橋區' },
  ];

  accordionBehavior: 'multi' | 'accordion' = 'multi';
  pagination: ResponsiveTablePaginationConfig | null = null;
  clickedIds: string[] = [];
  pageEvents: ResponsiveTablePageEvent[] = [];

  onAddressClick(studentId: string): void {
    this.clickedIds = [...this.clickedIds, studentId];
  }

  onPageChange(event: ResponsiveTablePageEvent): void {
    this.pageEvents = [...this.pageEvents, event];
  }
}

@Component({
  standalone: true,
  imports: [ResponsiveTableComponent, RtColDefDirective, RtColCellDirective, RtRowDirective],
  template: `
    <app-responsive-table [headTemplate]="headTemplate" [bodyTemplate]="bodyTemplate" />

    <ng-template #headTemplate>
      <tr>
        <th appRtColDef="name" [appRtColDefMinWidth]="160" [appRtColDefPriority]="1">姓名</th>
        <th appRtColDef="name" [appRtColDefMinWidth]="160" [appRtColDefPriority]="2">電話</th>
      </tr>
    </ng-template>

    <ng-template #bodyTemplate>
      <tr appRtRow [appRtRow]="{ id: 's1', name: '王小明' }" appRtRowId="s1">
        <td appRtColCell="name">王小明</td>
      </tr>
    </ng-template>
  `,
})
class DuplicateColumnHostComponent {
  @ViewChild('headTemplate', { static: true })
  protected readonly headTemplate!: TemplateRef<unknown>;

  @ViewChild('bodyTemplate', { static: true })
  protected readonly bodyTemplate!: TemplateRef<unknown>;
}

describe('ResponsiveTableComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = MockResizeObserver;
    resizeObservers.clear();
    mockedWidth = 960;

    await TestBed.configureTestingModule({
      imports: [HostComponent, DuplicateColumnHostComponent],
    }).compileComponents();
  });

  it('throws when duplicate column keys are defined', () => {
    const duplicatedFixture = TestBed.createComponent(DuplicateColumnHostComponent);
    expect(() => duplicatedFixture.detectChanges()).toThrowError(/duplicate column key/i);
  });

  it('collapses low priority columns based on available width', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    triggerResize(360);
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const hiddenHeader = hostElement.querySelector(
      'th[data-rt-col-key="address"]',
    ) as HTMLElement | null;
    const hiddenCell = hostElement.querySelector(
      'td[data-rt-col-cell-key="address"]',
    ) as HTMLElement | null;

    expect(hiddenHeader?.style.display).toBe('none');
    expect(hiddenCell?.style.display).toBe('none');

    const expandHeader = hostElement.querySelector(
      'th.responsive-table__expand-header',
    ) as HTMLTableCellElement | null;
    expect(expandHeader).toBeTruthy();
  });

  it('auto-renders expand control and detail row in multi mode', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    triggerResize(360);
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const firstRow = hostElement.querySelector('tbody tr[appRtRow]') as HTMLTableRowElement | null;
    const expandButton = firstRow?.querySelector(
      'button.responsive-table__expand-button',
    ) as HTMLButtonElement | null;

    expect(expandButton).toBeTruthy();
    expandButton?.click();
    fixture.detectChanges();

    const detailRows = hostElement.querySelectorAll('tr.responsive-table__detail-row');
    expect(detailRows.length).toBe(1);
    expect(detailRows[0]?.textContent).toContain('台北市中山區');
    const detailActionButton = detailRows[0]?.querySelector(
      '.address-action',
    ) as HTMLButtonElement | null;
    expect(detailActionButton).toBeTruthy();
    detailActionButton?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.clickedIds).toEqual(['s1']);
  });

  it('keeps only one detail row expanded in accordion mode', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.accordionBehavior = 'accordion';
    fixture.detectChanges();

    triggerResize(360);
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const buttons = hostElement.querySelectorAll(
      'button.responsive-table__expand-button',
    ) as NodeListOf<HTMLButtonElement>;

    expect(buttons.length).toBeGreaterThanOrEqual(2);

    buttons[0]?.click();
    fixture.detectChanges();
    buttons[1]?.click();
    fixture.detectChanges();

    const detailRows = hostElement.querySelectorAll('tr.responsive-table__detail-row');
    expect(detailRows.length).toBe(1);
  });

  it('renders paginator when pagination config is provided', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.pagination = {
      first: 0,
      rows: 10,
      totalRecords: 25,
    };
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const paginator = hostElement.querySelector('.p-paginator');
    expect(paginator).toBeTruthy();
  });

  it('does not render paginator when pagination config is null', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.pagination = null;
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const paginator = hostElement.querySelector('.p-paginator');
    expect(paginator).toBeFalsy();
  });

  it('emits page event when paginator changes page', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.pagination = {
      first: 0,
      rows: 1,
      totalRecords: 10,
    };
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const nextButton = hostElement.querySelector('.p-paginator-next') as HTMLButtonElement | null;
    expect(nextButton).toBeTruthy();

    nextButton?.click();
    fixture.detectChanges();

    const [event] = fixture.componentInstance.pageEvents;
    expect(event).toBeTruthy();
    expect(event?.first).toBe(1);
    expect(event?.rows).toBe(1);
    expect(event?.page).toBe(1);
    expect(event?.pageCount).toBe(10);
  });

  it('clears expanded detail rows after paginator changes page', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.pagination = {
      first: 0,
      rows: 1,
      totalRecords: 10,
    };
    fixture.detectChanges();

    triggerResize(360);
    fixture.detectChanges();

    const hostElement = fixture.nativeElement as HTMLElement;
    const firstRow = hostElement.querySelector('tbody tr[appRtRow]') as HTMLTableRowElement | null;
    const expandButton = firstRow?.querySelector(
      'button.responsive-table__expand-button',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    expandButton?.click();
    fixture.detectChanges();
    expect(hostElement.querySelectorAll('tr.responsive-table__detail-row').length).toBe(1);

    const nextButton = hostElement.querySelector('.p-paginator-next') as HTMLButtonElement | null;
    expect(nextButton).toBeTruthy();
    nextButton?.click();
    fixture.detectChanges();

    expect(hostElement.querySelectorAll('tr.responsive-table__detail-row').length).toBe(0);
  });
});

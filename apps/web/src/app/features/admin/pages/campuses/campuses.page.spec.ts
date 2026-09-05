import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { vi } from 'vitest';

import { CampusesPage } from './campuses.page';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

describe('CampusesPage', () => {
  let component: CampusesPage;
  let fixture: ComponentFixture<CampusesPage>;
  const buildCampusResponse = (
    overrides?: Partial<{
      data: Campus[];
      meta: { total: number; page: number; pageSize: number; totalPages: number };
      summary: { total: number; activeCount: number; inactiveCount: number };
    }>,
  ) => ({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    summary: { total: 0, activeCount: 0, inactiveCount: 0 },
    ...overrides,
  });
  const campusesServiceMock = {
    list: vi.fn(() => of(buildCampusResponse())),
    delete: vi.fn(() => of({})),
  };

  beforeEach(async () => {
    campusesServiceMock.list.mockReset();
    campusesServiceMock.list.mockReturnValue(of(buildCampusResponse()));

    await TestBed.configureTestingModule({
      imports: [CampusesPage],
      providers: [
        {
          provide: CampusesService,
          useValue: campusesServiceMock,
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampusesPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('用共用的整頁列表頁大小，不自己訂一個', () => {
    expect((component as unknown as { PAGE_SIZE: number }).PAGE_SIZE).toBe(LIST_PAGE_SIZE);
  });

  it('shows summary counts returned by the API', () => {
    const campuses = [
      {
        id: 'campus-1',
        orgId: 'org-1',
        name: '台北校',
        address: null,
        phone: null,
        isActive: true,
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      },
    ] satisfies Campus[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { campuses: { set: (value: Campus[]) => void } }).campuses.set(
      campuses,
    );
    (
      component as unknown as {
        summary: {
          set: (value: { total: number; activeCount: number; inactiveCount: number }) => void;
        };
      }
    ).summary.set({
      total: 38,
      activeCount: 33,
      inactiveCount: 5,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.campuses__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues).toEqual(['38', '33', '5']);
  });

  // 分校刪除是連動最廣的操作（courses CASCADE），但選單裡原本跟「編輯」同一個
  // 字重——使用者按下去之前完全感覺不到量級。這條釘住視覺升級不會被之後的改動悄悄拿掉。
  it('刪除分校在選單裡用紅字並跟其他項目分隔，不是跟編輯同一個字重', () => {
    const campus: Campus = {
      id: 'campus-1',
      orgId: 'org-1',
      name: '台北校',
      address: null,
      phone: null,
      isActive: true,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
    (
      component as unknown as { selectedCampus: { set: (value: Campus) => void } }
    ).selectedCampus.set(campus);

    const items = (
      component as unknown as {
        actionMenuItems: () => { label?: string; itemClass?: string; separator?: boolean }[];
      }
    ).actionMenuItems();

    const deleteIndex = items.findIndex((item) => item.label === '刪除分校');
    expect(deleteIndex).toBeGreaterThan(0);
    expect(items[deleteIndex].itemClass).toBe('text-red-500');
    expect(items[deleteIndex - 1].separator).toBe(true);
  });
});

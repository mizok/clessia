import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService } from '@core/campuses.service';
import { StaffService } from '@core/staff.service';
import { SubjectsService } from '@core/subjects.service';
import type { Staff } from '@core/staff.service';
import { vi } from 'vitest';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';

import { StaffPage } from './staff.page';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

describe('StaffPage', () => {
  let component: StaffPage;
  let fixture: ComponentFixture<StaffPage>;
  const buildStaffResponse = (
    overrides?: Partial<{
      data: Staff[];
      meta: { total: number; page: number; pageSize: number; totalPages: number };
      summary: {
        total: number;
        adminCount: number;
        teacherCount: number;
        activeCount: number;
        inactiveCount: number;
        archivedCount: number;
      };
    }>,
  ) => ({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    summary: {
      total: 0,
      adminCount: 0,
      teacherCount: 0,
      activeCount: 0,
      inactiveCount: 0,
      archivedCount: 0,
    },
    ...overrides,
  });
  const staffServiceMock = {
    list: vi.fn(() => of(buildStaffResponse())),
    createLoginLink: vi.fn(() => of({ url: 'https://x/verify?token=t', expiresInSeconds: 86400 })),
  };
  const dialogServiceMock = { open: vi.fn(() => ({ onClose: of(undefined) })) };

  beforeEach(async () => {
    staffServiceMock.list.mockReset();
    staffServiceMock.list.mockReturnValue(of(buildStaffResponse()));
    staffServiceMock.createLoginLink.mockClear();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [StaffPage],
      providers: [
        {
          provide: StaffService,
          useValue: staffServiceMock,
        },
        {
          provide: CampusesService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        {
          provide: SubjectsService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        {
          provide: DialogService,
          useValue: dialogServiceMock,
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => null,
          },
        },
      ],
    })
      // StaffPage 在 @Component 的 providers 裡自己給 DialogService，
      // 元件層級的 provider 會蓋過 TestBed 的 —— 必須用 overrideComponent 才換得掉
      .overrideComponent(StaffPage, {
        // set 會整個取代 providers 陣列 —— MessageService 必須一起帶上，否則元件建不起來
        set: {
          providers: [MessageService, { provide: DialogService, useValue: dialogServiceMock }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(StaffPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('用共用的整頁列表頁大小，不自己訂一個', () => {
    expect((component as unknown as { PAGE_SIZE: number }).PAGE_SIZE).toBe(LIST_PAGE_SIZE);
  });

  it('shows the total staff count in the summary card', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
        birthday: null,
        notes: null,
        subjectIds: [],
        subjectNames: [],
        status: 'active',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
        campusIds: [],
        roles: ['teacher'],
        permissions: [],
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (component as unknown as { total: { set: (value: number) => void } }).total.set(128);
    (
      component as unknown as {
        summary: {
          set: (value: {
            total: number;
            adminCount: number;
            teacherCount: number;
            activeCount: number;
            inactiveCount: number;
            archivedCount: number;
          }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 0,
      teacherCount: 1,
      activeCount: 1,
      inactiveCount: 0,
      archivedCount: 0,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues[0]).toBe('128');
  });

  it('shows summary counts returned by the API', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
        birthday: null,
        notes: null,
        subjectIds: [],
        subjectNames: [],
        status: 'active',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
        campusIds: [],
        roles: ['teacher'],
        permissions: [],
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (
      component as unknown as {
        summary: {
          set: (value: {
            total: number;
            adminCount: number;
            teacherCount: number;
            activeCount: number;
            inactiveCount: number;
            archivedCount: number;
          }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 7,
      teacherCount: 121,
      activeCount: 119,
      inactiveCount: 5,
      archivedCount: 4,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues).toEqual(['128', '7', '121', '119']);
  });

  /**
   * P1-4（Tester 抓到）：13 管理員 + 89 老師 ≠ 101 位人員，因為兼任的人兩邊
   * 各算一次——這是既定規格不是 bug，但畫面原本沒講，行政會停下來以為算錯。
   */
  describe('管理員／老師合併磚的兼任備註', () => {
    function setSummary(overrides: { multiRoleCount: number }) {
      const staff: Staff[] = [
        {
          id: 'staff-1',
          userId: 'user-1',
          orgId: 'org-1',
          displayName: '王老師',
          phone: null,
          email: 'wang@example.com',
          birthday: null,
          notes: null,
          subjectIds: [],
          subjectNames: [],
          status: 'active',
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T00:00:00.000Z',
          campusIds: [],
          roles: ['teacher'],
          permissions: [],
        },
      ];

      (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
      (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(
        staff,
      );
      (
        component as unknown as {
          summary: {
            set: (value: {
              total: number;
              adminCount: number;
              teacherCount: number;
              multiRoleCount: number;
              activeCount: number;
              inactiveCount: number;
              archivedCount: number;
            }) => void;
          };
        }
      ).summary.set({
        total: 101,
        adminCount: 13,
        teacherCount: 89,
        activeCount: 98,
        inactiveCount: 3,
        archivedCount: 0,
        ...overrides,
      });
      fixture.detectChanges();
    }

    it('有兼任人數時顯示備註，不用自己算', () => {
      setSummary({ multiRoleCount: 1 });

      const note = fixture.nativeElement.querySelector('.staff__stat-note');
      expect(note?.textContent?.trim()).toBe('（1 位身兼兩者）');
    });

    it('沒有兼任（0）時不顯示備註', () => {
      setSummary({ multiRoleCount: 0 });

      expect(fixture.nativeElement.querySelector('.staff__stat-note')).toBeNull();
    });
  });

  // 這個系統沒有密碼 —— 一次性登入連結是員工唯一的進門方式。
  // PR #24 的後端回傳了 loginUrl，但前端型別把它丟掉、頁面也沒有任何入口，
  // 新建的員工因此完全無法登入。
  describe('StaffPage 的登入連結', () => {
    const staff = { id: 's1', userId: 'u1', displayName: '王老師', status: 'active' } as Staff;
    it('產生連結會開 LoginLinkDialog 並帶入網址', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink(staff);
      expect(staffServiceMock.createLoginLink).toHaveBeenCalledWith('u1');
      expect(dialogServiceMock.open).toHaveBeenCalled();
      const lastCall = dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: { loginUrl: string; personName: string } },
      ];
      const [dialogComponent, config] = lastCall;
      expect(dialogComponent).toBe(LoginLinkDialogComponent);
      expect(config.data.loginUrl).toContain('token=t');
      expect(config.data.personName).toBe('王老師');
    });
    // 還沒有登入帳號的人產生不出連結 —— 要說清楚，不要靜靜地什麼都沒發生
    it('沒有 userId 時不呼叫 API', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink({
        ...staff,
        userId: '',
      } as Staff);
      expect(staffServiceMock.createLoginLink).not.toHaveBeenCalled();
    });
  });
});

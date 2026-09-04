import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService } from '@core/announcements.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { NotificationsComponent } from './notifications.component';

describe('ParentNotificationsComponent', () => {
  let fixture: ComponentFixture<NotificationsComponent>;

  const announcementsServiceMock = {
    inbox: vi.fn(() =>
      of({
        data: [
          {
            id: 'a1',
            title: '國一數學 A 班 調課通知',
            body: '1/30 的課堂已調整至 2/2',
            publishedAt: '2026-09-01T08:00:00Z',
            campusName: '台北分校',
            createdByName: '王主任',
            isRead: false,
          },
        ],
      }),
    ),
    markRead: vi.fn(() => of({})),
    markAllRead: vi.fn(() => of({})),
  };

  beforeEach(async () => {
    announcementsServiceMock.inbox.mockClear();

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [{ provide: AnnouncementsService, useValue: announcementsServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    fixture.componentRef.setInput('page', RoutesCatalog.PARENT_NOTIFICATIONS);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  // 這一頁原本是 empty-state 空殼（「這個功能還在準備中」）
  it('渲染的是真的收件匣，不是空殼', () => {
    expect(fixture.nativeElement.querySelector('.announcement-inbox')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('還在準備中');
  });

  it('公告內容出得來', () => {
    expect(fixture.nativeElement.textContent).toContain('國一數學 A 班 調課通知');
  });

  // 家長跟老師打同一支端點，伺服器依 audience 決定回哪些 —— 前端不帶角色參數
  it('用的是共用收件匣的同一支查詢，沒有另外傳角色', () => {
    expect(announcementsServiceMock.inbox).toHaveBeenCalledWith();
  });

  it('標題用路由的 label', () => {
    expect(fixture.nativeElement.textContent).toContain(RoutesCatalog.PARENT_NOTIFICATIONS.label);
  });
});

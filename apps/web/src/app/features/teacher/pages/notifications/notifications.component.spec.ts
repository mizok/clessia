import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService } from '@core/announcements.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { NotificationsComponent } from './notifications.component';

/**
 * 收件匣的**行為**由共用件自己的 spec 守（14 條，#291 從這裡逐條搬過去）。
 * 這一層只驗接線：真的掛上了共用件、標題來自路由、沒有多傳角色參數。
 */
describe('TeacherNotificationsComponent', () => {
  let fixture: ComponentFixture<NotificationsComponent>;

  const announcementsServiceMock = {
    inbox: vi.fn(() =>
      of({
        data: [
          {
            id: 'a1',
            title: '本週三停課',
            body: '因颱風假停課一天。',
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
    fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_NOTIFICATIONS);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('掛的是共用收件匣', () => {
    expect(fixture.nativeElement.querySelector('.announcement-inbox')).not.toBeNull();
  });

  it('公告內容出得來', () => {
    expect(fixture.nativeElement.textContent).toContain('本週三停課');
  });

  // 老師跟家長打同一支端點，伺服器依 audience 決定回哪些 —— 前端不帶角色參數
  it('沒有另外傳角色', () => {
    expect(announcementsServiceMock.inbox).toHaveBeenCalledWith();
  });

  it('標題用路由的 label', () => {
    expect(fixture.nativeElement.textContent).toContain(RoutesCatalog.TEACHER_NOTIFICATIONS.label);
  });
});

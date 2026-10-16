import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService } from './announcements.service';
import { AuthService, type UserRole } from './auth.service';
import { FOREGROUND_REFRESH_MS, InboxBadgeService } from './inbox-badge.service';
import { NotificationsService } from './notifications.service';

/**
 * #1683：頂欄鈴鐺的未讀角標。不輪詢、不每頁打 —— 只在身分出現／切換、回到前景（間隔 ≥ 60 秒）時抓。
 */
/** 依序回 unread；負數＝讀取失敗。最後一個值之後一直回最後一個 */
function inboxMock(unread: number[]) {
  const responses = [...unread];
  return vi.fn(() => {
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    return next < 0
      ? throwError(() => new Error('boom'))
      : of({ data: [], meta: { total: 0, unread: next } });
  });
}

function setup(role: UserRole | null, unread: number[] = [3], notifUnread: number[] = [0]) {
  const activeRole = signal<UserRole | null>(role);
  const inbox = inboxMock(unread);
  const notifInbox = inboxMock(notifUnread);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { activeRole } },
      { provide: AnnouncementsService, useValue: { inbox } },
      { provide: NotificationsService, useValue: { inbox: notifInbox } },
    ],
  });
  const badge = TestBed.inject(InboxBadgeService);
  TestBed.tick();
  return { badge, inbox, notifInbox, activeRole };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('InboxBadgeService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('家長／老師：身分一出現就抓一次，角標＝meta.unread', () => {
    for (const role of ['parent', 'teacher'] as const) {
      TestBed.resetTestingModule();
      const { badge, inbox } = setup(role, [3]);
      expect(inbox).toHaveBeenCalledTimes(1);
      expect(badge.unread()).toBe(3);
      expect(badge.hasInbox()).toBe(true);
    }
  });

  // 計畫席裁 (b)：管理員的通知等 #1692（「收到的」列表）一起上，不讓角標亮了卻清不掉
  it('管理員：兩支都不打、角標 0', () => {
    const { badge, inbox, notifInbox } = setup('admin', [3], [4]);
    expect(inbox).not.toHaveBeenCalled();
    expect(notifInbox).not.toHaveBeenCalled();
    expect(badge.unread()).toBe(0);
    expect(badge.hasInbox()).toBe(false);
  });

  it('沒有身分：兩支都不打', () => {
    const { inbox, notifInbox } = setup(null);
    expect(inbox).not.toHaveBeenCalled();
    expect(notifInbox).not.toHaveBeenCalled();
  });

  it('老師／家長：角標＝公告未讀＋通知未讀，兩支平行打', () => {
    const { badge, inbox, notifInbox } = setup('parent', [3], [2]);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(notifInbox).toHaveBeenCalledTimes(1);
    expect(badge.unread()).toBe(5);
  });

  it('一支讀取失敗只保留它自己的舊值，另一支照常更新（計畫席 gate）', () => {
    const { badge } = setup('parent', [3, 1], [2, -1]);
    vi.setSystemTime(Date.now() + FOREGROUND_REFRESH_MS);
    setVisibility('visible');
    expect(badge.unread()).toBe(1 + 2);
  });

  it('通知那支第一次就失敗：角標照樣顯示公告的數字', () => {
    const { badge } = setup('teacher', [3], [-1]);
    expect(badge.unread()).toBe(3);
  });

  it('切換身分：先歸零、再抓一次（上一個身分的數字對新身分是錯的）', () => {
    const { badge, inbox, activeRole } = setup('parent', [3, 7]);
    activeRole.set('teacher');
    TestBed.tick();
    expect(inbox).toHaveBeenCalledTimes(2);
    expect(badge.unread()).toBe(7);

    activeRole.set('admin');
    TestBed.tick();
    expect(badge.unread()).toBe(0); // 公告歸零、管理員不打；通知那支 mock 回 0
    expect(inbox).toHaveBeenCalledTimes(2);
  });

  it('回到前景：60 秒內不重抓，超過才抓；切到背景不抓', () => {
    const { badge, inbox } = setup('parent', [3, 5]);

    setVisibility('visible');
    expect(inbox).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + FOREGROUND_REFRESH_MS);
    setVisibility('hidden');
    expect(inbox).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(inbox).toHaveBeenCalledTimes(2);
    expect(badge.unread()).toBe(5);
  });

  it('讀取失敗：保留舊值，角標不消失', () => {
    const { badge } = setup('parent', [3, -1]);
    vi.setSystemTime(Date.now() + FOREGROUND_REFRESH_MS);
    setVisibility('visible');
    expect(badge.unread()).toBe(3);
  });

  it('收件匣寫回：直接用頁面讀到的數字，不另外打', () => {
    const { badge, inbox } = setup('parent', [3]);
    badge.setAnnouncementsUnread(1);
    expect(badge.unread()).toBe(1);
    badge.setAnnouncementsUnread(-2);
    expect(badge.unread()).toBe(0);
    badge.setNotificationsUnread(4);
    expect(badge.unread()).toBe(4);
    expect(inbox).toHaveBeenCalledTimes(1);
  });
});

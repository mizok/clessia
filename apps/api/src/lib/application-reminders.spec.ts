import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  LOOKBACK_DAYS,
  enqueueApplicationReminders,
  reminderNotifications,
  type ReminderCandidate,
} from './application-reminders';

/**
 * #1821 申請提醒的 JS 端：收件人、文案、鍵。日期門檻、「沒處理」與「已經報名」的判準在 SQL，
 * 由 `contract/application-reminders.contract.ts` 對真 DB 驗。
 */

const TODAY = '2026-10-22';

const overdue = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  stage: 'overdue',
  dedupe_key: 'overdue:parent_request:enrollment:r1',
  org_id: 'org-a',
  kind: 'enrollment',
  student_name: '王小明',
  sent_on: '2026-10-18',
  trial_on: null,
  course_name: null,
  campus_ids: ['c1'],
  ...over,
});

const admin = (
  user_id: string,
  permissions: string[],
  scope: string[] | null,
  org_id = 'org-a',
) => ({ org_id, user_id, permissions, scope });

describe('reminderNotifications', () => {
  const RECIPIENTS = [
    admin('all', ['manage_students', 'all_campuses'], null),
    admin('c1', ['manage_students'], ['c1']),
    admin('c2', ['manage_students'], ['c2']),
    admin('nostudents', ['manage_finance'], null),
    admin('star', ['*'], null),
    admin('other-org', ['*'], null, 'org-b'),
  ];

  it('收件人：manage_students 且分校範圍跟申請有交集（null＝全分校）；別的 org 不收', () => {
    const rows = reminderNotifications([overdue()], RECIPIENTS, TODAY);
    expect(rows.map((r) => r.user_id)).toEqual(['all', 'c1', 'star']);
  });

  it('申請找不到分校 → 沒有人收（同新申請通知）', () => {
    expect(reminderNotifications([overdue({ campus_ids: [] })], RECIPIENTS, TODAY)).toEqual([]);
  });

  it('沒處理：標題寫天數、內文寫送出日，連到對應分頁；鍵照候選', () => {
    const [row] = reminderNotifications([overdue()], [RECIPIENTS[0]!], TODAY);
    expect(row).toEqual({
      org_id: 'org-a',
      user_id: 'all',
      kind: 'application_overdue',
      dedupe_key: 'overdue:parent_request:enrollment:r1',
      payload: {
        title: '報名申請已經 4 天沒處理',
        body: '王小明・10/18 送出，還在待處理',
        url: '/admin/applications?kind=enrollment',
      },
    });
  });

  it('試聽申請沒處理：標題用「試聽」、連試聽分頁', () => {
    const [row] = reminderNotifications(
      [overdue({ kind: 'trial', dedupe_key: 'overdue:application:a1' })],
      [RECIPIENTS[0]!],
      TODAY,
    );
    expect(row!.payload.title).toBe('試聽申請已經 4 天沒處理');
    expect(row!.payload.url).toBe('/admin/applications?kind=trial');
  });

  it('試聽後還沒報名：標題不用「新的」開頭，內文寫試聽日與課程', () => {
    const [row] = reminderNotifications(
      [
        overdue({
          stage: 'trial_followup',
          kind: 'trial',
          dedupe_key: 'trial_followup:parent_request:t1',
          trial_on: '2026-10-20',
          course_name: '國二數學',
        }),
      ],
      [RECIPIENTS[0]!],
      TODAY,
    );
    expect(row).toMatchObject({
      kind: 'trial_followup',
      dedupe_key: 'trial_followup:parent_request:t1',
      payload: {
        title: '試聽後還沒報名',
        body: '王小明 10/20 試聽國二數學，還沒報名，記得跟進',
        url: '/admin/applications?kind=trial',
      },
    });
  });
});

describe('enqueueApplicationReminders', () => {
  function fakeDb(candidates: ReminderCandidate[]) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('WITH o AS')) return { rows: candidates };
        if (sql.includes('FROM staff st')) {
          return {
            rows: [
              {
                org_id: 'org-a',
                user_id: 'u1',
                roles: ['admin'],
                permissions: ['manage_students'],
                campus_ids: ['c1'],
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO notifications')) {
          return { rows: [], rowCount: (params[0] as unknown[]).length };
        }
        throw new Error(`沒預期的 SQL：${sql}`);
      },
    } as unknown as PoolClient;
    return { db, calls };
  }

  it('沒有候選：只跑第一句；第一句帶今天、org 範圍、回看 30 天', async () => {
    const f = fakeDb([]);
    expect(await enqueueApplicationReminders(f.db, TODAY, ['org-a'])).toBe(0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.params).toEqual([TODAY, ['org-a'], 30]);
    expect(LOOKBACK_DAYS).toBe(30);
  });

  it('有候選：查收件人、寫入時帶種類與鍵；收件人的分校範圍照 staff_campuses 算', async () => {
    const f = fakeDb([
      overdue(),
      overdue({ dedupe_key: 'overdue:application:a2', campus_ids: ['c9'] }),
    ]);
    expect(await enqueueApplicationReminders(f.db, TODAY, null)).toBe(1);
    const insert = f.calls.find((c) => c.sql.includes('INSERT'))!;
    // 二讀 A14／A15：不推播（同 notify() 的教職員通知）、同一人同一鍵只一則（並行兩輪也不重複）
    expect(insert.sql).toMatch(/'skipped', 'ROLE_PUSH_DISABLED'/);
    expect(insert.sql).toMatch(/ON CONFLICT \(user_id, dedupe_key\) DO NOTHING/);
    expect(insert.params.slice(0, 4)).toEqual([
      ['org-a'],
      ['u1'],
      ['application_overdue'],
      ['overdue:parent_request:enrollment:r1'],
    ]);
  });
});

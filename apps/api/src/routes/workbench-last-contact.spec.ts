import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { lastContactByStudent } from './workbench';

/**
 * #1314 D2：作業台「已聯絡 17:42」—— 每人**這一天（台北）**最近一筆。
 * created_at 一律寫成 +08:00 的字串：替身比字串，跟條件的 `${date}T00:00:00+08:00` 同格式才比得準。
 */
describe('lastContactByStudent', () => {
  const log = (studentId: string, at: string, channel = 'phone', org = 'org-a') => ({
    org_id: org,
    student_id: studentId,
    channel,
    created_at: at,
  });

  it('只看這一天、取最新那筆；別 org 與名單外不算', async () => {
    const db = createMultiOrgDb({
      contact_logs: [
        log('s1', '2026-03-10T09:00:00+08:00', 'phone'),
        log('s1', '2026-03-10T17:42:00+08:00', 'line'),
        log('s1', '2026-03-11T08:00:00+08:00'), // 隔天
        log('s2', '2026-03-09T23:59:00+08:00'), // 前一天
        log('s3', '2026-03-10T10:00:00+08:00', 'phone', 'org-b'),
        log('s9', '2026-03-10T10:00:00+08:00'), // 不在名單
      ],
    });

    const result = await lastContactByStudent(
      db.client as never,
      'org-a',
      ['s1', 's2', 's3'],
      '2026-03-10',
    );

    expect(Object.fromEntries(result)).toEqual({
      s1: { at: '2026-03-10T17:42:00+08:00', channel: 'line' },
    });
  });
});

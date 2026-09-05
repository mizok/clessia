import { describe, expect, it } from 'vitest';
import { checkEnrollmentSessionPacks } from './enrollment-session-pack-guard';

function createFakeSupabase(sessionPacks: Array<{ org_id: string; enrollment_id: string }>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, count: sessionPacks.length, error: null }).then(
        onfulfilled ?? undefined,
      ),
  };
  return { from: () => builder };
}

function createFailingSupabase() {
  const error = { message: 'session_packs exploded' };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, count: null, error }).then(onfulfilled ?? undefined),
  };
  return { from: () => builder };
}

describe('checkEnrollmentSessionPacks', () => {
  it('沒有任何報名 id 時直接視為無堂數包，不查資料庫', async () => {
    const result = await checkEnrollmentSessionPacks({
      supabase: createFailingSupabase() as never,
      orgId: 'org-1',
      enrollmentIds: [],
    });
    expect(result).toEqual({ status: 'none' });
  });

  it('報名沒有堂數包時可以刪除', async () => {
    const result = await checkEnrollmentSessionPacks({
      supabase: createFakeSupabase([]) as never,
      orgId: 'org-1',
      enrollmentIds: ['enrollment-1'],
    });
    expect(result).toEqual({ status: 'none' });
  });

  it('報名已有堂數包時要擋下刪除 —— 即使零出勤、零過去課堂', async () => {
    const result = await checkEnrollmentSessionPacks({
      supabase: createFakeSupabase([{ org_id: 'org-1', enrollment_id: 'enrollment-1' }]) as never,
      orgId: 'org-1',
      enrollmentIds: ['enrollment-1'],
    });
    expect(result).toEqual({ status: 'has-session-pack' });
  });

  it('查詢失敗時 fail closed，不得回報「沒有堂數包」', async () => {
    const result = await checkEnrollmentSessionPacks({
      supabase: createFailingSupabase() as never,
      orgId: 'org-1',
      enrollmentIds: ['enrollment-1'],
    });
    expect(result.status).toBe('check-failed');
  });
});

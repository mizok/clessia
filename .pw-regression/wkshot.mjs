// 拋棄式（#1174 G2 截圖）：週視圖真資料／合成壓力 × 1440／390。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const T = ['王老師', '李老師', '陳老師', '林老師', '張老師', '黃老師'];
function synth() {
  const data = [];
  let n = 0;
  days.forEach((d, di) => {
    const count = di === 6 ? 0 : di === 5 ? 10 : 6 + di * 2;
    for (let i = 0; i < count; i++) {
      const h = 15 + (i % 5);
      const ti = i % T.length;
      data.push({
        id: `x${n++}`, sessionDate: d, startTime: `${h}:00`, endTime: `${h + 1}:30`,
        status: i === 3 && di % 2 ? 'cancelled' : di < 5 && h < 17 && di < 3 ? 'completed' : 'scheduled',
        assignmentStatus: i === 7 ? 'unassigned' : 'assigned',
        classId: `c${i}`, className: `國${(i % 3) + 1}${['數學', '英文', '理化'][i % 3]} ${'ABCDE'[i % 5]} 班`,
        courseId: 'co', courseName: '課', campusId: 'ca', campusName: '總校',
        teacherId: i === 7 ? null : `t${ti}`, teacherName: i === 7 ? null : T[ti],
        hasChanges: i === 4, makeupFor: null, attendanceEnrolledCount: 12 + i,
      });
    }
    // 撞堂：週三王老師兩堂重疊
    if (di === 2) data.push({ ...data.at(-1), id: `x${n++}`, startTime: '15:30', endTime: '17:00', teacherId: 't0', teacherName: '王老師', className: '國二數學 加強班', status: 'scheduled' });
  });
  return { data, meta: { total: data.length, page: 1, pageSize: 500, monthUnassignedCount: 3, todayPendingAttendanceCount: 0, hiddenCancelledCount: 0 } };
}
const b = await chromium.launch();
for (const kind of ['real', 'synth']) {
  for (const [w, h, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    if (kind === 'synth') {
      const body = synth();
      await p.route(/\/api\/sessions\?/, (r) => r.fulfill({ json: body }));
    }
    await p.goto('http://localhost:4200/admin/sessions', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    console.log(kind, tag, 'overlay', await p.locator('vite-error-overlay').count());
    await p.getByRole('button', { name: '週', exact: true }).click();
    await p.waitForTimeout(1000);
    console.log(' title:', (await p.locator('app-page-open h1, app-page-open [openTitle]').first().innerText().catch(() => '?')).trim());
    await p.screenshot({ path: `${out}/${kind}-${tag}-week.png`, fullPage: true });
    if (tag === 'm') {
      await p.locator('button:visible', { hasText: '週三' }).last().click();
      await p.waitForTimeout(1000);
      const pressed = await p.getByRole('button', { name: '日', exact: true }).getAttribute('aria-pressed');
      console.log(' 點週三 → 日視圖 pressed', pressed);
      await p.screenshot({ path: `${out}/${kind}-${tag}-week-tap-wed.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await b.close();

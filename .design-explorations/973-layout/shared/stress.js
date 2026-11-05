/*
 * 課表的「真實補習班最壞情況」資料（#973 第三輪）。
 *
 * 使用者：「DB 都是假資料，不要拿 seed 推現實」。所以這份不從 seed 推，
 * 而是照一間中大型補習班的晚間尖峰設計：
 *   - 平日 17:00–21:30 同時段 8–12 班在上，開始時間錯開（17:00／17:30／18:00／18:30／19:00）
 *   - 課長不一：90／120／150／180 分
 *   - 16 位老師（含兼任），有人一晚連上兩堂
 *   - 週六整天（09:00–21:00）
 *   - 教室 12 間 —— **注意：schema 沒有教室**，這裡給的 room 只供「如果新增教室概念」的設計示範
 * 本週 = 9/28（一）–10/3（六），今天 10/1（四）17:40。
 * 掛在 window.CLESSIA_STRESS，不影響 CLESSIA。
 */
(function () {
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const teachers = ['周雅琳','江承睿','何靜宜','蕭立恆','游佩珊','簡志明','林宛蓉','陳冠霖','黃郁文','吳孟哲','許芷瑄','劉建邦','鄭雅竹','蔡宗翰','楊惠君','謝昀廷']
    .map((name, i) => ({ id: 'T' + (i + 1), name, partTime: i >= 11 }));
  const rooms = ['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','自習室'];
  const subjects = ['數學','英文','國文','自然','理化','社會'];
  const grades = ['國一','國二','國三','高一','高二','小五','小六'];

  const days = [
    { wd: 1, date: '2026-09-28' }, { wd: 2, date: '2026-09-29' }, { wd: 3, date: '2026-09-30' },
    { wd: 4, date: '2026-10-01' }, { wd: 5, date: '2026-10-02' }, { wd: 6, date: '2026-10-03' },
  ];
  const starts = ['17:00','17:00','17:30','18:00','18:00','18:30','19:00','19:00','19:00','19:30'];
  const satStarts = ['09:00','09:30','10:00','13:00','13:30','14:00','15:30','16:00','18:30','19:00'];
  const lens = [90, 90, 120, 120, 150, 180];
  const addMin = (t, m) => { const x = Number(t.slice(0,2))*60 + Number(t.slice(3)) + m; return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`; };

  const sessions = [];
  let n = 0;
  days.forEach((d) => {
    // 週四最滿（12 班同時在 19:00 前後），其他平日 8–11，週六 14
    const count = d.wd === 4 ? 22 : d.wd === 6 ? 14 : 16 + Math.floor(rnd() * 4);
    const busy = {}; // teacher -> [ [s,e] ]
    for (let i = 0; i < count; i++) {
      const start = d.wd === 6 ? satStarts[i % satStarts.length] : (d.wd === 4 && i >= 10 ? pick(['18:30','19:00','19:00','19:00']) : starts[i % starts.length]);
      const len = pick(lens);
      const end = addMin(start, len);
      // 找一位這段時間沒課的老師
      let t = null;
      for (let k = 0; k < 40 && !t; k++) {
        const c = pick(teachers);
        if (!(busy[c.id] || []).some(([s, e]) => start < e && end > s)) t = c;
      }
      if (!t) continue;
      (busy[t.id] ||= []).push([start, end]);
      n++;
      const grade = pick(grades);
      const subj = pick(subjects);
      sessions.push({
        id: 'S' + n, date: d.date, weekday: d.wd, start, end,
        className: `${grade}${subj} ${'ABCD'[n % 4]} 班`, subject: subj, grade,
        teacherId: t.id, teacher: t.name, room: rooms[i % rooms.length],
        students: 12 + Math.floor(rnd() * 19), status: 'scheduled', change: null,
      });
    }
  });
  // 今天以前的已上完；今天 17:40 前開始的在上課
  sessions.forEach((s) => {
    if (s.date < '2026-10-01') s.status = 'completed';
    else if (s.date === '2026-10-01' && s.end <= '17:40') s.status = 'completed';
    else if (s.date === '2026-10-01' && s.start <= '17:40') s.status = 'in_progress';
  });
  // 本週的異動，四種都要有：停課、代課、調課（已發生）、補課指定
  const fri = sessions.filter((s) => s.date === '2026-10-02');
  fri.slice(0, 3).forEach((s) => { s.status = 'cancelled'; s.change = { type: 'cancel', reason: '颱風停課（批次）' }; });
  const sat = sessions.find((s) => s.date === '2026-10-03' && s.start === '13:00');
  if (sat) sat.change = { type: 'makeup', forId: fri[0].id, forLabel: `10/2 ${fri[0].className}` };
  const thu = sessions.filter((s) => s.date === '2026-10-01' && s.status === 'scheduled');
  // 代課老師要挑「那段時間沒課的人」—— 真實的代課流程不會讓人撞堂
  if (thu[0]) {
    const s0 = thu[0];
    const free = teachers.find((t) => t.id !== s0.teacherId && !sessions.some((x) =>
      x.date === s0.date && x.teacherId === t.id && x.start < s0.end && x.end > s0.start));
    s0.change = { type: 'substitute', from: s0.teacher, reason: '原任課老師請假' };
    s0.teacherId = free.id; s0.teacher = free.name;
  }
  if (thu[1]) thu[1].change = { type: 'reschedule', fromDate: '2026-09-30', fromStart: thu[1].start, reason: '學校段考週' };
  const unassigned = sessions.find((s) => s.date === '2026-10-03' && s.start >= '15:00');
  if (unassigned) { unassigned.teacherId = null; unassigned.teacher = null; unassigned.change = { type: 'unassigned' }; }

  window.CLESSIA_STRESS = { teachers, rooms, days, sessions, today: '2026-10-01', now: '17:40', hasRooms: false };
})();

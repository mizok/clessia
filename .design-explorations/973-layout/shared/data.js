/*
 * #973 設計稿共用資料。形狀取自 supabase/seed-demo.sql，量放大到工單要求
 * （一班 ~30 人、一學期 ~140 堂、帳單 50 張）—— 設計稿要撐得住真實資料量。
 *
 * 前 40 個學生名字、6 個班名、上課時段、學校、帳單金額 3600/4800、
 * 請假理由、停課理由都直接來自 seed-demo.sql；其餘是照同一個形狀擴充的合成資料。
 * 「今天」固定為 2026-10-01（四）17:40，讓每次截圖一致。
 *
 * 全部掛在 window.CLESSIA，純 script（file:// 直接開就能跑）。
 */
(function () {
  // 決定性亂數：同一份稿每次打開長得一樣
  let seed = 973;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const TODAY = new Date(2026, 9, 1); // 2026-10-01 週四
  const NOW = '17:40';
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const TERM_START = addDays(TODAY, -70); // seed：今天 -10 週
  const TERM_END = addDays(TODAY, 42); //    seed：今天 +6 週

  // 機構名稱：seed 的 organizations.name 是「Demo 補習班」，不像真的，設計稿補一個（10/02 儀表板主標用）
  const org = { name: '晨曦文理補習班' };
  const campus = { name: '文山旗艦校', address: '台北市文山區羅斯福路六段 142 號 3 樓', phone: '02-2930-5678' };
  const campuses = ['文山旗艦校', '景美分校'];

  const schools = {
    J: ['景美國中', '景美國中', '景美國中', '木柵國中', '實踐國中'],
    P: ['興隆國小', '興隆國小', '萬芳國小', '景美國小'],
  };

  // seed-demo 的 40 位 + 擴充 80 位
  const seedNames = [
    '王柏翰','李思妤','張宇軒','陳映彤','林子晴','黃冠廷','吳承翰','劉宜蓁','蔡孟儒','鄭涵予',
    '謝秉勳','許雅雯','洪家瑋','曾郁婷','彭立宇','廖偉誠','賴思穎','徐子豪','高詠晴','潘俊傑',
    '盧安琪','施柏宇','范芷寧','馬士豪','唐允中','石佳穎','溫柏勛','葉宸希','董語彤','鍾昀達',
    '傅千惠','阮柏睿','龔亦萱','嚴皓天','詹佩君','章立群','邱宥安','孟妍希','顧廷瑋','夏晨曦',
  ];
  const sur = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐蘇葉莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧'.split('');
  const given = ['品妍','宥廷','子芸','冠宇','以晴','承恩','語晨','柏諺','芷涵','睿哲','欣妤','彥廷','詠心','昱翔','沛晴','家豪','宇彤','思辰','書瑋','可昕','翊安','亮均','苡安','恩碩','芯妤','允澤','采潔','奕辰','若綺','品睿'];
  const names = seedNames.slice();
  while (names.length < 120) {
    const n = pick(sur) + pick(given);
    if (!names.includes(n)) names.push(n);
  }

  const gradeLabel = { P5: '小五', P6: '小六', J1: '國一', J2: '國二', J3: '國三' };
  const grades = ['P5', 'P6', 'J1', 'J2', 'J3'];

  const teachers = [
    { id: 't1', name: '周雅琳', subject: '數學' },
    { id: 't2', name: '江承睿', subject: '英文' },
    { id: 't3', name: '何靜宜', subject: '國文' },
    { id: 't4', name: '蕭立恆', subject: '自然' },
    { id: 't5', name: '游佩珊', subject: '數學' },
    { id: 't6', name: '簡志明', subject: '英文' },
  ];

  // seed-demo 的 6 班（班名、時段原樣）+ 擴充 8 班，週一到週六
  const rooms = ['A 教室', 'B 教室', 'C 教室', '小教室'];
  const classDefs = [
    // name, subject, grades, weekday(1=一), start, end, teacher, room, fee, mode, capacity
    ['國三數學 A 班', '數學', ['J3'], 1, '17:00', '18:30', 't1', 'A 教室', 4800, 'session_pack', 30],
    ['國二英文 B 班', '英文', ['J2'], 2, '19:00', '20:30', 't2', 'B 教室', 4800, 'monthly', 28],
    ['國三國文 A 班', '國文', ['J3'], 3, '17:00', '18:30', 't3', 'C 教室', 4800, 'monthly', 24],
    ['國二自然 A 班', '自然', ['J2'], 4, '19:00', '20:30', 't4', 'A 教室', 4800, 'monthly', 30],
    ['國小六年級數學班', '數學', ['P6'], 5, '15:00', '16:30', 't5', 'B 教室', 3600, 'monthly', 18],
    ['國小五年級英文班', '英文', ['P5'], 6, '15:00', '16:30', 't6', '小教室', 3600, 'monthly', 18],
    ['國三數學 B 班', '數學', ['J3'], 4, '17:00', '18:30', 't5', 'B 教室', 4800, 'monthly', 30],
    ['國一數學 A 班', '數學', ['J1'], 4, '15:30', '17:00', 't1', 'A 教室', 4200, 'monthly', 26],
    ['國三英文 A 班', '英文', ['J3'], 4, '19:00', '20:30', 't6', 'B 教室', 4800, 'monthly', 28],
    ['國一英文 A 班', '英文', ['J1'], 2, '17:00', '18:30', 't2', 'A 教室', 4200, 'monthly', 26],
    ['國二數學 A 班', '數學', ['J2'], 1, '19:00', '20:30', 't1', 'A 教室', 4800, 'monthly', 30],
    ['國三自然 B 班', '自然', ['J3'], 3, '19:00', '20:30', 't4', 'B 教室', 4800, 'monthly', 28],
    ['國小六年級英文班', '英文', ['P6'], 5, '17:00', '18:30', 't6', '小教室', 3600, 'monthly', 18],
    ['國中會考衝刺班', '數學', ['J3'], 6, '09:30', '12:00', 't5', 'A 教室', 5200, 'monthly', 30],
  ];
  const classes = classDefs.map((c, i) => ({
    id: 'c' + (i + 1),
    name: c[0], subject: c[1], grades: c[2], weekday: c[3], start: c[4], end: c[5],
    teacherId: c[6], teacher: teachers.find((t) => t.id === c[6]).name,
    room: c[7], fee: c[8], billingMode: c[9], capacity: c[10],
    usesContactBook: i < 2, leaveDeductsSession: i === 0,
    studentIds: [],
  }));

  // 學生
  const students = names.map((name, i) => {
    // 前 40 位照 seed 的 i % 5；擴充的偏重國三（真實補習班的國三班最多）
    const g = i < 40 ? grades[i % 5] : ['J3', 'J3', 'J2', 'J3', 'J1', 'J2', 'J3', 'P6'][i % 8];
    const isP = g.startsWith('P');
    return {
      id: 's' + (i + 1),
      name,
      grade: g,
      gradeLabel: gradeLabel[g],
      school: pick(schools[isP ? 'P' : 'J']),
      gender: ['male', 'female', 'female', 'male'][i % 4],
      phone: '09' + String((i + 1) * 13713713 % 100000000).padStart(8, '0'),
      parent: { name: pick(sur) + pick(['先生', '太太', '媽媽', '爸爸']), relation: i % 2 ? '母' : '父', phone: '09' + String((i + 7) * 7331 % 100000000).padStart(8, '0'), line: rnd() > 0.2 },
      since: iso(addDays(TERM_START, -Math.floor(rnd() * 700))),
      enrollments: [],
    };
  });

  // 報名：依年級把學生塞進班，每班塞到容量的 55%–100%
  const statusRoll = () => {
    const r = rnd();
    return r < 0.86 ? 'active' : r < 0.93 ? 'pending_payment' : r < 0.98 ? 'suspended' : 'withdrawal';
  };
  classes.forEach((c) => {
    const pool = students.filter((s) => c.grades.includes(s.grade) && s.enrollments.length < 3);
    const target = Math.min(pool.length, Math.round(c.capacity * (0.55 + rnd() * 0.45)));
    const shuffled = pool.slice().sort(() => rnd() - 0.5).slice(0, target);
    shuffled.forEach((s) => {
      const status = statusRoll();
      c.studentIds.push(s.id);
      s.enrollments.push({ classId: c.id, status, billingMode: c.billingMode, fee: c.fee, from: iso(TERM_START) });
    });
  });
  // 沒班的學生補一班（同年級第一班），避免出現「沒課的在學生」這種不真實的形狀
  students.forEach((s) => {
    if (s.enrollments.length) return;
    const c = classes.find((x) => x.grades.includes(s.grade));
    c.studentIds.push(s.id);
    s.enrollments.push({ classId: c.id, status: 'active', billingMode: c.billingMode, fee: c.fee, from: iso(TERM_START) });
  });

  // 課堂：每班每週一堂，學期 16 週
  const cancelReasons = ['颱風停課', '老師臨時有事', '教室整修', '國定假日', '校外教學', '設備維護'];
  const sessions = [];
  classes.forEach((c, ci) => {
    let d = TERM_START;
    while (((d.getDay() + 6) % 7) + 1 !== c.weekday) d = addDays(d, 1);
    let n = 0;
    while (d <= TERM_END) {
      n++;
      const date = iso(d);
      const past = d < TODAY;
      const isToday = date === iso(TODAY);
      const s = {
        id: `${c.id}-${n}`, classId: c.id, className: c.name, date, weekNo: n,
        start: c.start, end: c.end, room: c.room, teacher: c.teacher, subject: c.subject,
        status: past ? 'completed' : 'scheduled',
        attendanceTaken: past,
        change: null,
      };
      if (isToday) {
        s.status = c.end <= NOW ? 'completed' : c.start <= NOW ? 'in_progress' : 'scheduled';
        s.attendanceTaken = c.end <= NOW && ci % 2 === 0; // 今天結束的課只點了一半
      }
      sessions.push(s);
      d = addDays(d, 7);
    }
  });
  // seed 的形狀：每班下一堂未來課停課；前三班補課；兩班代課
  classes.forEach((c, i) => {
    const next = sessions.find((s) => s.classId === c.id && s.date > iso(TODAY));
    if (i < 6 && next) {
      next.status = 'cancelled';
      next.change = { type: 'cancellation', reason: cancelReasons[i] };
    }
  });
  [3, 8].forEach((ci) => {
    const s = sessions.find((x) => x.classId === classes[ci].id && x.date >= iso(TODAY) && x.status !== 'cancelled');
    if (s) s.change = { type: 'substitute', substitute: ci === 3 ? '游佩珊' : '江承睿', reason: '原任課老師請假' };
  });

  // 出勤：已上完的課每人一筆
  const attendance = {}; // sessionId -> { studentId: 'present'|'absent'|'on_leave'|'late' }
  sessions.forEach((s) => {
    if (!s.attendanceTaken) return;
    const c = classes.find((x) => x.id === s.classId);
    const rec = {};
    c.studentIds.forEach((sid, k) => {
      const day = Number(s.date.slice(8));
      rec[sid] = (k + day) % 11 === 0 ? 'absent' : (k + day) % 7 === 0 ? 'on_leave' : (k + day) % 13 === 0 ? 'late' : 'present';
    });
    attendance[s.id] = rec;
  });

  // 請假（seed 的六個理由 + 今天的兩筆）
  const leaveReasons = ['發燒請假', '家中有事', '參加校內比賽', '看牙醫', '家族旅遊', '身體不適'];
  const leaves = leaveReasons.map((r, i) => ({
    studentId: students[(i + 1) * 3 - 1].id, date: iso(addDays(TODAY, -(i + 1) * 5)), reason: r, by: '家長', via: i % 2 ? 'LINE' : '電話',
  }));
  const todaysClasses = classes.filter((c) => c.weekday === 4);
  leaves.push({ studentId: todaysClasses[1].studentIds[2], date: iso(TODAY), reason: '身體不適', by: '家長', via: '電話', classId: todaysClasses[1].id, at: '14:12' });
  leaves.push({ studentId: todaysClasses[3].studentIds[5], date: iso(TODAY), reason: '參加校內比賽', by: '家長', via: 'LINE', classId: todaysClasses[3].id, at: '16:48' });

  // 成績：每班三次校內考
  const exams = [];
  classes.forEach((c) => {
    [-56, -28, -7].forEach((off, k) => {
      const scores = {};
      c.studentIds.forEach((sid) => (scores[sid] = Math.max(38, Math.min(100, Math.round(78 + (rnd() - 0.45) * 40)))));
      exams.push({ id: `${c.id}-e${k + 1}`, classId: c.id, name: ['第一次小考', '期中模擬考', '第三次小考'][k], date: iso(addDays(TODAY, off)), scores });
    });
  });

  // 帳單：本月 50 張。狀態是推導的（seed：invoices 沒有 status 欄位）
  const invoices = [];
  const billed = students.slice().sort(() => rnd() - 0.5).slice(0, 50);
  billed.forEach((s, k) => {
    const items = s.enrollments.filter((e) => e.status !== 'withdrawal').map((e) => {
      const c = classes.find((x) => x.id === e.classId);
      return { type: e.billingMode === 'session_pack' ? 'session_pack' : 'tuition', label: c.name, amount: e.billingMode === 'session_pack' ? 12 * 400 : c.fee, note: e.billingMode === 'session_pack' ? '購買 12 堂' : '十月月費' };
    });
    if (k % 9 === 0) items.push({ type: 'material', label: '講義費', amount: 450, note: '上學期講義' });
    if (k % 13 === 0) items.push({ type: 'discount', label: '手足優惠', amount: -300, note: '' });
    const total = items.reduce((a, b) => a + b.amount, 0);
    const dueOff = k % 6 === 0 ? -12 + (k % 5) : k % 3 === 0 ? 3 : k % 3 === 1 ? 5 - (k % 4) : 20;
    const due = addDays(TODAY, dueOff);
    let paid = 0;
    const payments = [];
    if (k % 2 === 0 && k % 3 !== 0) {
      paid = total; payments.push({ amount: total, method: k % 4 === 0 ? 'transfer' : 'cash', at: iso(addDays(TODAY, -8 + (k % 6))), receipt: `R2610-${String(40 + k).padStart(4, '0')}` });
    } else if (k % 7 === 1) {
      paid = Math.round(total / 2 / 100) * 100; payments.push({ amount: paid, method: 'cash', at: iso(addDays(TODAY, -3)), receipt: `R2610-${String(40 + k).padStart(4, '0')}` });
    }
    const status = paid >= total ? 'paid' : due < TODAY ? 'overdue' : (due - TODAY) / 864e5 <= 7 ? 'due_soon' : 'open';
    invoices.push({
      id: `INV-2610-${String(k + 1).padStart(3, '0')}`, studentId: s.id, studentName: s.name, gradeLabel: s.gradeLabel,
      issuedAt: iso(addDays(TODAY, -10)), due: iso(due), items, total, paid, balance: total - paid, status, payments,
      parent: s.parent, lastReminder: status === 'overdue' && k % 2 ? iso(addDays(TODAY, -2)) : null,
    });
  });

  // 堂數包（seed：24 / 12 / 8）
  const packs = classes[0].studentIds.map((sid, k) => {
    const bought = [24, 12, 8][k % 3];
    const used = sessions.filter((s) => s.classId === 'c1' && s.attendanceTaken).length;
    return { studentId: sid, classId: 'c1', bought, used: Math.min(bought, used) };
  });

  // ── 日到班（daily_checkin，系統預設模式）────────────────────────────────
  // schema：daily_checkins(student_id, checkin_date, checked_in_at, checked_in_by)，
  // 一人一天一筆、只有「到」沒有「離」。掃到碼 = 當天所有課堂 present，沒有遲到。
  // 今天「預計到班」= 今天有課（報名 active）的學生；最早那堂的開始時間是他的「該到時間」。
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const todayIso = iso(TODAY);
  const todayLeaveIds = new Set(leaves.filter((l) => l.date === todayIso).map((l) => l.studentId));
  const expected = {};
  sessions.filter((s) => s.date === todayIso && s.status !== 'cancelled').forEach((s) => {
    const c = classes.find((x) => x.id === s.classId);
    c.studentIds.forEach((sid) => {
      const st = students.find((x) => x.id === sid);
      if (st.enrollments.find((e) => e.classId === c.id).status !== 'active') return;
      const e = (expected[sid] ||= { studentId: sid, classIds: [], dueAt: s.start });
      e.classIds.push(c.id);
      if (s.start < e.dueAt) e.dueAt = s.start;
    });
  });
  const nowMin = toMin(NOW);
  const checkins = [];
  Object.values(expected).forEach((e, k) => {
    if (todayLeaveIds.has(e.studentId)) { e.state = 'on_leave'; return; }
    const due = toMin(e.dueAt);
    // 放學後陸續到：多數提早 5–40 分；國中生 19:00 的課常 17 點多就來自習
    const early = e.dueAt >= '19:00' && k % 3 === 0 ? 90 + Math.floor(rnd() * 40) : 5 + Math.floor(rnd() * 36);
    let at = due - early;
    if (k % 17 === 5) at = due + 6 + Math.floor(rnd() * 12); // 上課後才到（系統不判遲到，但看得出來）
    if (k % 23 === 7 && due <= nowMin) at = null; // 該到沒到
    if (at !== null && at <= nowMin) {
      const byDesk = k % 11 === 4; // 忘了帶卡，櫃台代刷
      checkins.push({ studentId: e.studentId, at: toHHMM(at), by: byDesk ? '櫃台' : '掃碼' });
      e.state = 'arrived'; e.arrivedAt = toHHMM(at);
    } else {
      e.state = due <= nowMin ? 'missing' : 'not_yet'; // 課已開始還沒到 / 還沒到該到的時間
    }
  });
  checkins.sort((a, b) => (a.at < b.at ? -1 : 1));

  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));

  window.CLESSIA = {
    TODAY: iso(TODAY), NOW, TERM_START: iso(TERM_START), TERM_END: iso(TERM_END),
    weekdayLabel: ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'],
    attendanceMode: 'daily_checkin', // 系統預設；'per_session' 是次要情境
    todayExpected: Object.values(expected), checkins,
    org, campus, campuses, teachers, rooms, classes, students, sessions, attendance, leaves, exams, invoices, packs,
    studentById: byId(students), classById: byId(classes),
    statusLabel: {
      enrollment: { active: '在學', pending_payment: '待繳費', suspended: '暫停', withdrawal: '退班', void: '作廢' },
      attendance: { present: '出席', absent: '缺席', on_leave: '請假', late: '遲到' },
      invoice: { paid: '已繳清', overdue: '逾期', due_soon: '7 天內到期', open: '未到期' },
      session: { completed: '已上完', in_progress: '上課中', scheduled: '待上課', cancelled: '停課' },
    },
    fmtMoney: (n) => 'NT$ ' + n.toLocaleString('en-US'),
    addDays: (isoStr, n) => iso(addDays(new Date(isoStr + 'T00:00:00'), n)),
  };
})();

import { request } from 'playwright';
const r = await request.newContext({ storageState: '../state-t2.json' });
for (const [label, id] of [['自己的課', process.argv[2]], ['別人的課', process.argv[3]]]) {
  const res = await r.get(`http://localhost:8797/api/attendance/roster/${id}`, { headers: { Origin: 'http://localhost:4200', 'x-active-role': 'teacher' } });
  console.log(label, res.status(), (await res.text()).slice(0, 80));
}

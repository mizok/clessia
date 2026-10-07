import { request } from 'playwright';
const r = await request.newContext({ storageState: process.argv[3] ?? '../state-teacher.json' });
const res = await r.fetch('http://localhost:8797/api/attendance/batch', { method: 'PATCH', headers: { Origin: 'http://localhost:4200', 'content-type': 'application/json', 'x-active-role': 'teacher' }, data: { eventId: process.argv[2], updates: [{ studentId: '00000000-0000-4000-8000-0000000000aa', status: 'present' }] } });
console.log(res.status(), (await res.text()).slice(0, 160));

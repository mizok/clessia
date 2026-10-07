import { request } from 'playwright';
const r = await request.newContext({ storageState: process.argv[2] });
const res = await r.get('http://localhost:8797/api/me', { headers: { Origin: 'http://localhost:4200' } });
console.log(res.status(), (await res.text()).slice(0, 300));

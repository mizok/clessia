import { chromium } from 'playwright'; import fs from 'node:fs';
const dir = process.argv[2]; const names = fs.readdirSync(dir).filter(f=>f.startsWith('after-')).map(f=>f.slice(6));
const b = await chromium.launch(); const p = await b.newPage();
for (const n of names) {
  const A = 'data:image/png;base64,'+fs.readFileSync(`${dir}/after-${n}`).toString('base64'), B = 'data:image/png;base64,'+fs.readFileSync(`${dir}/before-${n}`).toString('base64');
  const r = await p.evaluate(async ([A,B]) => {
    const ld = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [a,bb] = [await ld(A), await ld(B)];
    const W = Math.max(a.width,bb.width), H = Math.max(a.height,bb.height);
    const mk = i => { const c = document.createElement('canvas'); c.width=W;c.height=H; const x=c.getContext('2d'); x.fillStyle='#fff';x.fillRect(0,0,W,H); x.drawImage(i,0,0); return x.getImageData(0,0,W,H).data; };
    const da = mk(a), db = mk(bb); let n=0; for (let i=0;i<da.length;i+=4) if (Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2])>48) n++;
    const s = document.createElement('canvas'); s.width=bb.width+a.width+10; s.height=H; const x=s.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,s.width,H); x.drawImage(bb,0,0); x.drawImage(a,bb.width+10,0);
    return { same: a.width===bb.width&&a.height===bb.height, size:[bb.width,bb.height,a.width,a.height], pct: (100*n/(W*H)).toFixed(2), sbs: s.toDataURL('image/png') };
  }, [A,B]);
  fs.writeFileSync(`${dir}/sbs-${n}`, Buffer.from(r.sbs.split(',')[1],'base64'));
  console.log(n, r.size.join('x'), 'diff%', r.pct);
}
await b.close();

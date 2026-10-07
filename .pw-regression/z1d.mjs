import { PNG } from 'pngjs'; import { readFileSync } from 'node:fs';
const [a,b]=process.argv.slice(2); const A=PNG.sync.read(readFileSync(a)),B=PNG.sync.read(readFileSync(b));
let minx=1e9,miny=1e9,maxx=0,maxy=0,n=0;
for(let y=0;y<A.height;y++)for(let x=0;x<A.width;x++){const i=(y*A.width+x)*4;if(Math.abs(A.data[i]-B.data[i])+Math.abs(A.data[i+1]-B.data[i+1])+Math.abs(A.data[i+2]-B.data[i+2])>12){n++;minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);}}
console.log(n,minx,miny,maxx,maxy);

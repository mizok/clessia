import * as XLSX from '../apps/web/node_modules/xlsx/xlsx.mjs';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'apps/web/public/assets/templates');
const outFile = join(outDir, 'student-class-import-template.xlsx');

mkdirSync(outDir, { recursive: true });

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['學生姓名*', '就讀學校*'],
  ['陳志遠', '建國中學'],
  ['林佳慧', '北一女中'],
]);
XLSX.utils.book_append_sheet(wb, ws, '資料');

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync(outFile, buf);
console.log('✅ 範本已產生：' + outFile);

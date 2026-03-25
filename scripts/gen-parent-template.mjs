import * as XLSX from '../apps/web/node_modules/xlsx/xlsx.mjs';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'apps/web/public/assets/templates');
const outFile = join(outDir, 'parent-import-template.xlsx');

mkdirSync(outDir, { recursive: true });

const wb = XLSX.utils.book_new();

// 資料頁
const ws = XLSX.utils.aoa_to_sheet([
  ['家長姓名*', '家長電話', '家長Email', '家長備註', '學生姓名*', '學生年級*', '學生就讀學校*', '學生生日', '學生性別'],
  ['必填', '必填（與Email二擇一）', '必填（與電話二擇一）', '選填', '必填', '必填（見說明頁）', '必填', '選填（YYYY-MM-DD）', '選填（見說明頁）'],
  ['王美華', '0912345678', 'wang@example.com', '', '王小明', '國一', '台北市立中正國中', '2012-03-15', '男'],
]);
// 欄寬（單位：字元數）
ws['!cols'] = [
  { wch: 10 }, // 家長姓名
  { wch: 18 }, // 家長電話
  { wch: 24 }, // 家長Email
  { wch: 12 }, // 家長備註
  { wch: 10 }, // 學生姓名
  { wch: 18 }, // 學生年級
  { wch: 18 }, // 學生就讀學校
  { wch: 20 }, // 學生生日
  { wch: 18 }, // 學生性別
];
XLSX.utils.book_append_sheet(wb, ws, '資料');

// 說明頁
const wsInfo = XLSX.utils.aoa_to_sheet([
  ['年級填寫值', '', '性別填寫值'],
  ['小一', '', '男'],
  ['小二', '', '女'],
  ['小三', '', '不提供'],
  ['小四'],
  ['小五'],
  ['小六'],
  ['國一'],
  ['國二'],
  ['國三'],
  ['高一'],
  ['高二'],
  ['高三'],
]);
XLSX.utils.book_append_sheet(wb, wsInfo, '說明');

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync(outFile, buf);
console.log('✅ 範本已產生：' + outFile);

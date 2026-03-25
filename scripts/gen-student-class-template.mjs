import ExcelJS from 'exceljs';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'apps/web/public/assets/templates');
const outFile = join(outDir, 'student-class-import-template.xlsx');

mkdirSync(outDir, { recursive: true });

const wb = new ExcelJS.Workbook();

// ── 資料頁 ────────────────────────────────────────────────
const ws = wb.addWorksheet('資料');

// 欄寬
ws.columns = [
  { key: 'a', width: 16 },
  { key: 'b', width: 24 },
];

// Row 1：標頭
const headerRow = ws.addRow(['學生姓名 *', '就讀學校 *']);
headerRow.height = 24;
headerRow.eachCell((cell) => {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF1E3A5F' } },
    bottom: { style: 'thin', color: { argb: 'FF1E3A5F' } },
    left: { style: 'thin', color: { argb: 'FF1E3A5F' } },
    right: { style: 'thin', color: { argb: 'FF1E3A5F' } },
  };
});

// Row 2：必填說明
const hintRow = ws.addRow(['必填', '必填']);
hintRow.height = 20;
hintRow.eachCell((cell) => {
  cell.font = { italic: true, size: 9, color: { argb: 'FFCC3300' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
  };
});

// Row 3、4：範例資料
const examples = [
  ['陳志遠', '建國中學'],
  ['林佳慧', '北一女中'],
];
for (const data of examples) {
  const r = ws.addRow(data);
  r.height = 20;
  r.eachCell((cell) => {
    cell.font = { color: { argb: 'FF444444' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } },
      left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    };
  });
}

// 凍結前兩列
ws.views = [{ state: 'frozen', ySplit: 2 }];

// ── 說明頁 ────────────────────────────────────────────────
const wsInfo = wb.addWorksheet('說明');
wsInfo.columns = [{ key: 'a', width: 52 }];

// 標題
const infoTitle = wsInfo.addRow(['注意事項']);
infoTitle.height = 26;
infoTitle.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
infoTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
infoTitle.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

const notes = [
  '1. 上傳後系統會以「姓名 + 就讀學校」比對現有學生資料',
  '2. 若找不到學生，該筆顯示「找不到」，需先至學生管理頁新增',
  '3. 同名同校時會顯示下拉選單，請手動選擇正確學生',
  '4. 已在班級的學生會顯示「已在班級」並自動略過',
  '5. 不需加入的列直接刪除該行即可，無需填任何標記',
];

for (const [i, text] of notes.entries()) {
  const r = wsInfo.addRow([text]);
  r.height = 20;
  r.getCell(1).font = { size: 10, color: { argb: 'FF333333' } };
  r.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: i % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF' },
  };
  r.getCell(1).alignment = { vertical: 'middle', wrapText: true };
}

await wb.xlsx.writeFile(outFile);
console.log('✅ 範本已產生：' + outFile);

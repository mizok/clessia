import ExcelJS from 'exceljs';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'apps/web/public/assets/templates');
const outFile = join(outDir, 'parent-import-template.xlsx');

mkdirSync(outDir, { recursive: true });

const wb = new ExcelJS.Workbook();

// ── 資料頁 ────────────────────────────────────────────────
const ws = wb.addWorksheet('資料');

// 欄寬
ws.columns = [
  { key: 'a', width: 12 },
  { key: 'b', width: 16 },
  { key: 'c', width: 26 },
  { key: 'd', width: 14 },
  { key: 'e', width: 12 },
  { key: 'f', width: 14 },
  { key: 'g', width: 20 },
  { key: 'h', width: 22 },
  { key: 'i', width: 20 },
];

// Row 1：標頭
const headerRow = ws.addRow([
  '家長姓名 *', '家長電話', '家長 Email', '家長備註',
  '學生姓名 *', '學生年級 *', '學生就讀學校 *', '學生生日', '學生性別',
]);
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
const hintTexts = [
  '必填',
  '必填（與 Email 二擇一）',
  '必填（與電話二擇一）',
  '選填',
  '必填',
  '必填（見說明頁）',
  '必填',
  '選填（YYYY-MM-DD）',
  '選填（見說明頁）',
];
const hintRow = ws.addRow(hintTexts);
hintRow.height = 20;
hintRow.eachCell((cell, colNum) => {
  const isRequired = [1, 5, 6, 7].includes(colNum);
  const isMutual = [2, 3].includes(colNum);
  cell.font = {
    italic: true,
    size: 9,
    color: { argb: isRequired ? 'FFCC3300' : isMutual ? 'FFCC7700' : 'FF666666' },
  };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
  };
});

// Row 3：範例資料
const exampleRow = ws.addRow([
  '王美華', '0912345678', 'wang@example.com', '',
  '王小明', '國一', '台北市立中正國中', '2012-03-15', '男',
]);
exampleRow.height = 20;
exampleRow.eachCell((cell) => {
  cell.font = { color: { argb: 'FF444444' }, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  cell.border = {
    bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } },
    left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
  };
});

// 凍結前兩列
ws.views = [{ state: 'frozen', ySplit: 2 }];

// ── 說明頁 ────────────────────────────────────────────────
const wsInfo = wb.addWorksheet('說明');

wsInfo.columns = [
  { key: 'a', width: 18 },
  { key: 'b', width: 4 },
  { key: 'c', width: 16 },
];

// 標題
const infoTitle = wsInfo.addRow(['合法填寫值參考']);
wsInfo.mergeCells('A1:C1');
infoTitle.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1E3A5F' } };
infoTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
infoTitle.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
infoTitle.height = 22;

// 子標題
const subHeader = wsInfo.addRow(['年級', '', '性別']);
subHeader.height = 18;
['A2', 'C2'].forEach((ref) => {
  const cell = wsInfo.getCell(ref);
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5B9A' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
});

// 年級 & 性別資料
const gradeGender = [
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
];
gradeGender.forEach((rowData, i) => {
  const r = wsInfo.addRow(rowData);
  r.height = 18;
  const bg = i % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF';
  r.eachCell({ includeEmpty: false }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { size: 10 };
  });
});

await wb.xlsx.writeFile(outFile);
console.log('✅ 範本已產生：' + outFile);

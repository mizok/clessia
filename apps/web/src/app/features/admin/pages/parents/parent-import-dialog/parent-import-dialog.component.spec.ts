import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import * as XLSX from 'xlsx';

import { ParentsService } from '@core/parents.service';

import { ParentImportDialogComponent } from './parent-import-dialog.component';

/**
 * 這支對話框吃的是**真的檔案**，所以測試也餵真的檔案 —— 用 `xlsx` 現場寫出
 * 一個 workbook 再讀回來，而不是 mock 掉解析。
 *
 * 這件事在 xlsx 改成動態載入（`await import('xlsx')`）之後特別重要：
 * 那個改動沒有任何測試守著，而它動到的正是「檔案進來之後發生什麼」。
 * 靜態或動態載入對這裡的斷言都一樣 —— 測的是行為不是實作。
 */
function xlsxFile(rows: unknown[][], name = '家長匯入.xlsx'): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buffer], name);
}

function csvFile(rows: string[][], name = '家長匯入.csv'): File {
  return new File([rows.map((r) => r.join(',')).join('\n')], name, { type: 'text/csv' });
}

// 前兩列是範本的標題與說明，解析從第三列開始
const HEADER: unknown[][] = [
  ['家長姓名', '家長電話', '家長Email', '備註', '學生姓名', '年級', '學校', '生日', '性別'],
  ['必填', '', '', '', '必填', '必填', '必填', '', ''],
];

describe('ParentImportDialogComponent', () => {
  let fixture: ComponentFixture<ParentImportDialogComponent>;
  let component: ParentImportDialogComponent;

  const parentsServiceMock = {
    batchCheck: vi.fn(() => of({ warnings: [], errors: [] })),
    batchImport: vi.fn(),
  };

  async function parse(file: File) {
    await (component as never as { processFile(f: File): Promise<void> }).processFile(file);
    return (component as never as { rows(): Array<Record<string, unknown>> }).rows();
  }

  beforeEach(async () => {
    parentsServiceMock.batchCheck.mockClear();

    await TestBed.configureTestingModule({
      imports: [ParentImportDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: ParentsService, useValue: parentsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentImportDialogComponent);
    component = fixture.componentInstance;
  });

  describe('真的 .xlsx', () => {
    it('讀得出每一欄，而且對到正確的欄位', async () => {
      const rows = await parse(
        xlsxFile([
          ...HEADER,
          ['王大明', '0912345678', 'a@b.com', '晚上聯絡', '王小明', '國一', '測試國中', '', '男'],
        ]),
      );

      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        parentName: '王大明',
        parentPhone: '0912345678',
        parentEmail: 'a@b.com',
        studentName: '王小明',
        studentSchool: '測試國中',
      });
      expect(rows[0]['errors']).toEqual([]);
    });

    // Excel 把日期存成序號，不轉的話會變成「40318」這種東西寫進生日欄
    it('Excel 的日期序號轉得回真正的日期', async () => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ...HEADER,
        ['王大明', '0912345678', '', '', '王小明', '國一', '測試國中', new Date(2010, 4, 20), '男'],
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
      const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

      const rows = await parse(new File([buffer], '生日.xlsx'));

      expect(rows[0]['studentBirthday']).toBe('2010-05-20');
      expect(rows[0]['errors']).toEqual([]);
    });

    it('缺必填欄位時把錯誤講出來，而不是靜靜跳過那一列', async () => {
      const rows = await parse(
        xlsxFile([...HEADER, ['', '0912345678', '', '', '王小明', '國一', '測試國中', '', '']]),
      );

      expect(rows.length).toBe(1);
      expect(rows[0]['errors']).toContain('家長姓名不可空白');
    });

    it('只有標題沒有資料列時回空陣列，不是丟例外', async () => {
      expect(await parse(xlsxFile(HEADER))).toEqual([]);
    });
  });

  describe('真的 .csv', () => {
    it('走的是另一條讀檔路徑（readAsText），結果要一樣', async () => {
      const rows = await parse(
        csvFile([
          ['家長姓名', '家長電話', '家長Email', '備註', '學生姓名', '年級', '學校', '生日', '性別'],
          ['必填', '', '', '', '必填', '必填', '必填', '', ''],
          ['李大華', '0987654321', '', '', '李小華', '國二', '示範國中', '2011/03/08', '女'],
        ]),
      );

      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        parentName: '李大華',
        parentPhone: '0987654321',
        studentName: '李小華',
        // CSV 沒有日期型別，只有字串 —— 斜線格式要正規化成 YYYY-MM-DD
        studentBirthday: '2011-03-08',
      });
      expect(rows[0]['errors']).toEqual([]);
    });
  });

  // API 掛掉不該讓整份檔案讀不進來 —— 衝突預檢是加分項不是前提
  it('衝突預檢失敗時照樣解析得出資料', async () => {
    parentsServiceMock.batchCheck.mockReturnValueOnce(throwError(() => new Error('boom')));

    const rows = await parse(
      xlsxFile([...HEADER, ['王大明', '0912345678', '', '', '王小明', '國一', '測試國中', '', '']]),
    );

    expect(rows.length).toBe(1);
  });
});

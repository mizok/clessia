import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { finalize, firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
/**
 * **`xlsx` 只在真的要解析檔案時才載入。**
 *
 * 靜態 import 的話，`parents.page.ts` 靜態引用這個 dialog → 打開「家長管理」就會下載
 * SheetJS 的 **337 kB（傳輸 96 kB）**，而多數人進這一頁只是看名單，從來不匯入。
 * 見 `kb/wiki/lessons/root-component-pins-the-bundle.md`：靜態可達就是會下載。
 */
type XLSXModule = typeof import('xlsx');
import {
  ParentsService,
  type BatchImportResponse,
  type BatchImportRow,
  type BatchCheckRow,
  type BatchCheckError,
  type BatchCheckResponse,
} from '@core/parents.service';

// 年級對照表
const GRADE_MAP: Record<string, string> = {
  小一: 'P1',
  小二: 'P2',
  小三: 'P3',
  小四: 'P4',
  小五: 'P5',
  小六: 'P6',
  國一: 'J1',
  國二: 'J2',
  國三: 'J3',
  高一: 'S1',
  高二: 'S2',
  高三: 'S3',
};

// 性別對照表
const GENDER_MAP: Record<string, string> = {
  男: 'male',
  女: 'female',
  不提供: 'prefer_not_to_say',
};

const VALID_GRADE_CODES = new Set(Object.values(GRADE_MAP));

interface ParsedRow {
  index: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  parentNotes: string;
  studentName: string;
  studentGrade: string;
  studentSchool: string;
  studentBirthday: string;
  studentGender: string;
  errors: string[];
  warnings: string[];
  mergeNote: string | null;
  skipped: boolean; // 家長+學生皆已存在，無需匯入
  skipReason: string; // skipped = true 時的顯示訊息
}

@Component({
  selector: 'app-parent-import-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, TagModule, ProgressSpinnerModule],
  templateUrl: './parent-import-dialog.component.html',
  styleUrl: './parent-import-dialog.component.scss',
})
export class ParentImportDialogComponent {
  /** `parseExcelFile` 動態載入後存下來，供 `toBirthdayString` 讀 Excel 的日期序列值 */
  private xlsx: XLSXModule | null = null;

  private readonly ref = inject(DynamicDialogRef);
  private readonly parentsService = inject(ParentsService);

  protected readonly step = signal<1 | 2 | 3 | 4>(1);
  protected readonly rows = signal<ParsedRow[]>([]);
  protected readonly submitting = signal(false);
  protected readonly submitResult = signal<BatchImportResponse | null>(null);
  protected readonly dragging = signal(false);
  // 記錄每筆送出行對應的原始 Excel 序號（1-based），用於結果頁顯示
  protected readonly submittedIndexes = signal<number[]>([]);

  protected readonly hasErrors = computed(() => this.rows().some((row) => row.errors.length > 0));
  protected readonly importableCount = computed(
    () => this.rows().filter((row) => row.errors.length === 0 && !row.skipped).length,
  );
  protected readonly parentsCount = computed(() =>
    this.countDistinctParents(this.rows().filter((r) => r.errors.length === 0 && !r.skipped)),
  );
  protected readonly failedCount = computed(() => {
    const result = this.submitResult();
    if (!result) return 0;
    return result.results.filter((item) => item.status === 'failed').length;
  });

  protected onFileChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    this.processFile(file);
    target.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    this.processFile(file);
  }

  private async processFile(file: File): Promise<void> {
    try {
      const sheetRows = await this.parseExcelFile(file);
      const parsedRows = this.parseRows(sheetRows);

      // DB 衝突預檢（靜默降級：API 失敗不阻擋流程）
      const checkableRows = parsedRows
        .map((row, originalIndex) => ({ row, originalIndex }))
        .filter(({ row }) => row.errors.length === 0);
      const checkRows: BatchCheckRow[] = checkableRows.map(({ row }) => ({
        parentName: row.parentName,
        parentPhone: row.parentPhone || undefined,
        parentEmail: row.parentEmail || undefined,
        studentName: row.studentName || undefined,
      }));

      const dbResult: BatchCheckResponse =
        checkRows.length > 0
          ? await firstValueFrom(this.parentsService.batchCheck(checkRows)).catch(
              (): BatchCheckResponse => ({ warnings: [], errors: [] }),
            )
          : { warnings: [], errors: [] };

      for (const w of dbResult.warnings) {
        const mappedRowIndex = checkableRows[w.rowIndex]?.originalIndex;
        if (mappedRowIndex === undefined || !parsedRows[mappedRowIndex]) continue;

        if (w.type === 'student_already_exists') {
          parsedRows[mappedRowIndex].skipped = true;
          parsedRows[mappedRowIndex].skipReason = w.message;
          parsedRows[mappedRowIndex].warnings.push(w.message);
        } else {
          parsedRows[mappedRowIndex].warnings.push(w.message);
        }
      }
      for (const e of dbResult.errors) {
        const mappedRowIndex = checkableRows[e.rowIndex]?.originalIndex;
        if (mappedRowIndex === undefined) continue;
        parsedRows[mappedRowIndex]?.errors.push(e.message);
      }

      this.rows.set(parsedRows);
      this.submitResult.set(null);
      this.step.set(2);
    } catch (error: unknown) {
      console.error('解析 Excel 失敗:', error);
      this.rows.set([]);
      this.step.set(1);
    }
  }

  protected onSubmit(): void {
    const importableRows = this.rows().filter((row) => row.errors.length === 0 && !row.skipped);
    const batchRows: BatchImportRow[] = importableRows.map((row) => {
      const gradeCode = this.toGradeCode(row.studentGrade) ?? row.studentGrade;
      const genderCode = this.toGenderCode(row.studentGender);
      return {
        parentName: row.parentName,
        parentPhone: row.parentPhone || undefined,
        parentEmail: row.parentEmail || undefined,
        parentNotes: row.parentNotes || undefined,
        studentName: row.studentName,
        studentGrade: gradeCode,
        studentSchool: row.studentSchool,
        studentBirthday: row.studentBirthday || undefined,
        studentGender: genderCode ?? undefined,
      };
    });
    this.submittedIndexes.set(importableRows.map((row) => row.index));

    if (batchRows.length === 0) return;

    this.submitting.set(true);
    this.step.set(3);

    this.parentsService
      .batchImport(batchRows)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result) => {
          console.log('[batch-import] result:', result);
          const failed = result.results.filter((r) => r.status === 'failed');
          if (failed.length > 0) {
            console.error('[batch-import] failed rows:', failed);
          }
          this.submitResult.set(result);
          this.step.set(4);
        },
        error: (error: unknown) => {
          console.error('[batch-import] HTTP error:', error);
          this.step.set(2);
        },
      });
  }

  protected onClose(): void {
    this.ref.close();
  }

  protected onDone(): void {
    this.ref.close('imported');
  }

  private async parseExcelFile(file: File): Promise<unknown[][]> {
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    // 使用者已經選了檔案才走到這裡 —— 這時候載入是安全的，也是唯一需要它的時刻
    const XLSX: XLSXModule = await import('xlsx');
    // `toBirthdayString` 在對應每一列時要用 `SSF`，而它在解析之後才會跑到。
    // 存起來而不是再 import 一次 —— 動態 import 有快取，但語意上這是同一次解析。
    this.xlsx = XLSX;

    return new Promise<unknown[][]>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const result = reader.result;
          let workbook: ReturnType<XLSXModule['read']>;

          if (isCsv) {
            if (typeof result !== 'string') {
              reject(new Error('CSV 內容讀取失敗'));
              return;
            }
            // **`raw: true` 不能拿掉。** CSV 沒有型別，xlsx 預設會替你推斷 ——
            // `0987654321` 會變成數字 `987654321`，前導零消失，然後電話驗證
            // report「需為 09 開頭 10 碼」。行政看著自己檔案裡明明正確的號碼，
            // 而錯誤訊息指著一個他沒寫過的值。
            workbook = XLSX.read(result, { type: 'string', raw: true });
          } else {
            if (!(result instanceof ArrayBuffer)) {
              reject(new Error('Excel 內容讀取失敗'));
              return;
            }
            workbook = XLSX.read(result, { type: 'array' });
          }

          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            resolve([]);
            return;
          }

          const firstSheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
            header: 1,
            defval: '',
          });
          resolve(rawRows as unknown[][]);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(reader.error ?? new Error('檔案讀取錯誤'));
      };

      if (isCsv) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  private parseRows(sheetRows: unknown[][]): ParsedRow[] {
    if (sheetRows.length <= 2) return [];

    const dataRows = sheetRows.slice(2).filter((row) => this.hasAnyData(row));
    const parsedRows = dataRows.map((row, index) => this.parseSingleRow(row, index + 1));

    this.applySameNameWarnings(parsedRows);
    this.applyMergeNotes(parsedRows);

    return parsedRows;
  }

  private parseSingleRow(row: unknown[], index: number): ParsedRow {
    const parentName = this.readText(row[0]);
    const parentPhone = this.normalizePhone(this.readText(row[1]));
    const parentEmail = this.normalizeEmail(this.readText(row[2]));
    const parentNotes = this.readText(row[3]);
    const studentName = this.readText(row[4]);
    const studentGrade = this.readText(row[5]);
    const studentSchool = this.readText(row[6]);
    const studentBirthday = this.toBirthdayString(row[7]);
    const studentGender = this.readText(row[8]);

    const errors: string[] = [];

    if (!parentName) errors.push('家長姓名不可空白');
    if (!studentName) errors.push('學生姓名不可空白');
    if (!this.toGradeCode(studentGrade)) errors.push('學生年級格式不正確');
    if (!studentSchool) errors.push('學生就讀學校不可空白');
    if (!parentEmail && !parentPhone) errors.push('家長電話與 Email 不可同時空白');
    if (parentPhone && !/^09\d{8}$/.test(parentPhone))
      errors.push('家長電話格式錯誤（需為 09 開頭 10 碼）');
    if (parentEmail && !this.isValidEmail(parentEmail)) errors.push('家長 Email 格式錯誤');
    if (studentBirthday && !/^\d{4}-\d{2}-\d{2}$/.test(studentBirthday))
      errors.push('學生生日格式錯誤（需為 YYYY-MM-DD，如 2010-05-20）');

    return {
      index,
      parentName,
      parentPhone,
      parentEmail,
      parentNotes,
      studentName,
      studentGrade,
      studentSchool,
      studentBirthday,
      studentGender,
      errors,
      warnings: [],
      mergeNote: null,
      skipped: false,
      skipReason: '',
    };
  }

  private applySameNameWarnings(rows: ParsedRow[]): void {
    const rowsByName = new Map<string, ParsedRow[]>();

    for (const row of rows) {
      const nameKey = row.parentName.trim();
      if (!nameKey) continue;
      const bucket = rowsByName.get(nameKey) ?? [];
      bucket.push(row);
      rowsByName.set(nameKey, bucket);
    }

    for (const sameNameRows of rowsByName.values()) {
      if (sameNameRows.length <= 1) continue;

      for (let i = 0; i < sameNameRows.length; i += 1) {
        const current = sameNameRows[i];
        let hasConflict = false;

        for (let j = 0; j < sameNameRows.length; j += 1) {
          if (i === j) continue;
          if (this.hasDifferentContacts(current, sameNameRows[j])) {
            hasConflict = true;
            break;
          }
        }

        if (hasConflict) {
          current.warnings.push('同名家長但聯絡資訊不同');
        }
      }
    }
  }

  private applyMergeNotes(rows: ParsedRow[]): void {
    const phoneFirstRowMap = new Map<string, number>();
    const emailFirstRowMap = new Map<string, number>();

    for (const row of rows) {
      const mergeTargets: number[] = [];

      if (row.parentPhone && phoneFirstRowMap.has(row.parentPhone)) {
        mergeTargets.push(phoneFirstRowMap.get(row.parentPhone) as number);
      }
      if (row.parentEmail && emailFirstRowMap.has(row.parentEmail)) {
        mergeTargets.push(emailFirstRowMap.get(row.parentEmail) as number);
      }

      const mergeTargetRow = mergeTargets.length > 0 ? Math.min(...mergeTargets) : null;
      if (mergeTargetRow !== null) {
        row.mergeNote = `將與第 ${mergeTargetRow} 行合併至同一家長帳號`;
      }

      const baseRow = mergeTargetRow ?? row.index;
      if (row.parentPhone && !phoneFirstRowMap.has(row.parentPhone)) {
        phoneFirstRowMap.set(row.parentPhone, baseRow);
      }
      if (row.parentEmail && !emailFirstRowMap.has(row.parentEmail)) {
        emailFirstRowMap.set(row.parentEmail, baseRow);
      }
    }
  }

  private countDistinctParents(rows: ParsedRow[]): number {
    const nodeParent = new Map<string, string>();
    let rowsWithoutContact = 0;

    const ensureNode = (node: string): void => {
      if (!nodeParent.has(node)) nodeParent.set(node, node);
    };

    const findRoot = (node: string): string => {
      let root = node;
      while (nodeParent.get(root) !== root) {
        root = nodeParent.get(root) as string;
      }

      let current = node;
      while (nodeParent.get(current) !== current) {
        const next = nodeParent.get(current) as string;
        nodeParent.set(current, root);
        current = next;
      }

      return root;
    };

    const unionNode = (a: string, b: string): void => {
      const rootA = findRoot(a);
      const rootB = findRoot(b);
      if (rootA !== rootB) {
        nodeParent.set(rootB, rootA);
      }
    };

    for (const row of rows) {
      const contacts: string[] = [];
      if (row.parentPhone) contacts.push(`phone:${row.parentPhone}`);
      if (row.parentEmail) contacts.push(`email:${row.parentEmail}`);

      if (contacts.length === 0) {
        rowsWithoutContact += 1;
        continue;
      }

      for (const contact of contacts) ensureNode(contact);
      for (let i = 1; i < contacts.length; i += 1) {
        unionNode(contacts[0], contacts[i]);
      }
    }

    const roots = new Set<string>();
    for (const node of nodeParent.keys()) {
      roots.add(findRoot(node));
    }

    return roots.size + rowsWithoutContact;
  }

  private hasAnyData(row: unknown[]): boolean {
    return row.some((cell) => this.readText(cell) !== '');
  }

  private toGradeCode(value: string): string | null {
    if (!value) return null;
    if (GRADE_MAP[value]) return GRADE_MAP[value];

    const normalized = value.toUpperCase();
    if (VALID_GRADE_CODES.has(normalized)) return normalized;

    return null;
  }

  private toGenderCode(value: string): string | null {
    if (!value) return null;
    return GENDER_MAP[value] ?? null;
  }

  private hasDifferentContacts(a: ParsedRow, b: ParsedRow): boolean {
    return a.parentPhone !== b.parentPhone && a.parentEmail !== b.parentEmail;
  }

  private normalizePhone(value: string): string {
    return value.replace(/\s+/g, '');
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  private readText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private toBirthdayString(value: unknown): string {
    if (typeof value === 'number' && this.xlsx) {
      const parsed = this.xlsx.SSF.parse_date_code(value);
      if (parsed) {
        const year = String(parsed.y).padStart(4, '0');
        const month = String(parsed.m).padStart(2, '0');
        const day = String(parsed.d).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = String(value.getFullYear()).padStart(4, '0');
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const text = this.readText(value);
    if (!text) return '';

    const slashDateMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (slashDateMatch) {
      const [, y, m, d] = slashDateMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    return text;
  }

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}

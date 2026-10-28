import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import { effectiveFromSuffix } from '@shared/utils/schedule-effective.util';

/**
 * 公開試聽／報名表單的純邏輯（#1665 PR-4，設計稿 `specs/public/application-forms-a6.md` §1）。
 * 驗證規則與文案照 A6（`pub-trial.html`、`pub-enrollment.html` 的 check()），跟 API 同一套
 * （`apps/api/src/routes/public/application-common.ts`）—— 前端擋住的，API 也會擋。
 */

export type FormKind = 'trial' | 'enrollment';
export type Relation = 'father' | 'mother' | 'other';

export const RELATION_OPTIONS: ReadonlyArray<{ value: Relation; label: string }> = [
  { value: 'father', label: '父親' },
  { value: 'mother', label: '母親' },
  { value: 'other', label: '其他' },
];

export interface FormValues {
  parentName: string;
  email: string;
  phone: string;
  relation: Relation | '';
  studentName: string;
  grade: GradeLevel | '';
  school: string;
  /** 試聽是 courseId，報名是 classId */
  targets: string[];
  preferredTimes: string;
  startDate: string;
  note: string;
  consent: boolean;
  /** honeypot：真人看不到。有值時 API 回假成功、不寫 */
  website: string;
}

export const emptyValues = (): FormValues => ({
  parentName: '',
  email: '',
  phone: '',
  relation: '',
  studentName: '',
  grade: '',
  school: '',
  targets: [],
  preferredTimes: '',
  startDate: '',
  note: '',
  consent: false,
  website: '',
});

export type FieldKey =
  | 'parentName'
  | 'email'
  | 'phone'
  | 'relation'
  | 'studentName'
  | 'grade'
  | 'school'
  | 'targets'
  | 'startDate'
  | 'consent';
export type FieldErrors = Partial<Record<FieldKey, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normalizePhone = (v: string) => v.replace(/[-\s]/g, '');

/** 鍵的順序就是「還沒填好：…」的順序，也是捲過去的第一個欄位（照 A6 check()） */
export function validate(kind: FormKind, v: FormValues, today: string): FieldErrors {
  const e: FieldErrors = {};
  const email = v.email.trim();
  const phone = v.phone.trim();
  if (!v.parentName.trim()) e.parentName = '還沒填家長姓名';
  if (!email && !phone) e.email = e.phone = 'Email 和手機至少填一個';
  if (email && !EMAIL.test(email)) e.email = 'Email 格式不對，例：name@example.com';
  if (phone && !/^09\d{8}$/.test(normalizePhone(phone))) e.phone = '手機要是 09 開頭的 10 碼數字';
  if (!v.relation) e.relation = '還沒選與學生的關係';
  if (!v.studentName.trim()) e.studentName = '還沒填學生姓名';
  if (!v.grade) e.grade = '還沒選年級';
  if (!v.school.trim()) e.school = '還沒填就讀學校';
  if (!v.targets.length) {
    e.targets = kind === 'trial' ? '至少選一個想試聽的課程' : '至少選一個開課班';
  }
  if (kind === 'enrollment' && v.startDate && v.startDate < today) {
    e.startDate = '開始日期不能早於今天';
  }
  if (!v.consent) e.consent = '要先同意個資使用聲明，補習班才能聯絡你';
  return e;
}

const LABELS: Record<FieldKey, string> = {
  parentName: '家長姓名',
  email: 'Email 或手機',
  phone: 'Email 或手機',
  relation: '與學生的關係',
  studentName: '學生姓名',
  grade: '年級',
  school: '就讀學校',
  targets: '課程',
  startDate: '開始日期',
  consent: '同意聲明',
};

/** 按鈕旁那句「還沒填好：…」；沒有錯回空字串 */
export function missingSummary(kind: FormKind, errors: FieldErrors): string {
  const labels = (Object.keys(errors) as FieldKey[]).map((k) =>
    k === 'targets' && kind === 'enrollment' ? '開課班' : LABELS[k],
  );
  return labels.length ? `還沒填好：${[...new Set(labels)].join('、')}` : '';
}

export function toPayload(kind: FormKind, v: FormValues, captchaToken: string | null) {
  const optional = (s: string) => s.trim() || undefined;
  const base = {
    parent: {
      name: v.parentName.trim(),
      email: optional(v.email),
      phone: v.phone.trim() ? normalizePhone(v.phone.trim()) : undefined,
      relation: v.relation,
    },
    student: { name: v.studentName.trim(), grade: v.grade, school: v.school.trim() },
    note: optional(v.note),
    consent: true as const,
    website: optional(v.website),
    captchaToken: captchaToken ?? undefined,
  };
  return kind === 'trial'
    ? { ...base, courseIds: v.targets, preferredTimes: optional(v.preferredTimes) }
    : { ...base, classIds: v.targets, preferredStartDate: optional(v.startDate) };
}

/** 429 的 `Retry-After`（秒）換成分鐘、無條件進位；讀不到回 null（文案改寫「請稍後再試」） */
export function retryMinutes(header: string | null): number | null {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null;
}

// ─── 目錄 → 畫面上的選項 ───

export interface PublicCatalogClass {
  classId: string;
  className: string;
  gradeLevels: string[];
  courseId: string | null;
  courseName: string | null;
  subject: string | null;
  campusName: string | null;
  slots: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    /** 還沒生效的未來時段＝哪天起；已生效＝null（#1100 #22） */
    effectiveFrom?: string | null;
  }>;
  remainingSeats: number;
  fee: { amount: number; billingMode: 'monthly' | 'period' | 'session_pack' } | null;
  /** 只有暱稱；沒設暱稱的老師不在這裡（#1665 Q6） */
  teacherNicknames: string[];
}

export interface CampusContact {
  name: string;
  phone: string | null;
  address: string | null;
}

export interface PublicCatalog {
  data: PublicCatalogClass[];
  campuses: CampusContact[];
}

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];
export const gradeLabel = (g: string) => GRADE_LEVEL_LABELS[g as GradeLevel] ?? g;
const slotStart = (s: PublicCatalogClass['slots'][number]) =>
  `週${WEEKDAY[s.weekday]} ${s.startTime}`;
const slotRange = (s: PublicCatalogClass['slots'][number]) =>
  `${slotStart(s)}–${s.endTime}${effectiveFromSuffix(s.effectiveFrom)}`;

export function feeLabel(fee: PublicCatalogClass['fee']): string | null {
  if (!fee) return null;
  const unit = { monthly: '月', period: '期', session_pack: '堂數包' }[fee.billingMode];
  return `${fee.amount.toLocaleString('zh-TW')} 元／${unit}`;
}

export interface CourseOption {
  id: string;
  name: string;
  gradeLevels: string[];
  /** 「小五、小六 · 週三 18:30、週六 09:00 · 2 個班可選」 */
  detail: string;
}

export interface ClassOption {
  id: string;
  name: string;
  gradeLevels: string[];
  fee: string | null;
  /** 「週三 18:30–20:30 · 信義校 · 大文老師」（分校只在多分校時、老師只在有暱稱時） */
  detail: string;
  full: boolean;
  seats: number;
  /** 結果畫面用：「週三 18:30」 */
  start: string;
}

export interface Group<T> {
  subject: string;
  options: T[];
}

function bySubject<T>(items: Array<{ subject: string | null; option: T }>): Group<T>[] {
  const groups: Group<T>[] = [];
  for (const { subject, option } of items) {
    const name = subject ?? '其他';
    let group = groups.find((g) => g.subject === name);
    if (!group) groups.push((group = { subject: name, options: [] }));
    group.options.push(option);
  }
  return groups;
}

const multiCampus = (classes: PublicCatalogClass[]) =>
  new Set(classes.map((c) => c.campusName).filter(Boolean)).size > 1;

/** 試聽：依 courseId 合併成課程、依科目分組（目錄已依課程名排好） */
export function courseGroups(classes: PublicCatalogClass[]): Group<CourseOption>[] {
  const showCampus = multiCampus(classes);
  const courses = new Map<string, { subject: string | null; classes: PublicCatalogClass[] }>();
  for (const c of classes) {
    if (!c.courseId) continue;
    const entry = courses.get(c.courseId) ?? { subject: c.subject, classes: [] };
    entry.classes.push(c);
    courses.set(c.courseId, entry);
  }
  return bySubject(
    [...courses.entries()].map(([id, { subject, classes: list }]) => {
      const grades = [...new Set(list.flatMap((c) => c.gradeLevels))];
      const slots = list.flatMap((c) => c.slots.map(slotStart));
      const campuses = [...new Set(list.map((c) => c.campusName).filter(Boolean))];
      const parts = [
        grades.map(gradeLabel).join('、'),
        slots.join('、'),
        list.length > 1 ? `${list.length} 個班可選` : '',
        showCampus ? campuses.join('、') : '',
      ].filter(Boolean);
      return {
        subject,
        option: {
          id,
          name: list[0]!.courseName ?? '',
          gradeLevels: grades,
          detail: parts.join(' · '),
        },
      };
    }),
  );
}

/** 報名：每個開課班一列、依科目分組 */
export function classGroups(classes: PublicCatalogClass[]): Group<ClassOption>[] {
  const showCampus = multiCampus(classes);
  return bySubject(
    classes.map((c) => ({
      subject: c.subject,
      option: {
        id: c.classId,
        name: c.className,
        gradeLevels: c.gradeLevels,
        fee: feeLabel(c.fee),
        detail: [
          c.slots.map(slotRange).join('、'),
          showCampus ? c.campusName : '',
          c.teacherNicknames.join('、'),
        ]
          .filter(Boolean)
          .join(' · '),
        full: c.remainingSeats <= 0,
        seats: c.remainingSeats,
        start: c.slots.map(slotStart).join('、'),
      },
    })),
  );
}

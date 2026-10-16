import type { InvoicePaymentInfo } from '@core/invoices.service';

/** 號碼只留數字與開頭的 `+`（`0912-345 678` → `0912345678`） */
function dial(phone: string): string {
  return phone.trim().replace(/(?!^\+)[^\d]/g, '');
}

export function telHref(phone: string): string {
  return `tel:${dial(phone)}`;
}

/**
 * 簡訊（#1625）。iOS 認 `&body=`、Android 認 `?body=`，`?&body=` 兩邊都吃（計畫席 gate：先試這種，
 * 不判 UA）。ponytail: 實機若有一邊帶不進內文，改回依 UA 分支。
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${dial(phone)}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface ContactMessageInput {
  studentName: string;
  outstanding: number;
  dueDate: string | null;
  paymentInfo: readonly InvoicePaymentInfo[];
}

/** 簡訊／email 預先帶好的內文：學生、未收金額、期限、匯款帳戶（沒有的段落省略） */
export function contactMessage(input: ContactMessageInput): string {
  const due = input.dueDate
    ? `，繳費期限 ${Number(input.dueDate.slice(5, 7))}/${Number(input.dueDate.slice(8, 10))}`
    : '';
  const head = `${input.studentName} 家長您好：本期帳單尚有 NT$${input.outstanding.toLocaleString('en-US')} 未繳${due}。`;
  const info = input.paymentInfo;
  if (info.length === 0) return head;
  if (info.length === 1) return `${head}\n匯款資訊：${info[0].text}`;
  return `${head}\n匯款資訊：\n${info.map((i) => `${i.campusName ?? ''}：${i.text}`).join('\n')}`;
}

export function contactSubject(studentName: string, outstanding: number): string {
  return `【繳費提醒】${studentName} 尚有 NT$${outstanding.toLocaleString('en-US')} 未繳`;
}

import QRCode from 'qrcode';

/**
 * 學生到班卡（#1127 B）。卡上**只有**補習班名、學生名、QR（內容＝學生 id，打卡站原樣當 `studentId` 送）——
 * 卡會被帶來帶去，不放電話、生日等個資。
 *
 * 印法照收費單（`invoice-detail-dialog` 的 `printNode`）：**開一個乾淨的視窗印**，不用 `@media print` 藏東西。
 * 節點用 DOM API 建、名字只進 `textContent` —— 名字是使用者輸入。
 */
export interface CheckinCard {
  studentId: string;
  name: string;
}

type ToDataURL = (
  text: string,
  options: { errorCorrectionLevel: 'M'; margin: number; width: number },
) => Promise<string>;

/**
 * 開視窗印卡。**視窗要在點擊的同一個 tick 開**（QR 是非同步產生的，等完再開會被擋彈出視窗）。
 * 被擋回 false，讓呼叫端提示使用者。
 */
export async function printCheckinCards(cards: CheckinCard[], orgName: string): Promise<boolean> {
  const win = window.open('', '_blank', 'width=820,height=1000');
  if (!win) return false;
  await fillCheckinCards(win.document, cards, orgName);
  // 有些瀏覽器要等一個 tick 才量得到版面（同收費單）
  win.setTimeout(() => {
    win.focus();
    win.print();
    win.close();
  }, 0);
  return true;
}

export async function fillCheckinCards(
  doc: Document,
  cards: CheckinCard[],
  orgName: string,
  toDataURL: ToDataURL = QRCode.toDataURL,
): Promise<void> {
  doc.title = `到班卡（${cards.length} 張）`;
  const style = doc.createElement('style');
  style.textContent = PRINT_STYLES;
  doc.head.appendChild(style);

  const sheet = doc.createElement('div');
  sheet.className = 'sheet';
  // M 級容錯：卡片會被摺、會髒；寬度給到 240px，印在 34mm 上夠清楚
  const sources = await Promise.all(
    cards.map((c) => toDataURL(c.studentId, { errorCorrectionLevel: 'M', margin: 2, width: 240 })),
  );
  cards.forEach((card, i) => {
    const el = doc.createElement('div');
    el.className = 'card';
    el.dataset['testid'] = 'checkin-card';

    const qr = doc.createElement('img');
    qr.className = 'card__qr';
    qr.src = sources[i]!;
    qr.alt = '';

    const text = doc.createElement('div');
    text.className = 'card__text';
    const org = doc.createElement('p');
    org.className = 'card__org';
    org.textContent = orgName;
    const name = doc.createElement('p');
    name.className = 'card__name';
    name.textContent = card.name;
    const label = doc.createElement('p');
    label.className = 'card__label';
    label.textContent = '到班卡 · 到校時對準門口平板掃描';
    text.append(org, name, label);

    el.append(qr, text);
    sheet.appendChild(el);
  });
  doc.body.appendChild(sheet);
}

/**
 * 紙上的版面：信用卡尺寸（85.6×54mm），A4 直式 2 欄 × 5 列＝一頁 10 張，虛線是裁切線。
 * 螢幕的 design token 在新視窗裡不存在，所以是自足的絕對值（同收費單）。
 */
const PRINT_STYLES = `
  @page { size: A4; margin: 12mm 19mm; }
  body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; color: #18181b; }
  .sheet { display: grid; grid-template-columns: repeat(2, 85.6mm); grid-auto-rows: 54mm; }
  .card { box-sizing: border-box; display: flex; align-items: center; gap: 4mm; padding: 4mm;
    border: 1px dashed #a1a1aa; break-inside: avoid; }
  .card__qr { width: 34mm; height: 34mm; flex: none; }
  .card__text { min-width: 0; }
  .card__org { margin: 0; font-size: 9pt; color: #52525b; }
  .card__name { margin: 2mm 0; font-size: 16pt; font-weight: 700; overflow-wrap: anywhere; }
  .card__label { margin: 0; font-size: 7.5pt; color: #71717a; }
`;

import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 身分 chip —— 類別、種類、所屬。
 *
 * **它沒有 severity 參數，這是刻意的。** 全站 61 個 `p-tag` 裡有一半是
 * `severity="secondary"`，而那半數其實混了兩種不相干的東西：身分標籤
 * （考試類型、異動類型、校區）與狀態的「還沒達成」態。同一顆灰膠囊兩種語意，
 * 讀的人得自己猜。拆成兩支元件之後，**沒有那個參數就沒有人會誤用它表達狀態**。
 *
 * 「校內考」並不比「學校段考」嚴重，所以這一支永遠是中性的。
 * 要表達狀態請用 `app-status-dot`。
 */
@Component({
  selector: 'app-data-chip',
  imports: [],
  templateUrl: './data-chip.component.html',
  styleUrl: './data-chip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataChipComponent {}

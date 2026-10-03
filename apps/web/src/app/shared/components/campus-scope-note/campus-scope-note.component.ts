import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CampusContextService } from '@core/campus-context.service';

/**
 * 列表空了、而頂欄只看某一間分校時，告訴使用者「空」的範圍（#1138）。
 * 「清除篩選」刻意不動分校（它是全站 context），所以沒有這句話的話，
 * 使用者清了篩選還是空的、而且不知道為什麼。
 *
 * 只在**這一頁有接頂欄**（`inUse`）而且選了特定分校時出現。
 */
@Component({
  selector: 'app-campus-scope-note',
  templateUrl: './campus-scope-note.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampusScopeNoteComponent {
  private readonly campusCtx = inject(CampusContextService);
  protected readonly name = computed(() => (this.campusCtx.inUse() ? this.campusCtx.name() : null));
}

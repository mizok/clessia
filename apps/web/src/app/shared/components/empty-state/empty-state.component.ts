import { Component, booleanAttribute, input } from '@angular/core';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CampusScopeNoteComponent],
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly icon = input<string>('pi pi-inbox');
  readonly title = input.required<string>();
  readonly description = input<string>();
  /** 這個空狀態的範圍受頂欄分校影響（#1138）：選了分校時多一句「目前只看 X」 */
  readonly campusScoped = input(false, { transform: booleanAttribute });
}

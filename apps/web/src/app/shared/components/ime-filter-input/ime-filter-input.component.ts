import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-ime-filter-input',
  imports: [IconFieldModule, InputTextModule, InputIconModule],
  templateUrl: './ime-filter-input.component.html',
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImeFilterInputComponent {
  readonly placeholder = input('搜尋...');
  readonly filterChange = output<string>();

  protected onInput(e: Event): void {
    if ((e as InputEvent).isComposing) return;
    this.filterChange.emit((e.target as HTMLInputElement).value);
  }

  protected onCompositionEnd(e: CompositionEvent): void {
    this.filterChange.emit((e.target as HTMLInputElement).value);
  }
}

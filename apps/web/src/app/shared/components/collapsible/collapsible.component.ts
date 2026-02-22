import { Component, input } from '@angular/core';

@Component({
  selector: 'app-collapsible',
  imports: [],
  templateUrl: './collapsible.component.html',
  styleUrl: './collapsible.component.scss',
})
export class CollapsibleComponent {
  readonly collapsed = input(true);
}

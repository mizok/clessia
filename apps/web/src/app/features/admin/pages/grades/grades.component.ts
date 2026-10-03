import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-grades',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './grades.component.html',
  host: { class: 'block' },
})
export class GradesComponent {}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';

@Component({
  selector: 'app-subjects-page',
  imports: [SubjectManagerComponent],
  templateUrl: './subjects.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubjectsPage {}

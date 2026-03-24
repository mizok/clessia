import { Component } from '@angular/core';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-enrollment',
  imports: [InlineNoticeComponent],
  templateUrl: './enrollment.component.html',
  styleUrl: './enrollment.component.scss',
  host: { class: 'u-centered-flex' },
})
export class EnrollmentComponent {

}

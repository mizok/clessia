import { Component } from '@angular/core';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-qr-checkin',
  imports: [InlineNoticeComponent],
  templateUrl: './qr-checkin.component.html',
  styleUrl: './qr-checkin.component.scss',
  host: { class: 'u-centered-flex' },
})
export class QrCheckinComponent {

}

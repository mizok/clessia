import { Component } from '@angular/core';

import { ApplicationFormComponent } from '../application-form/application-form.component';

/** `/enrollment`：A6 公開報名（#1665），版面與流程在 ApplicationFormComponent */
@Component({
  selector: 'app-enrollment',
  imports: [ApplicationFormComponent],
  template: '<app-application-form kind="enrollment" />',
  host: { class: 'flex w-full justify-center' },
})
export class EnrollmentComponent {}

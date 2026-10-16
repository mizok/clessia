import { Component } from '@angular/core';

import { ApplicationFormComponent } from '../application-form/application-form.component';

/** `/trial`：A6 公開試聽申請（#1665），版面與流程在 ApplicationFormComponent */
@Component({
  selector: 'app-trial',
  imports: [ApplicationFormComponent],
  template: '<app-application-form kind="trial" />',
  host: { class: 'flex w-full justify-center' },
})
export class TrialComponent {}

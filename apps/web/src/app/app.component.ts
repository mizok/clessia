import { Component, inject, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectRoleComponent } from '@features/select-role/select-role.component';
import { WindowSizeDirective } from '@shared/directives/window-size.directive';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WindowSizeDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly dialogService = inject(DialogService);
  private ref: DynamicDialogRef<SelectRoleComponent> | undefined | null;

  constructor() {
    effect(() => {
      if (this.auth.showRolePicker()) {
        this.openRolePicker();
      } else {
        this.ref?.close();
      }
    });
  }

  private openRolePicker() {
    this.ref = this.dialogService.open(SelectRoleComponent, {
      width: '400px',
      showHeader: false, // Hide default header
      closable: false,
      modal: true,
      contentStyle: { overflow: 'auto' },
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
    });

    this.ref?.onClose.subscribe((role) => {
      if (role) {
        this.auth.navigateToRoleShell(role);
      } else {
        // If closed without selection (e.g. programmatically), ensure state is sync
        this.auth.closeRolePicker();
      }
    });
  }
}
  
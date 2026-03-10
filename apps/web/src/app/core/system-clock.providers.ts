import { inject, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import { SystemClockService } from './system-clock.service';

export function provideSystemClock(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      const systemClockService = inject(SystemClockService);
      return systemClockService.initialize();
    }),
  ]);
}

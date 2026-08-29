import { registerLocaleData } from '@angular/common';
import localeZhTW from '@angular/common/locales/zh-Hant';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { authInterceptor } from '@core/auth.interceptor';
import { provideSystemClock } from '@core/system-clock.providers';

registerLocaleData(localeZhTW, 'zh-TW');

// Clessia Design System - PrimeNG Theme Preset
// Based on Aura with zinc primary + sky accent
const ClessiaPreset = definePreset(Aura, {
  semantic: {
    // Primary uses zinc for buttons, header, sidebar consistency
    primary: {
      50: '#fafafa',
      100: '#f4f4f5',
      200: '#e4e4e7',
      300: '#d4d4d8',
      400: '#a1a1aa',
      500: '#71717a',
      600: '#52525b',
      700: '#3f3f46',
      800: '#27272a',
      900: '#18181b',
      950: '#09090b',
    },
    // Focus ring uses sky blue for accessibility
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '#0ea5e9', // sky-500
      offset: '2px',
    },
    // Color scheme specific tokens
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        formField: {
          borderColor: '#e4e4e7', // zinc-200
          hoverBorderColor: '#a1a1aa', // zinc-400
          focusBorderColor: '#0ea5e9', // sky-500
        },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      // 43 條路由全部 lazy 是為了初始 bundle 小，但沒有預載的話每頁第一次進入都要
      // 現場下載 chunk —— 使用者的體感是「每次跳轉都有微小延遲」。首屏渲染完之後
      // 讓瀏覽器閒時把其餘 chunk 拉完，初始 bundle 的大小不受影響。
      withPreloading(PreloadAllModules),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: ClessiaPreset,
        options: {
          prefix: 'p',
          darkModeSelector: '.dark-mode',
          cssLayer: false,
        },
      },
      ripple: true,
    }),
    provideSystemClock(),
  ],
};

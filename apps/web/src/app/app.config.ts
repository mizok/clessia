import { registerLocaleData } from '@angular/common';
import localeZhTW from '@angular/common/locales/zh-Hant';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withNavigationErrorHandler,
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
import {
  handleChunkNavigationError,
  provideChunkRecovery,
} from '@core/chunk-recovery.providers';

registerLocaleData(localeZhTW, 'zh-TW');

// Clessia Design System - PrimeNG Theme Preset
// Based on Aura with zinc primary + sky accent
const ClessiaPreset = definePreset(Aura, {
  // Aura 的 `info` severity 直接吃 `{sky.100}` / `{sky.700}`（見
  // @primeuix/themes/dist/aura/tag/index.mjs），而 `info` 是本專案好幾支清單
  // 「沒有特殊狀態」的 fallback —— 結果是課堂管理整張表被天藍 chip 佔滿，
  // 那是全站最大一片上一代的顏色。
  //
  // 改 Tag 一支元件不夠：Message、Button、Badge 的 info 都指向同一組 sky。
  // 所以直接換掉**原始調色盤**，一處生效，而且之後誰再寫 info 也回不去天藍。
  //
  // 換成暖中性而不是換成另一個彩色：`info` 在這裡的語意是「正常」，
  // 正常狀態不該喊話 —— 讓真的有事的 warn / danger / success 站出來。
  primitive: {
    // Aura 的 `warn` severity 吃 `{orange.100}` / `{orange.700}`。方向 D 之後
    // 橘專屬品牌（accent），警示一律琥珀 —— 所以連 PrimeNG 的 orange 一起換掉，
    // 否則 Tag / Message / Button 的 warn 會用品牌色喊「這裡有問題」。
    //
    // 值就是琥珀階（與 styles.scss 的 `--warning-*` 同一組），對比實測：
    // 700 壓在 100 上 4.51:1、壓在 200（hover）上 4.03:1 ——
    // 所以 chip 內文字在我們自己的 SCSS 裡用 800；PrimeNG 的 Tag 沒有 hover，
    // 維持它預設的 700 即可。
    orange: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
      950: '#451a03',
    },
    sky: {
      50: '#faf9f8',
      100: '#f2efed',
      200: '#ebe7e4',
      300: '#ddd8d4',
      400: '#a89f99',
      500: '#786f69',
      600: '#57504b',
      700: '#3d3733',
      800: '#2a2523',
      900: '#1a1614',
      950: '#0f0d0c',
    },
  },
  semantic: {
    // Primary 是暖橘 —— PrimeNG 的按鈕、選中態、連結都從這裡取色，
    // 所以這一層換掉，17 頁的元件會一起跟上。
    //
    // **500 必須對白 >= 4.5**：主按鈕是 primary-500 底配白字。
    // 亮橘 #ff6a3d 只有 2.85:1，所以那一階不能放在這裡 ——
    // 它留給大色面（--accent-vivid），那種面上配的是近黑字。
    primary: {
      50: '#fff0ea',
      100: '#ffdcce',
      200: '#ffc9b3',
      300: '#ffa585',
      400: '#e85a2a',
      500: '#c93f14',
      600: '#a8340f',
      700: '#8c2a0b',
      800: '#6f2108',
      900: '#571a06',
      950: '#3d1204',
    },
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '#c93f14', // accent-500
      offset: '2px',
    },
    // Color scheme specific tokens
    colorScheme: {
      light: {
        // 跟 styles.scss 的 --zinc-* 同一組暖中性階。兩邊不同步的話，
        // PrimeNG 元件會是冷灰、周圍的自訂樣式是暖灰，同框就露餡。
        surface: {
          0: '#ffffff',
          50: '#faf9f8',
          100: '#f5f3f1',
          200: '#ebe7e4',
          300: '#ddd8d4',
          400: '#a89f99',
          500: '#786f69',
          600: '#57504b',
          700: '#3d3733',
          800: '#2a2523',
          900: '#1a1614',
          950: '#0f0d0c',
        },
        formField: {
          borderColor: '#ebe7e4', // zinc-200
          hoverBorderColor: '#a89f99', // zinc-400
          focusBorderColor: '#c93f14', // accent-500
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
      // 部署後舊分頁要不到新 chunk 時，導覽會失敗而 router 把網址復原 ——
      // 畫面就停在空白。這裡攔下來自動重載一次。
      // 預載失敗走的是另一條路（全域 ErrorHandler → 提示條），
      // 理由見 kb/wiki/architecture/chunk-load-recovery.md。
      withNavigationErrorHandler(handleChunkNavigationError),
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
    ...provideChunkRecovery(),
  ],
};

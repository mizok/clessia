// ESLint（#2542）。設計與每條規則為什麼開／為什麼不開：kb/wiki/architecture/lint.md
//
// **只開會抓真 bug 的規則。** 型別嚴格度（no-unsafe-*）與風格類刻意不開 —— 那是另一個決定，
// 不能為了「lint 有在跑」混進來。c5（feature 不互 import）與分層方向由 harness A18 守，不在這裡。
//
// 存量用 ESLint 原生 bulk suppressions（各 project 的 eslint-suppressions.json）當 ratchet：
// 新違規照紅；修掉的要 `--prune-suppressions`；harness 擋帳上筆數比 origin/main 多。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.js', '**/*.mjs', '**/*.cjs', 'tmp/**'],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.base],
    processor: angular.processInlineTemplates,
    plugins: { '@angular-eslint': angular.tsPlugin },
    languageOptions: {
      parserOptions: {
        project: [
          'apps/web/tsconfig.app.json',
          'apps/web/tsconfig.spec.json',
          'apps/api/tsconfig.json',
          'packages/shared-types/tsconfig.json',
          'packages/validators/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript 編譯器已經在查的，關掉核心版（不然重複報、而且對型別不準）
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      // Prettier 排出來的 `\n  [i].foo()` 鏈式是合法的
      'no-unexpected-multiline': 'off',
      // 中文字串裡的全形空白是內容
      'no-irregular-whitespace': 'off',

      // tsconfig 沒開 noUnusedLocals：死 import／死變數目前沒有人抓
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // 沒人接的 rejection。Router.navigate 回的 Promise 失敗由 router 自己處理（導去錯誤），列為已知安全
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: '@angular/router', name: ['navigate', 'navigateByUrl'] },
          ],
        },
      ],
      // `subscribe({ error: async () => … })` 這類：async 回呼丟的錯沒有人接
      '@typescript-eslint/no-misused-promises': 'error',
      // await 一個不是 Promise 的值 —— 以為有等，其實沒有
      '@typescript-eslint/await-thenable': 'error',
      // output 名稱撞 DOM 事件（close／change…），父層會收到兩次
      '@angular-eslint/no-output-native': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.html'],
    plugins: { '@angular-eslint/template': angular.templatePlugin },
    languageOptions: { parser: angular.templateParser },
    rules: {
      '@angular-eslint/template/banana-in-box': 'error',
      '@angular-eslint/template/no-negated-async': 'error',
      // `!= null` 同時擋 null 與 undefined，是刻意的寫法
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],

      // a11y（#2558）：angular-eslint templateAccessibility 的全套。存量記在 web 的 suppressions 帳，
      // 要真修（label 用 for/id 或包住 input、click 元素補 keydown＋tabindex 或改 button），不加 disable
      '@angular-eslint/template/alt-text': 'error',
      '@angular-eslint/template/click-events-have-key-events': 'error',
      '@angular-eslint/template/elements-content': 'error',
      '@angular-eslint/template/interactive-supports-focus': 'error',
      '@angular-eslint/template/label-has-associated-control': 'error',
      '@angular-eslint/template/mouse-events-have-key-events': 'error',
      '@angular-eslint/template/no-autofocus': 'error',
      '@angular-eslint/template/no-distracting-elements': 'error',
      '@angular-eslint/template/role-has-required-aria': 'error',
      '@angular-eslint/template/table-scope': 'error',
      '@angular-eslint/template/valid-aria': 'error',
    },
  },
);

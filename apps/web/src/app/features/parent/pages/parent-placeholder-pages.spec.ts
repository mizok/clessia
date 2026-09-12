import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { RoutesCatalog, type RouteObj } from '@core/smart-enums/routes-catalog';

import { AddCourseComponent } from './add-course/add-course.component';
import { EnrollmentComponent } from './enrollment/enrollment.component';
import { MealsComponent } from './meals/meals.component';
import { RenewalComponent } from './renewal/renewal.component';
import { ScheduleComponent } from './schedule/schedule.component';
import { TrialComponent } from './trial/trial.component';

/**
 * 家長端有六頁是同一個 `EmptyStateComponent` 佔位頁，元件逐字同構。
 *
 * **寫成一支表格驅動的測試而不是六份複本**：六份會各自腐化，而這條不變量
 * （「空狀態圖示跟選單圖示是同一個」）對六頁的意義完全相同。
 *
 * #708：原本六頁的圖示是寫死在 `template` 字串裡的，**四頁跟 `RoutesCatalog`
 * 的選單圖示不一致** —— 選單上是耳機、點進去是星星。標題早就是 `page().label`
 * 了，圖示不跟，是個會讓下一個人誤會兩者同源的形狀。
 */
const PLACEHOLDER_PAGES: ReadonlyArray<{
  readonly name: string;
  readonly component: Type<unknown>;
  readonly route: RouteObj;
}> = [
  { name: '課表查看', component: ScheduleComponent, route: RoutesCatalog.PARENT_SCHEDULE },
  { name: '試聽申請', component: TrialComponent, route: RoutesCatalog.PARENT_TRIAL },
  { name: '報名申請', component: EnrollmentComponent, route: RoutesCatalog.PARENT_ENROLLMENT },
  { name: '加選課程', component: AddCourseComponent, route: RoutesCatalog.PARENT_ADD_COURSE },
  { name: '續課資訊', component: RenewalComponent, route: RoutesCatalog.PARENT_RENEWAL },
  { name: '餐費紀錄', component: MealsComponent, route: RoutesCatalog.PARENT_MEALS },
];

describe('家長端的六支 EmptyState 佔位頁', () => {
  async function render(
    component: Type<unknown>,
    route: RouteObj,
  ): Promise<ComponentFixture<unknown>> {
    await TestBed.configureTestingModule({ imports: [component] }).compileComponents();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput('page', route);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  for (const { name, component, route } of PLACEHOLDER_PAGES) {
    describe(name, () => {
      it('空狀態圖示跟選單圖示是同一個（#708）', async () => {
        const fixture = await render(component, route);

        const icon = fixture.nativeElement.querySelector('.empty-state__icon i') as HTMLElement;
        expect(icon).toBeTruthy();
        expect(icon.className.split(/\s+/)).toContain(route.icon);
      });

      it('標題用路由標籤', async () => {
        const fixture = await render(component, route);

        expect(
          fixture.nativeElement.querySelector('.empty-state__title')?.textContent?.trim(),
        ).toBe(route.label);
      });

      /**
       * 地圖（`kb/wiki/specs/sitemap/parent/*.md`）對這六頁的兩向比對結論是
       * 「`<main>` 內可見互動元素 0 個」。**釘住它** —— 之後有人往
       * `<ng-content>` 投影一顆按鈕進去，地圖就過期了。
       */
      it('沒有任何互動元素 —— 地圖的兩向比對結論靠這條守著', async () => {
        const fixture = await render(component, route);

        const interactive = fixture.nativeElement.querySelectorAll(
          'a,button,input,select,textarea,[role="button"]',
        );
        expect(interactive.length).toBe(0);
      });
    });
  }
});

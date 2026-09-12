import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';

import { ChildScopeGateComponent } from './child-scope-gate.component';

/**
 * #749：**0 個孩子的家長看到的不是空白，是「今日無課」「目前沒有帳單紀錄」。**
 *
 * 那是在**正面斷言一件不存在的事** —— 家長合理的解讀是「一切正常，最近沒事」，
 * 而實際情況是「這個帳號還沒被綁上任何學生」。兩者的下一步完全不同。
 *
 * `ChildScopeService` 的註解預言過這個形狀（`failed` 必須跟「沒有孩子」分開），
 * **但只解決了 `failed` 那一半**。
 *
 * 修在這一支共用元件裡，**不是逐頁補文案** —— 否則四頁會各自長出一種說法。
 */
@Component({
  imports: [ChildScopeGateComponent],
  template: `<app-child-scope-gate><p class="page-body">今日無課</p></app-child-scope-gate>`,
})
class HostComponent {}

describe('ChildScopeGateComponent（#749）', () => {
  let fixture: ComponentFixture<HostComponent>;

  const children = signal<Array<{ id: string; name: string }>>([]);
  const status = signal<'unloaded' | 'ready' | 'failed'>('unloaded');

  async function render() {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            children: children.asReadonly(),
            status: status.asReadonly(),
            activeChild: () => null,
            activeChildId: () => null,
            canSwitch: () => false,
            load: vi.fn(),
            setActiveChild: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = () => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const body = () => fixture.nativeElement.querySelector('.page-body');

  it('沒有綁定學生時給一句明確的話，而且不渲染頁面內容', async () => {
    children.set([]);
    status.set('ready');
    await render();

    expect(text()).toContain('還沒有綁定任何學生');
    // **頁面內容不能出現** —— 它講的是不成立的事
    expect(body()).toBeNull();
    expect(text()).not.toContain('今日無課');
  });

  /**
   * **反向對照 1**：有孩子時一個字都不能多。
   */
  it('有孩子時照常渲染頁面內容，不出現那句話', async () => {
    children.set([{ id: 'c1', name: '王小明' }]);
    status.set('ready');
    await render();

    expect(body()).toBeTruthy();
    expect(text()).toContain('今日無課');
    expect(text()).not.toContain('還沒有綁定任何學生');
  });

  /**
   * **反向對照 2 —— 這一條最容易寫錯。**
   *
   * `children()` 在載入完成**之前**也是空陣列。只看長度的話，
   * **每一次進頁都會先閃一下「你沒有綁定學生」再變回正常** ——
   * 那比原本的缺陷更糟，因為它對有孩子的家長也說謊。
   *
   * 所以條件是 `status() === 'ready' && children().length === 0`。
   */
  it('還在載入（status 是 unloaded）時不給那句話，也不擋內容', async () => {
    children.set([]);
    status.set('unloaded');
    await render();

    expect(text()).not.toContain('還沒有綁定任何學生');
    expect(body()).toBeTruthy();
  });

  /**
   * **反向對照 3**：`failed` 跟「沒有孩子」是兩件事（`ChildScopeService` 的註解明講）。
   * 讀不到資料時不能說「你沒有綁定學生」—— 那是把不知道講成確定。
   */
  it('讀取失敗時不說「沒有綁定學生」', async () => {
    children.set([]);
    status.set('failed');
    await render();

    expect(text()).not.toContain('還沒有綁定任何學生');
  });
});

import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MenuItem } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopupMenuComponent } from './popup-menu.component';

@Component({
  standalone: true,
  imports: [PopupMenuComponent],
  template: `
    <button #trigger type="button" (click)="onTriggerClick($event)">open</button>
    <app-popup-menu #menu [model]="items" />
  `,
})
class HostComponent {
  readonly menu = viewChild.required<PopupMenuComponent>('menu');
  items: MenuItem[] = [];

  onTriggerClick(event: Event): void {
    this.menu().toggle(event);
  }
}

describe('PopupMenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  afterEach(() => {
    // 清掉殘留的 overlay container，避免測試互相污染
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  function querySelectorAllItems(): NodeListOf<HTMLElement> {
    return document.querySelectorAll<HTMLElement>('.popup-menu__item');
  }

  it('show 時會把 menu 內容 portal 到 body', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [
      { label: '檢視', icon: 'pi pi-eye' },
      { label: '刪除', icon: 'pi pi-trash' },
    ];
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const items = querySelectorAllItems();
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('檢視');
    expect(items[1].textContent).toContain('刪除');
  });

  it('toggle 連續呼叫會切換開關狀態', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [{ label: 'Only' }];
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    expect(querySelectorAllItems().length).toBe(1);

    trigger.click();
    fixture.detectChanges();
    expect(querySelectorAllItems().length).toBe(0);
  });

  it('點擊項目會執行 command 並關閉 overlay', () => {
    const command = vi.fn();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [{ label: '執行', command }];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const item = querySelectorAllItems()[0];
    item.click();
    fixture.detectChanges();

    expect(command).toHaveBeenCalledTimes(1);
    expect(querySelectorAllItems().length).toBe(0);
  });

  it('disabled 項目不會觸發 command', () => {
    const command = vi.fn();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [{ label: '禁用', disabled: true, command }];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const item = querySelectorAllItems()[0];
    expect(item.hasAttribute('disabled')).toBe(true);
    item.click();
    fixture.detectChanges();

    expect(command).not.toHaveBeenCalled();
  });

  it('separator 會渲染為 role="separator" 而非 button', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [
      { label: 'A' },
      { separator: true },
      { label: 'B' },
    ];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const separators = document.querySelectorAll('.popup-menu__separator');
    expect(separators.length).toBe(1);
    expect(querySelectorAllItems().length).toBe(2);
  });

  it('component destroy 時會釋放 overlay', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items = [{ label: 'x' }];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(querySelectorAllItems().length).toBe(1);

    fixture.destroy();
    expect(querySelectorAllItems().length).toBe(0);
  });
});

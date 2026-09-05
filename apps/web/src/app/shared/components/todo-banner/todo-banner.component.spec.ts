import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TodoBannerComponent } from './todo-banner.component';

@Component({
  selector: 'app-todo-banner-host',
  imports: [TodoBannerComponent],
  template: `
    <app-todo-banner [count]="count" [active]="active" [icon]="icon" (action)="onAction()">
      有 <strong>{{ count }}</strong> 筆待處理
    </app-todo-banner>
  `,
})
class HostComponent {
  count = 0;
  active = false;
  icon = 'pi-exclamation-circle';
  actionCount = 0;
  onAction(): void {
    this.actionCount++;
  }
}

describe('TodoBannerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('count 為 0 時不渲染任何東西', () => {
    host.count = 0;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('count > 0 時渲染可點的橫幅，內容是投影進來的訊息', () => {
    host.count = 3;
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('3');
    expect(button.textContent).toContain('筆待處理');
  });

  it('點擊會發出 action 事件', () => {
    host.count = 1;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    expect(host.actionCount).toBe(1);
  });

  it('active 為 true 時加上 active class 與 aria-pressed', () => {
    host.count = 1;
    host.active = true;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.classList).toContain('todo-banner--active');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('active 未指定時預設 false，aria-pressed 是 false', () => {
    host.count = 1;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.classList).not.toContain('todo-banner--active');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('icon 未指定時用預設的驚嘆號圖示', () => {
    host.count = 1;
    fixture.detectChanges();
    const icon: HTMLElement = fixture.nativeElement.querySelector('.todo-banner__icon');
    expect(icon.className).toContain('pi-exclamation-circle');
  });

  it('icon 指定時覆蓋預設圖示', () => {
    host.count = 1;
    host.icon = 'pi-clock';
    fixture.detectChanges();
    const icon: HTMLElement = fixture.nativeElement.querySelector('.todo-banner__icon');
    expect(icon.className).toContain('pi-clock');
    expect(icon.className).not.toContain('pi-exclamation-circle');
  });
});

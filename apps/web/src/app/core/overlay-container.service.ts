import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class OverlayContainerService {
  private readonly containerElement = signal<HTMLElement | null>(null);

  /**
   * 註冊全域的 Overlay 容器元素
   * 通常由最外層的 Shell 或 Layout 元件呼叫
   */
  registerContainer(element: HTMLElement): void {
    this.containerElement.set(element);
  }

  /**
   * 清除註冊的 Overlay 容器元素
   */
  clearContainer(): void {
    this.containerElement.set(null);
  }

  /**
   * 取得目前的 Overlay 容器元素
   * 如果沒有註冊，則回傳 null
   */
  getContainer(): HTMLElement | null {
    return this.containerElement();
  }

  /**
   * 取得目前的 Overlay 容器元素，作為 Signal
   * 可用於 computed 或 effect 中響應式地獲取
   */
  getContainerSignal() {
    return this.containerElement.asReadonly();
  }
}

import { Component, viewChild } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AccordionDirective } from './accordion.directive';

@Component({
  standalone: true,
  imports: [AccordionDirective],
  template: `<div appAccordion #acc="appAccordion"></div>`,
})
class HostComponent {
  readonly acc = viewChild.required(AccordionDirective);
}

@Component({
  standalone: true,
  imports: [AccordionDirective],
  template: `<div appAccordion [multi]="true" #acc="appAccordion"></div>`,
})
class MultiHostComponent {
  readonly acc = viewChild.required(AccordionDirective);
}

describe('AccordionDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('should create an instance', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  // 側邊選單用的是這個預設模式（sidebar.component.html 沒帶 [multi]）——
  // 展開一組要把上一組收掉，這是手風琴存在的理由。
  it('預設是手風琴：展開一組會收掉另一組', () => {
    const acc = fixture.componentInstance.acc();
    acc.toggle('a');
    expect(acc.isOpen('a')).toBe(true);

    acc.toggle('b');
    expect(acc.isOpen('a')).toBe(false);
    expect(acc.isOpen('b')).toBe(true);
  });
});

// sidebar.component.html 帶 [multi]="true"（Tester #35：想同時瞄兩個群組）
describe('AccordionDirective —— multi 模式', () => {
  let fixture: ComponentFixture<MultiHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MultiHostComponent);
    fixture.detectChanges();
  });

  it('多組可以同時展開，互不影響', () => {
    const acc = fixture.componentInstance.acc();
    acc.toggle('a');
    acc.toggle('b');

    expect(acc.isOpen('a')).toBe(true);
    expect(acc.isOpen('b')).toBe(true);
  });

  it('再點一次只收掉自己那組', () => {
    const acc = fixture.componentInstance.acc();
    acc.toggle('a');
    acc.toggle('b');
    acc.toggle('a');

    expect(acc.isOpen('a')).toBe(false);
    expect(acc.isOpen('b')).toBe(true);
  });
});

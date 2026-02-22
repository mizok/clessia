import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AccordionDirective } from './accordion.directive';

@Component({
  standalone: true,
  imports: [AccordionDirective],
  template: `<div appAccordion></div>`,
})
class HostComponent {}

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
});

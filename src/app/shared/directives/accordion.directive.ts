import { Directive, input, signal } from '@angular/core';

@Directive({
  selector: '[appAccordion]',
  standalone: true,
  exportAs: 'appAccordion',
})
export class AccordionDirective {
  /** Whether to allow multiple items to be open at once. Default: false (accordion behavior) */
  readonly multi = input(false);

  // Store open item IDs
  private readonly openItems = signal<Set<string>>(new Set());

  // Helper to check if item is open
  isOpen(id: string): boolean {
    return this.openItems().has(id);
  }

  toggle(id: string) {
    this.openItems.update(current => {
      const isCurrentlyOpen = current.has(id);
      
      if (this.multi()) {
        const newSet = new Set(current);
        if (isCurrentlyOpen) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      } else {
        // Single mode (Accordion)
        if (isCurrentlyOpen) {
          return new Set(); // Close itself -> nothing open
        } else {
          return new Set([id]); // Open this one, close others
        }
      }
    });
  }

  expand(id: string) {
    this.openItems.update(current => {
       if (this.multi()) {
         const newSet = new Set(current);
         newSet.add(id);
         return newSet;
       } else {
         return new Set([id]);
       }
    });
  }
  
  collapseAll() {
    this.openItems.set(new Set());
  }
}

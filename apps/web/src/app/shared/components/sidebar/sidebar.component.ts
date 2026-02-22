import { Component, inject, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavigationService, type NavItem } from '@core/navigation.service';
import { CollapsibleComponent } from '@shared/components/collapsible/collapsible.component';
import { AccordionDirective } from '@shared/directives/accordion.directive';

interface NavGroup {
  readonly label?: string;
  readonly items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CollapsibleComponent, AccordionDirective],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  host: {
    class: 'sidebar',
  },
})
export class SidebarComponent {
  private readonly nav = inject(NavigationService);
  
  readonly groupedNav = computed<NavGroup[]>(() => {
    const items = this.nav.navItems();
    
    if (items.length === 0) return [];

    // Sort: Ungrouped items first, then grouped items
    const groupedItems = items.filter(item => !!item.group);
    const ungroupedItems = items.filter(item => !item.group);
    const sortedItems = [...ungroupedItems, ...groupedItems];

    let currentGroupLabel: string | undefined = sortedItems[0].group;
    let currentGroupItems: NavItem[] = [sortedItems[0]];
    const groups: NavGroup[] = [];

    for (let i = 1; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      if (item.group === currentGroupLabel) {
        currentGroupItems.push(item);
      } else {
        // Close previous group
        groups.push({
          label: currentGroupLabel,

          items: currentGroupItems
        });
        // Start new group
        currentGroupLabel = item.group;
        currentGroupItems = [item];
      }
    }
    
    // Push last group
    groups.push({
      label: currentGroupLabel,
      items: currentGroupItems
    });

    return groups;
  });

  handleScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    // Wait for animation frame to ensure layout update (if expanding)
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });
  }
}

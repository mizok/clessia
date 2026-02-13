import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavigationService, type NavItem } from '@core/navigation.service';

interface NavGroup {
  readonly label?: string;
  readonly items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  host: {
    class: 'sidebar',
  },
})
export class SidebarComponent {
  private readonly nav = inject(NavigationService);
  readonly navItems = this.nav.navItems;

  protected get groupedNav(): NavGroup[] {
    const items = this.navItems();
    const ungrouped: NavItem[] = [];
    const groupMap = new Map<string, NavItem[]>();

    for (const item of items) {
      if (item.group) {
        if (!groupMap.has(item.group)) groupMap.set(item.group, []);
        groupMap.get(item.group)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    const groups: NavGroup[] = [];
    if (ungrouped.length > 0) groups.push({ items: ungrouped });
    for (const [label, groupItems] of groupMap) {
      groups.push({ label, items: groupItems });
    }
    return groups;
  }
}

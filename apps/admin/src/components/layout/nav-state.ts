/**
 * Per-browser sidebar state: which items the user pinned to the top and which groups are
 * collapsed. Pure helpers plus two persistent stores, so the sidebar itself stays dumb.
 */
import { createPersistentStore } from "@/lib/persistent-store";
import { flattenItems, type NavGroup, type NavItem } from "./nav";

export const pinnedStore = createPersistentStore<string[]>("nav-pinned", []);
/** Groups the user collapsed. Everything starts open, so new groups show up open too. */
export const collapsedGroupsStore = createPersistentStore<string[]>("nav-collapsed-groups", []);

export function togglePinned(to: string) {
  pinnedStore.set((pins) => (pins.includes(to) ? pins.filter((pin) => pin !== to) : [...pins, to]));
}

export function setGroupOpen(label: string, open: boolean) {
  collapsedGroupsStore.set((groups) => {
    const without = groups.filter((group) => group !== label);
    return open ? without : [...without, label];
  });
}

/**
 * Moves pinned items out of the menu into one list, in pin order. A pinned parent leaves
 * its sub-pages behind, promoted to the group's top level. Pins that point at items that
 * no longer exist (or are behind a feature flag) are ignored; empty groups disappear.
 */
export function splitPinned(
  groups: NavGroup[],
  pins: string[],
): { pinned: NavItem[]; groups: NavGroup[] } {
  const byTo = new Map(
    flattenItems(groups.flatMap((group) => group.items)).map((item) => [item.to, item]),
  );
  const pinned = pins.flatMap((to) => {
    const item = byTo.get(to);
    return item ? [{ ...item, children: undefined }] : [];
  });
  const pinnedTo = new Set(pinned.map((item) => item.to));
  const strip = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => {
      const children = strip(item.children ?? []);
      if (pinnedTo.has(item.to)) return children;
      return [{ ...item, children: children.length > 0 ? children : undefined }];
    });
  const rest = groups
    .map((group) => ({ ...group, items: strip(group.items) }))
    .filter((group) => group.items.length > 0);
  return { pinned, groups: rest };
}

function matches(item: NavItem, pathname: string) {
  if (item.exact || item.to === "/") return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * Where the current page sits in the menu: its group and the parents above it (so the
 * sidebar can open them). The longest matching path wins.
 */
export function activeTrail(
  groups: NavGroup[],
  pathname: string,
): { group?: string; to: string; parents: string[] } | undefined {
  let best: { group?: string; to: string; parents: string[]; length: number } | undefined;
  const visit = (items: NavItem[], group: string | undefined, parents: string[]) => {
    for (const item of items) {
      if (matches(item, pathname) && (!best || item.to.length > best.length)) {
        best = { group, to: item.to, parents, length: item.to.length };
      }
      visit(item.children ?? [], group, [...parents, item.to]);
    }
  };
  for (const group of groups) visit(group.items, group.label, []);
  return best && { group: best.group, to: best.to, parents: best.parents };
}

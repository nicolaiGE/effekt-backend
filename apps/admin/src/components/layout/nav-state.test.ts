import { describe, expect, it } from "vitest";
import { HouseIcon } from "lucide-react";
import type { NavGroup, NavItem } from "./nav";
import { activeTrail, splitPinned } from "./nav-state";

const item = (to: string, exact = false, children?: NavItem[]) => ({
  to,
  label: to,
  icon: HouseIcon,
  exact,
  children,
});
const groups: NavGroup[] = [
  { items: [item("/", true)] },
  { label: "A", items: [item("/a", false, [item("/a/sub")]), item("/a2")] },
  { label: "B", items: [item("/b")] },
];

describe("splitPinned", () => {
  it("moves pinned items to the top in pin order and drops empty groups", () => {
    const result = splitPinned(groups, ["/b", "/a/sub"]);
    expect(result.pinned.map((i) => i.to)).toEqual(["/b", "/a/sub"]);
    expect(result.groups.map((g) => g.label)).toEqual([undefined, "A"]);
    const a = result.groups[1]!.items;
    expect(a.map((i) => i.to)).toEqual(["/a", "/a2"]);
    expect(a[0]!.children).toBeUndefined();
  });

  it("promotes the sub-pages of a pinned parent", () => {
    const result = splitPinned(groups, ["/a"]);
    expect(result.pinned.map((i) => i.to)).toEqual(["/a"]);
    expect(result.pinned[0]!.children).toBeUndefined();
    expect(result.groups[1]!.items.map((i) => i.to)).toEqual(["/a/sub", "/a2"]);
  });

  it("ignores pins for items that don't exist", () => {
    const result = splitPinned(groups, ["/gone"]);
    expect(result.pinned).toEqual([]);
    expect(result.groups).toHaveLength(3);
  });
});

describe("activeTrail", () => {
  it("returns the group and the parents above the best match", () => {
    expect(activeTrail(groups, "/a/sub/1")).toEqual({ group: "A", to: "/a/sub", parents: ["/a"] });
    expect(activeTrail(groups, "/a/other")).toEqual({ group: "A", to: "/a", parents: [] });
    expect(activeTrail(groups, "/b")).toEqual({ group: "B", to: "/b", parents: [] });
  });

  it("returns undefined when nothing matches", () => {
    expect(activeTrail(groups, "/nope")).toBeUndefined();
  });
});

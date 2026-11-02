/**
 * Information architecture. Grouped by job, not by database table:
 *   Home         – what needs attention today
 *   Donors       – people and what they give through (fundraisers)
 *   Money in     – every krone that arrives: donations, the KIDs they use, imports, review
 *   Agreements   – recurring giving, one model across Vipps / AvtaleGiro
 *   Regranting   – money out: balances, rounds, projects, adjustments, payees & funds
 *   Impact       – GiveWell cost estimates and fund grants behind the impact donors see
 *   Analysis     – how much has been given through time, with open pledges (tilsagn)
 *   Records      – reports and the import log
 *   Settings     – cause areas, organizations, referral types, matching rules
 * See docs/admin-design.md › Information architecture.
 */
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  HeartPulseIcon,
  HistoryIcon,
  ShapesIcon,
  ChartPieIcon,
  BookOpenIcon,
  CoinsIcon,
  FolderKanbanIcon,
  HandshakeIcon,
  LandmarkIcon,
  ScaleIcon,
  SlidersHorizontalIcon,
  CalendarCheckIcon,
  CircleOffIcon,
  PercentIcon,
  FlagIcon,
  HandCoinsIcon,
  HourglassIcon,
  HouseIcon,
  InboxIcon,
  KeyRoundIcon,
  RepeatIcon,
  ScrollTextIcon,
  SettingsIcon,
  SmartphoneIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
  ListChecksIcon,
  FileTextIcon,
  ReceiptTextIcon,
  SendIcon,
} from "lucide-react";
import { config } from "@/lib/config";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Live count shown next to the label. */
  badge?: "reviewQueue";
  /** Words the command palette also matches on. */
  keywords?: string[];
  /** The second key of its go-to shortcut: g then this key. */
  goKey?: string;
  /** Sub-pages shown indented under this item, collapsed until the item is expanded. */
  children?: NavItem[];
};
export type NavGroup = { label?: string; items: NavItem[] };

const allNavGroups: NavGroup[] = [
  {
    items: [
      { to: "/", label: "Home", goKey: "h", icon: HouseIcon, exact: true, keywords: ["dashboard"] },
    ],
  },
  {
    label: "Donors",
    items: [
      {
        to: "/donors",
        goKey: "d",
        label: "Donors",
        icon: UsersIcon,
        keywords: ["people", "givere"],
      },
      {
        to: "/fundraisers",
        goKey: "f",
        label: "Fundraisers",
        icon: FlagIcon,
        keywords: ["innsamling"],
      },
    ],
  },
  {
    label: "Money in",
    items: [
      {
        to: "/donations",
        goKey: "o",
        label: "Donations",
        icon: HandCoinsIcon,
        keywords: ["donasjoner"],
      },
      {
        to: "/distributions",
        goKey: "k",
        label: "Distributions",
        icon: KeyRoundIcon,
        keywords: ["kid", "split", "fordeling"],
      },
      {
        to: "/intents",
        label: "Intents",
        icon: HourglassIcon,
        keywords: ["intent", "intensjon", "awaiting", "first payment", "unpaid", "follow-up"],
      },
      {
        to: "/import",
        goKey: "i",
        label: "Import",
        icon: ArrowDownToLineIcon,
        // The review queue lives under /import/review and has its own item.
        exact: true,
        keywords: ["register", "upload", "ocr", "report", "bank"],
      },
      {
        to: "/import/review",
        goKey: "r",
        label: "Review queue",
        icon: InboxIcon,
        badge: "reviewQueue",
        keywords: ["manual", "invalid", "unmatched"],
      },
    ],
  },
  {
    label: "Agreements",
    items: [
      {
        to: "/agreements",
        goKey: "a",
        label: "Agreements",
        icon: RepeatIcon,
        // Cancelled agreements live under /agreements/cancelled and have their own item.
        exact: true,
        keywords: ["recurring", "vipps", "avtalegiro", "avtaler"],
      },
      {
        to: "/agreements/cancelled",
        label: "Cancelled agreements",
        icon: CircleOffIcon,
        keywords: ["cancelled", "stopped", "avsluttet", "stoppet", "churn", "reasons", "årsak"],
      },
      {
        to: "/agreements/inflation",
        label: "Inflation adjustment",
        icon: PercentIcon,
        keywords: ["inflation", "prisjustering", "kpi", "raise", "increase", "offer", "øke beløp"],
      },
      {
        to: "/charges",
        goKey: "c",
        label: "Vipps charges",
        icon: SmartphoneIcon,
        keywords: ["refund"],
      },
      {
        to: "/avtalegiro-charges",
        label: "AvtaleGiro charges",
        icon: ReceiptTextIcon,
        keywords: [
          "claims",
          "trekk",
          "krav",
          "mps",
          "mastercard",
          "nets",
          "deletion",
          "sletting",
          "shipment",
        ],
      },
      {
        to: "/avtalegiro-check",
        label: "AvtaleGiro check",
        icon: CalendarCheckIcon,
        keywords: ["validation", "missing", "expected"],
      },
    ],
  },
  {
    label: "Regranting",
    items: [
      {
        to: "/regranting",
        goKey: "b",
        label: "Balances",
        icon: ScaleIcon,
        exact: true,
        keywords: ["regranting", "tildelinger", "owed", "ikke overført"],
      },
      {
        to: "/regranting/rounds",
        label: "Rounds",
        icon: CoinsIcon,
        keywords: ["regranting", "tildeling", "transfers", "payout", "fund grant"],
      },
      {
        to: "/regranting/check",
        label: "Check numbers",
        icon: ListChecksIcon,
        keywords: ["reconciliation", "kontroll", "overview", "samlefila", "avstemming"],
      },
      {
        to: "/regranting/projects",
        label: "Projects",
        icon: FolderKanbanIcon,
        keywords: ["prosjekt"],
      },
      {
        to: "/regranting/adjustments",
        label: "Adjustments",
        icon: SlidersHorizontalIcon,
        keywords: ["correction", "fee", "opening balance", "fronted", "reallocation"],
      },
      {
        to: "/regranting/onward",
        label: "Awaiting report",
        icon: SendIcon,
        keywords: ["onward", "givewell", "forwarded", "videreført", "downstream"],
      },
      {
        to: "/regranting/onward-reports",
        label: "Onward reports",
        icon: FileTextIcon,
        keywords: ["givewell", "forwarding statement", "grantee", "downstream"],
      },
      {
        to: "/regranting/settings",
        label: "Payees & funds",
        icon: LandmarkIcon,
        keywords: ["payee", "routing", "own fund", "hold", "mottaker"],
      },
    ],
  },
  {
    label: "Impact",
    items: [
      {
        to: "/impact/estimates",
        label: "Cost estimates",
        icon: HeartPulseIcon,
        keywords: ["impact", "givewell", "evaluation", "cost per output", "effekt", "estimate"],
      },
      {
        to: "/impact/grants",
        label: "Fund grants",
        icon: ChartPieIcon,
        keywords: ["impact", "top charities fund", "tcf", "all grants fund", "agf", "allotment"],
      },
      {
        to: "/impact/agf",
        label: "All Grants Fund grants",
        icon: ScrollTextIcon,
        keywords: [
          "impact",
          "givewell",
          "all grants fund",
          "agf",
          "grant",
          "tildeling",
          "bevilling",
        ],
      },
      {
        to: "/impact/agf-summary",
        label: "AGF by year",
        icon: CalendarCheckIcon,
        keywords: ["impact", "givewell", "all grants fund", "agf", "metrics report", "portfolio"],
      },
      {
        to: "/impact/settings",
        label: "Charities & interventions",
        icon: ShapesIcon,
        keywords: ["impact", "charity", "intervention", "output", "abbreviation", "translation"],
      },
      {
        to: "/impact/exchange-rates",
        label: "Exchange rates",
        icon: ArrowLeftRightIcon,
        keywords: ["impact", "ecb", "currency", "valuta", "usd", "nok"],
      },
      {
        to: "/impact/changes",
        label: "Change log",
        icon: HistoryIcon,
        keywords: ["impact", "history", "audit", "who changed", "endringslogg"],
      },
    ],
  },
  {
    label: "Analysis",
    items: [
      {
        to: "/analysis",
        label: "Overview",
        icon: TrendingUpIcon,
        // Pledges live under /analysis/pledges and have their own item.
        exact: true,
        keywords: ["analysis", "analyse", "through time", "gjennom tidene", "milestone", "ticker"],
      },
      {
        to: "/analysis/pledges",
        label: "Pledges",
        icon: HandshakeIcon,
        keywords: ["tilsagn", "pledge", "promised", "decided gift"],
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        to: "/reports",
        label: "Reports",
        icon: BookOpenIcon,
        keywords: ["transaction report", "accounting"],
      },
      { to: "/logs", goKey: "l", label: "Import log", icon: ScrollTextIcon, keywords: ["logs"] },
    ],
  },
];

/**
 * Less-used pages sit one level under the page they belong to (parent → its sub-pages).
 * Keyed by path; every sub-page must be in the same group as its parent.
 */
const subPages: Record<string, string[]> = {
  "/import": ["/import/review"],
  "/agreements": [
    "/agreements/cancelled",
    "/agreements/inflation",
    "/charges",
    "/avtalegiro-charges",
    "/avtalegiro-check",
  ],
  "/regranting/rounds": ["/regranting/check"],
  "/regranting/onward": ["/regranting/onward-reports"],
  "/impact/grants": ["/impact/agf", "/impact/agf-summary"],
  "/impact/settings": ["/impact/exchange-rates", "/impact/changes"],
  "/analysis": ["/analysis/pledges"],
};

function nest(groups: NavGroup[]): NavGroup[] {
  const childPaths = new Set(Object.values(subPages).flat());
  return groups.map((group) => {
    const byTo = new Map(group.items.map((item) => [item.to, item]));
    return {
      ...group,
      items: group.items
        .filter((item) => !childPaths.has(item.to))
        .map((item) => {
          const children = (subPages[item.to] ?? []).flatMap((to) => byTo.get(to) ?? []);
          return children.length > 0 ? { ...item, children } : item;
        }),
    };
  });
}

export const navGroups = nest(
  allNavGroups.filter((group) => group.label !== "Regranting" || config.features.regranting),
);

/** Every item including sub-pages, in menu order (for shortcuts and the palette). */
export function flattenItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flattenItems(item.children ?? [])]);
}

export const settingsItem: NavItem = {
  to: "/settings",
  goKey: "s",
  label: "Settings",
  icon: SettingsIcon,
  keywords: ["cause areas", "organizations", "referral types", "matching rules"],
};

/**
 * Features that only some countries' sites support. Site settings lists the ones turned off, so
 * a dataset that has not set anything keeps every feature on.
 */
export const SITE_FEATURES = [
  { title: "Donor dashboard (Min side)", value: "dashboard" },
  { title: "Results page", value: "results" },
  { title: "Fundraisers", value: "fundraisers" },
] as const;

export type SiteFeature = (typeof SITE_FEATURES)[number]["value"];

export const isFeatureOn = (
  disabledFeatures: readonly string[] | null | undefined,
  feature: SiteFeature,
): boolean => !disabledFeatures?.includes(feature);

-- Drop two views that no longer work: they reference Combining_table (and columns) removed in
-- 20230731130928_multiple_cause_areas, so selecting from them fails in every database built from
-- the migrations. Neither exists in production (EffektDonasjonDB), where this is a no-op.
DROP VIEW IF EXISTS `v_Duplicate_full_names`;
DROP VIEW IF EXISTS `v_Duplicate_orgs_in_distributions`;

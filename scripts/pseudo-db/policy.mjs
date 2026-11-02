// Column policy for EffektPseudoDB: pseudonymised, read-only views of EffektDonasjonDB
// (docs/pseudo-db.md). The goal is to keep almost everything useful for analysis and
// development, while making sure names, contact details, national ID numbers and secrets
// don't end up verbatim in shared places such as a Slack channel.
//
// Every table gets a view with the same name. Columns not listed are passed through as they
// are, UNLESS their name looks personal or secret (PII_HINT below); then apply.mjs refuses to
// run until the column is classified here. That keeps the policy liberal without letting new
// sensitive columns slip in silently.
//
// Column actions:
//   "keep"                    pass through (reviewed)
//   "drop"                    leave out
//   { hash: kind }            keyed pseudonym (same value + kind → same pseudonym everywhere,
//                             so e.g. Donors.email_hash joins Adoveo sender_email_hash)
//   { sql: expr }             custom expression (`t` is the source table alias)
// A hashed column is renamed to <column>_hash; a { sql } column keeps its name unless `as` is set.
// `extra` adds derived columns: { name: "sql expr" } or { name: { hash: kind, of: column } }.

export const SOURCE_DB = "EffektDonasjonDB";
export const TARGET_DB = "EffektPseudoDB";
export const KEY_DB = "EffektPseudoKey";

/** Column names that must be classified explicitly before they're exposed. */
export const PII_HINT =
  /(mail|name|phone|ssn|birth|address|postal|account|iban|token|secret|password|message|comment|answer|raw|payer|sender|receiver|owner|note)/i;

/** Column names that match PII_HINT but are fine everywhere (ids, flags). */
export const SAFE_COLUMNS =
  /^(Meta_owner_ID|.*donor_?ID|Show_name|registered_mail_sent|answerID|name_ID|has_password)$/i;

/** Tables (or views) that get no view at all. */
export const SKIP_TABLES = [
  /^_prisma_migrations$/,
  /^schema_migrations$/,
  /_backup_\d+$/, // one-off backups
  /^Vipps_tokens$/, // live API tokens
  /^FB_donation_reports$/, // raw uploaded reports (blob)
  /^v_Tax_deductions$/, // names + national ID numbers by design
];

// Import log results that contain e-mails/names (Auth0 and Mailchimp syncs, Vipps uploads).
const IMPORT_LOG_PII_LABELS = [
  "Auth0 check",
  "Auth0 mismatch check",
  "MailChimp sync",
  "Vipps - Upload",
];

const isBusiness = "CHAR_LENGTH(t.ssn) = 9";

export const POLICY = {
  Donors: {
    columns: {
      email: { hash: "email" },
      full_name: { hash: "name" },
    },
    extra: {
      email_domain: "LOWER(SUBSTRING_INDEX(t.email, '@', -1))",
      is_anonymous: "(t.email = 'anon@gieffektivt.no' OR t.full_name LIKE '%anonym%')",
    },
  },
  Tax_unit: {
    columns: {
      ssn: { hash: "ssn" },
      // Business names are not personal data; people's names are pseudonymised.
      full_name: { sql: `IF(${isBusiness}, t.full_name, NULL)`, as: "business_name" },
    },
    extra: {
      full_name_hash: { hash: "name", of: "full_name" },
      is_business: isBusiness,
      birth_year: `IF(CHAR_LENGTH(t.ssn) = 11, YEAR(IF(STR_TO_DATE(SUBSTR(t.ssn, 1, 6), '%d%m%y') <= CURDATE(), STR_TO_DATE(SUBSTR(t.ssn, 1, 6), '%d%m%y'), STR_TO_DATE(SUBSTR(t.ssn, 1, 6), '%d%m%y') - INTERVAL 100 YEAR)), NULL)`,
      gender:
        "IF(CHAR_LENGTH(t.ssn) = 11, IF(CAST(SUBSTR(t.ssn, 9, 1) AS UNSIGNED) % 2 = 0, 'F', 'M'), NULL)",
    },
  },
  Adoveo_fundraiser: { columns: { Name: "keep" } }, // fundraiser titles, public
  Adoveo_fundraiser_transactions: {
    columns: { Sender_email: { hash: "email" }, Sender_phone: { hash: "phone" } },
  },
  Adoveo_giftcard: { columns: { Name: "keep" } },
  Adoveo_giftcard_transactions: {
    columns: {
      Sender_name: { hash: "name" },
      Sender_email: { hash: "email" },
      Sender_phone: { hash: "phone" },
      Receiver_name: { hash: "name" },
      Receiver_phone: { hash: "phone" },
      Message: "drop", // personal greeting
    },
  },
  Agreement_inflation_adjustments: { columns: { token: "drop" } },
  AutoGiro_mandates: {
    columns: {
      bank_account: { hash: "bank" },
      name_and_address: "drop",
      special_information: "drop",
      postal_code: "keep",
      postal_label: "keep",
    },
  },
  Cause_areas: { columns: { widget_display_name: "keep", name: "keep" } },
  External_grantees: { columns: { name: "keep", notes: "keep" } },
  FB_campaigns: { columns: { Campaign_owner_name: { hash: "name" }, Source_name: "keep" } },
  Fundraiser_transactions: {
    columns: {
      Message: "keep", // shown publicly on the fundraiser page
      Message_sender_name: { sql: "IF(t.Show_name, t.Message_sender_name, NULL)" },
    },
  },
  Fundraisers: { columns: { Secret: "drop" } },
  Impact_charities: { columns: { name: "keep" } },
  Import_logs: {
    columns: {
      result: {
        sql: `IF(t.label IN (${IMPORT_LOG_PII_LABELS.map((l) => `'${l}'`).join(", ")}) OR CAST(t.result AS CHAR) REGEXP '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', NULL, t.result)`,
      },
    },
  },
  Intermediary_payees: { columns: { notes: "keep" } },
  Mailersend_survey_responses: { columns: { answer: "keep" } },
  Onward_allocations: { columns: { note: "keep" } },
  Onward_reports: { columns: { notes: "keep" } },
  Organizations: { columns: { full_name: "keep", widget_display_name: "keep" } },
  Payees: { columns: { name: "keep", bank_account: "keep", iban: "keep" } }, // organisations, not people
  Payment: { columns: { payment_name: "keep" } },
  Projects: { columns: { name: "keep" } },
  Recurring_agreement_stopped: { columns: { otherComment: "keep" } },
  Recurring_agreement_stopped_reasons: { columns: { name: "keep" } },
  Referral_records: { columns: { other_comment: "keep" } },
  Referral_types: { columns: { name: "keep" } },
  Regrant_documents: { columns: {} },
  Regrant_rounds: { columns: { name: "keep", notes: "keep" } },
  Regrant_transfers: { columns: { notes: "keep" } },
  Regranting_funds: { columns: { notes: "keep" } },
  Review_queue_items: {
    columns: {
      Payer_name: { hash: "name" },
      Message: "keep", // bank transfer message
      Raw: "drop", // full bank/provider payload
      Note: "keep",
    },
  },
  Vipps_agreements: { columns: { agreement_url_code: "drop" } }, // a link that manages the agreement
  Vipps_matching_rules: { columns: { Message: "keep" } },
  Vipps_orders: { columns: { token: "drop" } },
  Data_owner: { columns: { owner: "keep" } },
  Impact_fund_portfolio: { columns: { source_name: "keep" } },
  Impact_evaluations: { columns: { source_name: "keep", comment: "keep" } },
  Impact_grant_allotments: { columns: { source_name: "keep", comment: "keep" } },
  v_Tax_unit_anon: { columns: { birthdate: { sql: "YEAR(t.birthdate)", as: "birth_year" } } },
  Impact_givewell_grants: { columns: { sources: "keep", notes: "keep" } },
  Regrant_adjustments: { columns: {} },
};

/** SQL that normalises a value before hashing, per kind (so formatting differences don't matter). */
export const NORMALISE = {
  email: (c) => `LOWER(TRIM(${c}))`,
  name: (c) => `LOWER(TRIM(REGEXP_REPLACE(${c}, '[[:space:]]+', ' ')))`,
  phone: (c) => `RIGHT(REGEXP_REPLACE(${c}, '[^0-9]', ''), 8)`,
  ssn: (c) => `REGEXP_REPLACE(${c}, '[^0-9]', '')`,
  bank: (c) => `REGEXP_REPLACE(${c}, '[^0-9A-Za-z]', '')`,
};

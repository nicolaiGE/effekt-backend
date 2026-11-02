# EffektPseudoDB: pseudonymised production data

`EffektPseudoDB` is a schema of read-only views over the production database `EffektDonasjonDB`.
It gives Claude Tag in Slack (through its own MCP connector at `/mcp-tag`) and other
read-only consumers live, close-to-complete production data. People are not identifiable at a
glance, so answers can be posted in shared channels.

The policy is deliberately liberal. Amounts, dates, KIDs, agreements, distributions, referrals,
survey answers and internal notes are all there. What changes:

| Data                                                                                                         | In EffektPseudoDB                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mails, names, phone numbers, national ID numbers, donor bank accounts                                      | `<column>_hash`: a stable pseudonym such as `email_3f9c…`. The same value gets the same pseudonym in every table, so pseudonyms can be joined and counted. |
| `Donors.email`                                                                                               | also `email_domain` (gmail.com, a company domain, …) and `is_anonymous`                                                                                    |
| `Tax_unit.ssn` / `full_name`                                                                                 | `ssn_hash`, `full_name_hash`, plus `is_business`, `birth_year`, `gender`. The name is kept only for businesses (`business_name`).                          |
| Secrets (Vipps tokens, agreement links, fundraiser secrets, inflation tokens)                                | left out                                                                                                                                                   |
| Gift-card greetings, AutoGiro mandate name/address, raw bank payloads, import-log results containing e-mails | left out                                                                                                                                                   |
| `v_Tax_deductions`, backup tables, migration tables, `FB_donation_reports`                                   | no view                                                                                                                                                    |

The full rules are in [`scripts/pseudo-db/policy.mjs`](../scripts/pseudo-db/policy.mjs).

## How it works

- Pseudonyms are `SHA-256(key : kind : normalised value)`, truncated to 16 hex characters.
  The 256-bit key is in `EffektPseudoKey.hash_key`, and readers can't access it. Without the key,
  pseudonyms can't be reversed by guessing (national ID numbers and phone numbers would be easy to
  guess with a plain hash). Rotating the key changes every pseudonym; don't, unless it has leaked.
- The views belong to the locked account `pseudo_view_definer` (SQL SECURITY DEFINER), which can
  read `EffektDonasjonDB` and the key. Readers get only `SELECT` on `EffektPseudoDB`: they can't
  read the source tables, the key or the view definitions.
- Views are created from the live schema with an explicit column list, so **a new column or table
  appears only after the script is re-run**. The script refuses to run while a column whose name
  looks personal or secret (email, name, phone, ssn, token, message, …) is unclassified.

## Updating after a schema change

Re-run the script after migrations that add or rename tables or columns. It is idempotent.

```sh
# Cloud SQL proxy on 127.0.0.1:3306; root password from Secret Manager.
pnpm install
DB_USER=root DB_PASS="$(gcloud secrets versions access latest --secret=effekt-db-root-password)" \
PSEUDO_DB_READERS="mcp_claude_tag@%,claude@%" \
  node scripts/pseudo-db/apply.mjs            # --dry-run prints the SQL instead
```

If it stops with "Policy needs attention", classify the listed columns in `policy.mjs`:
`"keep"`, `"drop"`, `{ hash: "email" | "name" | "phone" | "ssn" | "bank" }` or `{ sql: … }`.

## Who can read it

| Account          | Used by                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `mcp_claude_tag` | the Claude Tag connector (`/mcp-tag`); also reads `EffektAnalysisDB` |
| `claude`         | local Claude Code sessions (the `mysql` MCP server)                  |

The team's analysis connector (`/mcp`, account `mcp_readonly`) is unchanged: it reads
`EffektAnalysisDB` only and can't see `EffektPseudoDB`.

## The Claude Tag connector (`/mcp-tag`)

A separate MCP endpoint on the API, only for Claude Tag. It isn't in the claude.ai connector
library (every connector there is visible to all members), and it has no OAuth, so nobody can
sign in to it with their own account.

- **Data:** `EffektPseudoDB` (default) and `EffektAnalysisDB`, through `mcp_claude_tag`. There is
  no column blocklist; the views decide what is exposed. Its instructions ask Claude to answer
  with aggregates in shared channels.
- **Auth:** `Authorization: Bearer <MCP_TAG_TOKEN>`. The token is in Secret Manager
  (`effektapi-mcp-tag-token`). Claude Tag attaches it at its proxy, so it never reaches the
  session sandbox.
- **API config:** `MCP_TAG_TOKEN`, `MCP_TAG_DB_USER=mcp_claude_tag`, `MCP_TAG_DB_PASS` (secret
  `effektapi-mcp-tag-db-pass`), `MCP_TAG_DB_NAME=EffektPseudoDB`. Without them the endpoint
  returns 404.
- **Claude Tag setup (Owner, Admin settings → Claude Tag):**
  1. Attach the plugin [`claude-tag/plugins/effekt-data`](../claude-tag/plugins/effekt-data),
     whose `.mcp.json` points at `https://data.gieffektivt.no/mcp-tag`, to the channel or
     workspace (from a skills repository or the org plugin library). A `.mcp.json` in a cloned
     repository is not loaded; it has to come from an attached plugin.
  2. Add a custom connector: credential type **Bearer** with the token, allowed website
     `data.gieffektivt.no` with **all methods** (MCP uses POST), applied where the plugin is.
- **Rotating the token:** add a new version of `effektapi-mcp-tag-token`, redeploy `effektapi`
  (`gcloud run services update effektapi --region europe-north1 --update-secrets
MCP_TAG_TOKEN=effektapi-mcp-tag-token:latest`), then update the Bearer connector.

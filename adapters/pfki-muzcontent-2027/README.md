# Музконтент ПФКИ: ОК-27-1

Adapter v3 covers the 81 observed leaf values in template `2996768`, across all
eight grant sections. Canonical files are `sections/<sectionId>.json`; each
stable field ID maps to an exact `{ "value": ... }` envelope. This preserves
observed null, strings, milliseconds/seconds, array ordering and complete nested
table properties. It does not round money or reconstruct rows.

The shared pure converter also recognizes the `MEDIA_PERFORMANCE_METRICS` array
observed in earlier musical-content templates. Their field IDs still require a
separately captured manifest; this does not reinterpret an old template as 2027.

Create captures from authenticated API reads of every section. Capture keys are
`s<sectionId>.fields.f<fieldId>`. Do not put authentication, full applicant DTOs,
or real private grant documents in this repository. The fixture is synthetic.

Old templates have different field IDs. Migration must match the full semantic
section/group/label path and field type, reject ambiguous matches, and capture
new target controls before making a plan. An ID offset is not a mapping.

The transport independently rereads each current target leaf, preserves its
request/template/group IDs and attributes, and updates only `value` using the
portal's `update_field` API. Signature state is read-only. No status transition,
submission, signing, account mutation or deadline rewriting is implemented.
Native leaf timestamps are not a whole-application revision.

File references are part of the exact value. Reuse a file ID only when its
authorization, existence, original name and content have been independently
verified. Refetch and download attachments after migration; matching IDs alone
do not prove file availability. Binary uploads and recovery of deleted files
are outside this adapter. Business validation (rules, budgets, dates, rights,
signatures and current letters) is a separate required report.

Verification: deterministic complete capture, minimal field push plans,
signature/unknown-path rejection, nested-table preservation, and full post-write
refetch. API writes and real binary migration must not be called verified until
that last step succeeds.

Focused checks: `node --test tests/pfki-adapter.test.js` (fast unit; purpose:
prevent incomplete captures, lost nested properties and unsafe writes; expected
2s, maximum 15s). No browser workers or background services are started.

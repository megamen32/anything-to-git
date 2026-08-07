# IRI grant portal discovery draft — not a verified adapter

> This note was preserved from the original 0.1 repository only as an example of
> an early semantic inventory. It was not derived from a completed live-site
> round trip and must not be treated as current portal documentation, a supported
> adapter, or a statement of current contest rules.

Before creating an actual IRI adapter, run
`skills/site-adapter-builder/SKILL.md` against the concrete application and
replace every assumption below with observed pages, labels, constraints,
identity evidence, and tested write behavior.

## Candidate blocks to verify

An early draft guessed these broad concepts:

- application text;
- business plan and budget;
- presentation uploads;
- applicant/legal-entity details;
- project team.

The real discovery must answer:

1. Which of these are separate pages versus sections of one page?
2. Which values are editable, read-only, computed, or conditionally present?
3. Does the portal expose a revision, ETag, draft number, or reliable
   last-modified marker?
4. How are repeated budget rows and team members identified across reorder?
5. Are uploads represented by stable asset IDs, URLs, names, or status objects?
6. Which save actions are independent, and what stable evidence proves success?
7. What normalization does the server apply to prose, numbers, and rich text?

## Candidate canonical layout

This is only a design hypothesis:

```text
application/general.json
sections/concept.json
sections/relevance.json
sections/expected-results.json
business-plan/summary.json
business-plan/items/<stable-item-id>.json
business-plan/order.json
applicant/legal-entity.json
team/members/<stable-person-id>.json
team/order.json
attachments/presentation.json
```

Use stable site IDs when they exist. Do not invent identity from array position.
Do not put binary file contents in canonical JSON; store tested metadata or an
asset binding and document the upload lifecycle.

No field limits, contest requirements, or transport details from the old draft
are carried forward as facts. They must be observed and tested anew.

# IRI 2026 grant application — site block catalog

The portal is split into five top-level blocks. Each block is read as a
JSON subtree, edited locally, and merged back. The catalog below is what
the AI agent uses to decide **what** to read and **what** to write — it
does not prescribe **how** (Playwright, browseros, chrome-devtools-mcp,
saved HTML, direct API, …).

## application

Free-form text fields describing the project.

```
/application/title              string   required, ≤200 chars
/application/concept            string   ≤5000 chars
/application/relevance          string   ≤5000 chars
/application/expectedResults    string   ≤5000 chars
```

## business-plan

Business plan summary and itemised budget. Items have a stable `id` so
reorderings don't create spurious diffs.

```
/business-plan/summary          string   ≤10000 chars
/business-plan/items[]          array    of { id, name, sum, comment }
/business-plan/risks             string   ≤5000 chars
```

## presentation

Upload slots. The agent should upload the binary, capture the resulting
URL, and put the URL into the JSON tree (not the binary itself).

```
/presentation/pdf               string   URL or path to uploaded PDF
/presentation/pptx              string   URL or path to uploaded PPTX
```

The first slide of the PDF must use real key art, not neural-network
imagery. This is an IRI rule, not enforced by the adapter.

## applicant

Legal entity.

```
/applicant/name                 string
/applicant/inn                  string
/applicant/ogrn                 string
/applicant/address              string
```

## team

Project team. Use a `byId` map + an `order` array to avoid the
"reorder=spurious-diff" trap:

```jsonc
{
  "team": {
    "byId": {
      "person-anna": { "name": "Анна", "role": "Гейм-дизайнер" },
      "person-ivan": { "name": "Иван", "role": "Tech-lead" }
    },
    "order": ["person-anna", "person-ivan"]
  }
}
```

When the portal returns a flat list, the adapter's `normalize()` step
must upgrade it to the byId/order shape before the snapshot is committed.

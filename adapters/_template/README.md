# Site adapter template

An adapter is a **semantic contract**, not a browser driver.

It defines:

- which website pages, sections, and fields belong to the synchronized object;
- how captured values become deterministic JSON files;
- how JSON changes become site-level operations;
- how the agent recognizes fields before writing and proves that a save succeeded;
- validation, read-only fields, normalization, save groups, and merge policies.

It deliberately does **not** require Playwright, BrowserOS, Chrome MCP, Selenium,
or a particular built-in browser. The agent executing `fetch-spec.json` or
`push-plan.json` chooses the browser transport available in its environment.

## Files

- `adapter.json` — page/block/field map and reversible field mapping.
- `converter.js` — optional pure JavaScript hooks for non-trivial conversion.
  It may export only `normalizeFieldValue`, `denormalizeFieldValue`,
  `validateTree`, and `mergePolicies`; it is not a browser driver.
- `fixtures/` — captures and expected trees used as regression tests.

## Capture shape

```json
{
  "adapter_id": "replace-me",
  "adapter_version": 1,
  "captured_at": "2026-08-08T12:00:00+03:00",
  "revision": "optional-etag-or-site-revision",
  "values": {
    "general.main.title": {
      "present": true,
      "value": "Exact visible value"
    },
    "general.main.optional-note": {
      "present": false
    }
  },
  "metadata": {}
}
```

Every field declared in `adapter.json` must appear in `values`. Represent an
absent optional field as `{"present": false}`; do not omit it. Post-write
verification captures are generated with `a2g verification-template` and also
carry a one-time `verification` object that must be preserved exactly.

Increment the integer adapter `version` after every semantic change to
`adapter.json` or `converter.js`.

Do not put credentials, cookies, access tokens, CSRF values, or browser storage
inside captures or canonical files.

---
name: site-adapter-builder
description: Inspect one concrete editable website, split it into pages/sections/fields, and build a reversible Anything to Git site adapter without coupling it to a browser product.
---

# Site Adapter Builder

## Purpose

Turn one concrete editable website object into a deterministic, reversible JSON
workspace for Anything to Git.

The result is a site adapter that knows:

1. what pages and sections form the synchronized object;
2. what values must be fetched;
3. where each value lives in the canonical JSON tree;
4. how a canonical change becomes a site-level write operation;
5. how to validate and verify the round trip.

The adapter describes **site semantics**. It is not a Playwright script, a
BrowserOS workflow, a Chrome MCP prompt, or a built-in-browser transcript.
Use whichever browser capability is available while building and executing it.
Do not place tool-specific invocation syntax in the universal adapter.

For content-object adapters, the site contract also includes deterministic
rendering and proof. An accepted API request, closed modal, or success toast is
not evidence that the remote object contains the requested content.

## Inputs

- repository containing Anything to Git;
- authenticated access to one concrete website object;
- exact synchronization boundary, such as one grant application;
- adapter target directory.

For every content object, also record the canonical content/link inventory, the
site renderer and version, the object capabilities, and the exact post-write
read-back object plus link/media extraction rules.

Authentication material remains in the browser/session mechanism. Never copy
passwords, cookies, tokens, local storage, CSRF values, or secrets into Git,
captures, fixtures, logs, or adapter files.

## Required outputs

```text
adapters/<site-id>/
  adapter.json
  converter.js
  README.md
  fixtures/
    capture.base.json
    capture.changed.json
```

Also produce these review artifacts while working:

```text
.a2g/design/<site-id>/human-plan.md
.a2g/design/<site-id>/site-map.json
.a2g/design/<site-id>/round-trip-report.json
```

`human-plan.md` is mandatory. Before writing code, it must explain in ordinary
language:

- what exact website object is synchronized;
- which pages and sections belong to it;
- what will be excluded;
- where destructive or ambiguous writes may occur;
- how success will be verified.

Keep it compact enough for a human to review before implementation.

## Hard rules

- Work on one concrete site first. Do not prematurely generalize to slides,
  documents, databases, or arbitrary applications.
- One visible user concept should have one stable canonical location.
- The same captured site state must always generate byte-identical formatted
  JSON files.
- The reverse mapping must be explicit. A field is not supported until the
  adapter can describe both read and write behavior, or marks it read-only.
- Do not use generated CSS classes, random DOM IDs, element indexes, or screen
  coordinates as the only identity of a field.
- Prefer visible labels, page headings, stable URLs, semantic roles, and nearby
  landmarks. Selectors may be stored as optional hints, never as the meaning of
  the field.
- Never infer a value that could have been read. If a field is absent, record
  verified absence with `present: false`.
- Every complete capture must include every declared field, an explicit-offset
  completion timestamp, and the exact native revision when one exists.
- Represent identifiers or exact quantities outside JavaScript's safe integer
  range as strings and validate/convert them explicitly.
- Exclude transient state: timestamps of viewing, autosave indicators, CSRF,
  session IDs, notifications, animation state, and computed UI noise.
- Never silently make a non-reversible normalization. If the website strips
  formatting or transforms values, document and test that behavior.
- A successful write is not proof of synchronization. Fetch again and compare
  the resulting canonical tree.
- Never call a content object synchronized from an API response alone. Use the
  ladder `request_sent` -> `remote_identity_or_revision_observed` ->
  `save_confirmed` -> `readback_verified`; the last state is required for
  success. A create/publish operation may expose `external_id` as one form of
  remote identity, while an update may expose only a revision.
- Keep a canonical inventory of every `http`/`https` destination. Verify each
  destination in read-back, decoding provider redirects such as
  `away.php?to=...`, rather than checking only visible link text.
- Declare renderer loss explicitly. If a platform cannot preserve HTML
  anchors, render absolute URLs as plain text and verify that the platform
  turns them into clickable links. Never silently drop links or marks.
- Content-object adapters declare `rich_text`, `links`, `media`,
  `update_existing`, `readback`, and `recovery_after_uncertain_write`.
  `unknown` is a blocking state for real writes, not an optimistic default.
- Include renderer identity/version in the operation or idempotency key. A
  change from HTML to plain-link rendering is a different content operation.

## Workflow

Start from the bundled template, then initialize a disposable or dedicated
Anything to Git project around it:

```bash
a2g new-adapter adapters/<site-id> --id <site-id>
a2g --repo <repo> init \
  --adapter adapters/<site-id> \
  --remote <short-site-name> \
  --state-dir site
```

The initial template is intentionally incomplete. Replace its example page and
field map only after the human-readable scope is written.

### 1. Establish the synchronization boundary

Open the target object and write `human-plan.md` before implementation.
Inventory every page that can affect the object. Separate:

- editable source data;
- read-only identifiers and server-computed values;
- attachments;
- navigation/UI state;
- unrelated account or workspace data.

Do not include a field merely because it is visible. Include it only when it is
part of the synchronized object or needed to prove identity/revision.

### 2. Build the semantic site map

Create `site-map.json` using this shape:

```json
{
  "site_id": "grant-portal",
  "object_identity": {
    "kind": "grant_application",
    "visible_id": "42"
  },
  "pages": [
    {
      "id": "description",
      "recognition": "Visible evidence that the correct page is open",
      "blocks": [
        {
          "id": "summary",
          "fields": [
            {
              "id": "text",
              "label": "Project summary",
              "writable": true,
              "risks": []
            }
          ]
        }
      ]
    }
  ]
}
```

Break pages into blocks that match the site's own conceptual sections. Do not
create one giant `page.json` when the page contains independently editable
sections. Do not fragment every scalar into its own file without reason.

### 3. Design the canonical JSON tree

Use a logical tree of formatted JSON files, for example:

```text
site/
  application/general.json
  sections/summary.json
  sections/relevance.json
  budget/summary.json
```

Choose file boundaries that improve Git diff, merge locality, and model context.
Use stable IDs for repeated entities. Never use array position as identity when
items can be reordered. Prefer:

```json
{
  "byId": {
    "participant-anna": {"name": "Анна"}
  },
  "order": ["participant-anna"]
}
```

For every field record:

- canonical file;
- JSON pointer;
- data type;
- required/optional status;
- normalization rules;
- validation constraints;
- read-only status;
- merge policy when atomic merge is insufficient.

### 4. Implement site → tree

Fill `adapter.json` with pages, blocks, fields, navigation evidence, and
canonical mappings. The fetch side consumes an agent-produced capture:

```json
{
  "adapter_id": "grant-portal",
  "adapter_version": 1,
  "captured_at": "2026-08-08T12:00:00+03:00",
  "revision": "native site revision or null",
  "values": {
    "description.summary.text": {
      "present": true,
      "value": "Exact visible text"
    },
    "description.summary.subtitle": {
      "present": false
    }
  },
  "metadata": {}
}
```

Every declared field must have exactly one entry in `values`, including optional
fields. Use `{"present": false}` for an absent optional field. Omission is an
incomplete observation, not evidence of deletion.

Use `converter.js` only for pure transformations that the declarative manifest cannot
express. It may export only `normalizeFieldValue`, `denormalizeFieldValue`,
`validateTree`, and `mergePolicies`. Keep conversion pure and deterministic: no
browser calls, no current clock values inside canonical data, no network calls,
and no browser/runtime adapter factories.

Increment the integer adapter `version` whenever `adapter.json` or
`converter.js` changes semantically. Never reinterpret existing captures or
snapshots under changed conversion rules with the same version.

For a content-object adapter, put the proof contract under `site.transport`:

```json
{
  "renderer": {"id": "vk-wall-plain-links", "version": 1, "format": "plain_text_auto_link"},
  "capabilities": {
    "rich_text": "none",
    "links": "auto_link",
    "media": "partial",
    "update_existing": "unknown",
    "readback": "browser_required",
    "recovery_after_uncertain_write": "unknown"
  },
  "readback": {"source": "public_dom", "visibility": "public", "links": {"required": true, "paths": ["result.body", "result.html"]}}
}
```

The renderer must map canonical content to platform input deterministically. If
it changes, bump its version and add a regression test for every affected mark,
link, paragraph, or media rule.

Generate a fetch specification and manually verify that another browser-capable
agent could capture the site without knowing the original exploration history:

```bash
a2g --repo <repo> fetch-spec -o .a2g/fetch-spec.json
a2g --repo <repo> capture-template -o .a2g/capture.json
```

### 5. Implement tree → site operations

The reverse converter does not directly control a browser. It emits semantic
operations containing:

- page, block, and field identity;
- canonical expected current value, site-facing expected control value, and whether it is present;
- canonical desired value, denormalized `write_value`, and whether it is present;
- observation/locator hints for the immediate precondition read;
- interaction hints;
- explicit save instruction and success evidence;
- save group;
- navigation/recognition evidence.

Example:

```json
{
  "action": "set",
  "page_id": "description",
  "block_id": "summary",
  "field_id": "text",
  "expected_present": true,
  "expected_before": "Old canonical text",
  "expected_before_site": "Old text as represented by the control",
  "value_present": true,
  "value": "New canonical text",
  "write_value": "New text to enter into the control",
  "observation": {
    "instruction": "Read the complete current field value"
  },
  "save": {
    "instruction": "Save the page after the description group",
    "success_evidence": "A stable saved indicator is visible"
  },
  "save_group": "description"
}
```

Mark unsupported or server-owned values as `write.enabled: false`. The adapter
must reject local edits to those paths instead of pretending they can be pushed.

### 6. Add deterministic merge policy only where justified

Default list and scalar behavior is atomic. Add a policy only when the site's
meaning makes the result unambiguous:

- `set` for explicit unordered sets, using three-way membership semantics;
- `by_id` for object collections with stable IDs.

A merge policy applies only at its exact canonical pointer; declare nested array semantics separately.

Do not ask an LLM to invent a merge policy for prose, money, dates, legal text,
or delete-versus-edit situations. Those remain user-visible conflicts.

### 7. Prove the round trip with fixtures

Create at least:

- one complete base capture;
- one capture with edits on a different page/section;
- one expected canonical tree;
- one push plan produced from a controlled local change.

Test these invariants:

```text
same capture -> same canonical tree hash
capture -> tree -> plan contains only intended fields
read-only local edit -> hard failure
unmapped local edit -> hard failure
apply desired state -> refetch -> desired tree
```

Content-object adapters additionally prove:

```text
canonical content -> renderer -> expected link inventory
provider redirect -> decoded destination equals canonical URL
missing link in read-back -> verification fails with missing_links
renderer change -> operation key changes
API success without read-back -> object remains unverified
```

When a real site cannot be modified safely, run the reverse side against a draft,
test object, or dry-run and clearly mark what remains unverified.

### 8. Finish with a human review report

Write `round-trip-report.json` containing:

```json
{
  "adapter_id": "grant-portal",
  "fetch_verified": true,
  "push_verified": true,
  "round_trip_verified": true,
  "read_only_paths": [],
  "known_transformations": [],
  "known_risks": [],
  "unsupported_scope": []
}
```

Do not claim support for pages, fields, deletion, rich text, attachments, or
concurrent edits that were not actually tested.

Content-object reports also include renderer id/version, capability profile,
expected/found/missing links, read-back source/visibility, media counts, and
recovery status after uncertain requests.

## Completion criteria

The adapter is complete only when:

1. a fresh site capture normalizes without manual repair;
2. a second identical capture produces the same canonical tree hash and no
   canonical worktree diff (the core may still create a fresh synthetic audit
   commit for the new observation);
3. a controlled local change produces a minimal push plan;
4. read-only and unmapped changes fail closed;
5. post-write refetch matches the desired canonical tree;
6. another agent can execute the specs with a different browser transport.

# Roadmap: prove websites before generalizing artifacts

## 0.2 — strict website synchronization core

Implemented:

```text
browser-neutral capture
→ deterministic canonical JSON tree
→ normal Git workflow
→ Base / Local / Site semantic merge
→ explicit conflict decisions
→ preconditioned semantic push plan
→ complete post-write capture and exact verification
```

The core is reusable, but the public adapter is intentionally `SiteAdapter`.
That keeps page recognition, fields, save groups, and browser interactions
explicit instead of hiding them behind a premature “anything” abstraction.

## 0.3 — first verified real site adapter

Use `site-adapter-builder` on one actual editable website object. Completion
requires:

- complete page/block/field inventory;
- repeatable full captures;
- stable canonical identity for repeated entities;
- controlled writes against a draft/test object;
- tested read-only paths and validation limits;
- at least one real conflict caused by an independent website edit;
- full post-write recapture equality.

A fixture that merely resembles the site does not satisfy this milestone.

## 0.4 — second structurally different website

Choose a site with several properties absent from the first:

- repeated entities and reorder;
- conditional fields;
- deletion;
- multiple save groups;
- rich text;
- server-computed values;
- attachments;
- no native revision token.

Only behavior proven necessary by both sites moves into the universal layer.
Everything else stays site-specific.

## 0.5 — coordinated bridge

The current local bridge assumes one authoritative project repository. A
multi-user version needs an explicit coordinator for:

- shared snapshot history;
- locks or compare-and-swap around apply;
- mapping external revisions to canonical commits;
- partial-apply recovery;
- multiple machines and branches.

This should be a separate service rather than hidden state in a browser agent.

## 1.0 candidate — generic artifact protocol

After two sites prove the boundary, extract something like:

```text
captureSpec()
normalize(capture) -> CanonicalTree
planApply(current, desired) -> OperationPlan
verify(observation, desired) -> VerificationResult
```

`SiteAdapter` then becomes one implementation of a broader artifact adapter.

## Presentation adapter

A presentation should not be modelled as a fake website. A future deck adapter
could use:

```text
deck/metadata.json
slides/<stable-slide-id>/content.json
slides/<stable-slide-id>/speaker-notes.json
slides/<stable-slide-id>/shapes/<stable-shape-id>.json
slides/order.json
theme/theme.json
assets/<content-hash>.<ext>
```

Its operations would be artifact-native:

- add, remove, duplicate, or reorder a slide;
- replace a text block;
- update shape geometry or style;
- bind or replace an asset;
- update notes or theme data.

The same canonical tree, Git refs, merge reports, pending plans, and exact
verification machinery should remain useful. Capture and apply semantics would
be different, which is precisely why presentations come after the website
boundary is demonstrated rather than being forced into it now.

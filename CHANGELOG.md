# Changelog

## 0.2.0 — 2026-08-08 (UTC+03:00)

### Changed

- Replaced direct website `fetch/apply` adapters with declarative,
  browser-neutral capture specifications and semantic push plans.
- Moved canonical Local state into normal Git-tracked JSON files.
- Rebuilt orchestration around explicit `Base / Local / Site` state.
- Replaced implicit resolver callbacks with persisted conflict reports and
  explicit resolution documents.
- Removed the unverified IRI fixture adapter and local-files demo from the
  bundled adapter registry; retained a clearly labelled discovery note.

### Added

- strict duplicate-key JSON parser and canonical SHA-256 tree identity;
- synthetic private refs for latest Site and last verified Base;
- deterministic object, three-way set, and stable-ID collection merge policies;
- dirty-worktree, read-only, unmapped-path, revision, adapter-version, and
  stale-plan checks;
- preconditioned browser-neutral push operations with separate canonical and site-form values;
- one synthetic audit commit for every complete site observation;
- exact full-object post-write verification bound to a one-time pending-plan
  challenge, preventing stale capture reuse;
- mandatory explicit presence for every declared capture field, including absent
  optional fields;
- unambiguous conflict-value encoding, explicit atomic object policy, nested-repo
  initialization, and validated synthetic metadata for both Site and Base refs;
- executable collection-level handling for conflicting `by_id` edits, duplicate
  rejection for set merges, and rejection of unsafe rounded integers;
- an allowlist of deterministic converter hooks so adapters cannot replace the
  declarative site contract with an opaque runtime implementation;
- exact-pointer merge-policy scoping, numeric-underflow and case-insensitive
  reserved-path rejection, adapter/state directory separation, and a fallback
  for Git versions without `git init -b`;
- recomputation and validation of merge reports and pending push plans before
  they can modify canonical state or advance Base;
- adapter template, offline grant-portal example, JSON schemas, architecture
  documentation, and two AI skills;
- Node built-in test suite covering end-to-end and failure paths.

### Fixed from 0.1

- external revision was not reliably propagated to push;
- verification did not compare actual and desired trees;
- Base advanced to the wrong snapshot after push;
- user-combined conflict values could remain conflicting;
- ignored `.a2g` content was incorrectly treated as the main editable workspace.

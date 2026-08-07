# Comparison and v0.2 merge decision

This document compares the two implementations used to produce v0.2.

## Inputs

### Original GitHub Node.js version

Strengths:

- small, readable, dependency-free Node.js codebase;
- straightforward npm/CLI packaging;
- adapter concept and an end-to-end local fixture;
- fast built-in tests;
- natural fit for the existing GitHub repository.

Critical weaknesses found during review:

1. The snapshot commit message contained the external revision, but the metadata
   reader returned only commit SHA and message. Push therefore received an
   undefined revision instead of a trustworthy concurrency token.
2. Post-push verification refetched and logged state but did not compare the
   resulting tree with the desired tree.
3. After push, Base advanced to the old remote commit rather than a verified
   post-write snapshot.
4. Conflict resolution reran merge against a supplied merged candidate, so a
   genuinely new user-combined value could remain classified as conflicting.
5. `allowConflicts` was not an effective safety boundary.
6. Push did not prove that Local contained the latest Site snapshot, did not
   enforce a clean committed canonical tree, and did not require an immediate
   fresh fetch.
7. Canonical local state lived under ignored `.a2g` data rather than as normal
   Git-tracked project files.
8. The fixture adapter accepted an expected revision without actually enforcing
   it.

The test suite exercised utility behavior but not these claimed synchronization
guarantees.

### Python prototype

Strengths:

- clear `Base / Local / Site` state model;
- deterministic canonical JSON tree and SHA-256 identity;
- synthetic private Git refs for Site and Base;
- explicit conflict packets and resolution documents;
- strict dirty-worktree and committed-state checks;
- read-only/unmapped path rejection;
- push plans pinned to local commit, site snapshot, site revision, adapter
  version, and expected field values;
- full post-write capture equality before Base advances;
- stronger path, JSON, symlink, duplicate-key, and stale-plan safety tests;
- browser-neutral capture specs and push plans;
- two skills closely matching the intended AI workflow.

Weaknesses:

- more code and a heavier conceptual surface;
- Python packaging was less convenient in the available offline environment;
- no direct browser execution by design;
- only one demonstration site adapter;
- premature support for additional artifact types would still have been
  speculative.

## Decision

The best version is neither predecessor by itself.

v0.2 keeps the original repository's **Node.js, no-dependency packaging and CLI
shape**, but replaces the state machine with the Python prototype's strict
content model. It also adopts the prototype's declarative, browser-neutral site
adapter contract.

```text
Kept from Node                 Ported/adapted from Python
──────────────────────────     ───────────────────────────────────────
Node 18+ / CommonJS            canonical JSON and strict parsing
npm package + a2g binary       synthetic remote/base snapshot refs
small dependency surface       Base / Local / Site merge model
existing Git history           explicit conflict reports/resolutions
                               stale-plan and revision checks
                               semantic push plans with preconditions
                               exact full-tree post-write verification
                               site-adapter-builder skill
                               site-sync skill
```

## Additional hardening added during the merge

- null-prototype JSON objects to prevent `__proto__` pollution;
- duplicate-key rejection before data enters the model;
- overlapping canonical mappings rejected at adapter load time;
- object additions/removals diffed at mapped field level;
- adapter-version pins in captures and plans;
- field descriptions and constraints embedded in conflict packets;
- direct `local`, `remote`, `base`, `set`, and `delete` resolution actions;
- stable-ID child conflicts collapsed to an executable collection-level
  decision instead of emitting synthetic paths that cannot address JSON arrays;
- duplicate members rejected under `set` merge rather than silently removed;
- unsafe integer values rejected before JavaScript can round them;
- plan-bound one-time verification templates that prevent accidental stale
  capture reuse;
- millisecond report identifiers in UTC+03:00 by default;
- safe path and symlink handling for canonical worktrees;
- old unverified live-site claims moved out of the adapter registry;
- complete captures require every declared field, including explicit absence for
  optional values;
- post-write captures carry a one-time pending-plan challenge to detect accidental
  stale capture reuse (without pretending it is remote attestation);
- nested project initialization, validated synthetic metadata for both Site and
  Base refs, and unambiguous presence wrappers for conflict artifacts;
- an explicit converter-hook allowlist that prevents a site adapter from silently
  replacing the declarative contract with browser/runtime orchestration;
- exact-pointer merge-policy scoping, numeric-underflow rejection,
  case-insensitive reserved-path protection, non-overlapping adapter/state
  directories, compatibility fallback for older Git initialization syntax, and
  recomputation of persisted merge/push artifacts before they are trusted.

## Result

For actual use, v0.2 is better overall:

- safer than either original implementation;
- easier to install than the Python prototype;
- more honest about what the core can and cannot guarantee;
- independent of BrowserOS/Playwright/Chrome MCP without losing executable
  instructions;
- prepared for a real concrete-site adapter without pretending a fixture is a
  production integration.

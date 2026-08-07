# Test report — v0.2.0

Executed on 2026-08-08 (UTC+03:00):

```bash
npm test
npm run test:coverage
npm run smoke
npm pack --dry-run
```

The main suite contains 72 tests and covers:

- strict deterministic JSON, duplicate-key rejection, non-finite values,
  prototype-pollution keys, and unambiguous missing-value serialization;
- safe canonical paths, JSON pointers, tree hashing, symlink rejection,
  preservation of non-JSON files, nested independent repositories, and
  snapshot-metadata tamper detection for both Site and Base refs;
- recursive and explicit atomic objects, true three-way sets, and stable-ID
  collection merge behavior;
- non-overlapping changes, same-field conflicts, delete-versus-edit,
  incompatible reorders, and complete explicit conflict resolution;
- complete capture enforcement for required and optional fields, strict
  adapter-version checks, validation, read-only and unmapped edits, overlapping
  mappings, allowlisted pure converter hooks, and browser-neutral fetch specs;
- bootstrap, independent Local/Site edits, merge, commit, semantic push plan,
  one-time verification challenge, and complete successful verification;
- stale Local HEAD, stale Site revision, substituted verification capture,
  verification mismatch, modified merge reports/pending plans, and Base
  immutability on failure;
- CLI initialization, adapter templating, verification-template generation,
  bundled adapter discovery, JSON schemas, and UTC+03:00 defaults.

Coverage in this release run:

```text
lines      93.90%
branches   74.72%
functions  94.29%
```

The release must not be tagged or pushed unless all commands above pass from a
clean checkout and from the packed npm artifact.

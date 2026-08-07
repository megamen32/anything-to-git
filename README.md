# Anything to Git

**Anything to Git turns one editable website object into a bidirectional Git workspace.**

A browser-capable agent reads the site into a structured capture. A declarative
adapter converts that capture into deterministic JSON files. Humans and AI edit
those files through normal Git. Before anything is written back, the core merges
`Base / Local / Site`, refuses ambiguous conflicts, emits a preconditioned push
plan, and advances the synchronization base only after a complete refetch matches
the committed tree.

```text
Website ── any browser transport ──> capture.json
                                      │
                                      ▼
                              declarative adapter
                                      │
                                      ▼
                         canonical JSON tree in Git
                                      │
                                      ▼
                                  push-plan.json
                                      │
Website <── any browser transport ────┘
                                      │
                                      └── complete refetch + exact verification
```

Current scope is deliberately **websites first**. The core is reusable, but v0.2
does not pretend presentations, databases, and arbitrary applications already
share the same apply semantics.

## Why this version exists

v0.2 combines the strongest parts of two earlier implementations:

- the compact, dependency-free Node.js CLI and repository ergonomics of the
  original GitHub version;
- the stricter state model, revision pinning, semantic merge, fail-closed write
  planning, and full post-write verification of the Python prototype;
- browser-neutral adapters and two explicit AI skills from the site-first design.

The original direct `adapter.fetch()` / `adapter.apply()` model was removed from
the website path. A site adapter now defines **what must be observed and changed**,
not whether the executing agent uses BrowserOS, Playwright, Chrome MCP, Selenium,
a built-in browser, or a private API.

See [`docs/COMPARISON.md`](docs/COMPARISON.md) for the detailed decision record.

## Core model

Anything to Git tracks three content states:

```text
Base   last website state verified to match the local canonical state
Local  canonical JSON tree committed at Git HEAD
Site   newest complete website state ingested from a capture
```

A deterministic three-way merge applies these rules:

| Situation | Result |
|---|---|
| Local equals Base | take Site |
| Site equals Base | take Local |
| Local equals Site | clean |
| different object fields changed | recursively combine |
| same scalar/prose changed differently | explicit conflict |
| delete versus edit | explicit conflict |
| explicit `set` / `by_id` policy applies | deterministic policy result |

Merge policies apply to their exact canonical JSON pointer; a collection policy never leaks into nested arrays.

Ambiguous conflicts are never silently delegated to an LLM. The generated report
contains `Base`, `Local`, and `Site`, plus the field label and constraints. The
sync skill tells the agent to ask the user because the Site value may be a manual
edit made outside Git.

## Repository layout

```text
src/
  json.js              strict canonical JSON, pointers, tree hashing and I/O
  merge.js             semantic three-way merge
  adapter.js           declarative page/block/field adapter
  adapter-loader.js    adapter.json + allowlisted pure converter.js hooks
  git.js               synthetic snapshot commits and private refs
  project.js           fetch/merge/resolve/plan/verify state machine
  cli.js               command-line interface

adapters/
  _template/           clean adapter template
  demo-grant-portal/   offline end-to-end example, not a real website

skills/
  site-adapter-builder/SKILL.md
  site-sync/SKILL.md

schemas/                adapter, capture and push-plan JSON schemas
docs/                   architecture, comparison and roadmap
examples/               command walkthroughs and discovery notes
tests/                  Node built-in test suite; no runtime dependencies
```

A configured working repository contains:

```text
.a2g/                              ignored runtime metadata and reports
site/                              normal committed canonical JSON files
.git/refs/a2g/remotes/<name>       latest captured Site snapshot
.git/refs/a2g/bases/<name>         last fully verified Base snapshot
```

The website is not a Git server. Anything to Git synthesizes commits for observed
website states and stores them under private refs.

## Requirements

- Node.js 18 or newer;
- Git available on `PATH`;
- no npm runtime dependencies.

Generated timestamps default to **UTC+03:00**. Override only when needed:

```bash
A2G_UTC_OFFSET=+01:00 a2g status
```

## Install

From a clone:

```bash
npm install
npm link
```

`npm install` does not download runtime packages; it only prepares the local
package metadata. Commands may also be run directly as `node bin/a2g.js`.

## Offline walkthrough

Create a disposable project with the bundled demo adapter:

```bash
mkdir /tmp/a2g-demo
cd /tmp/a2g-demo
git init

a2g init /path/to/Anything-to-Git/adapters/demo-grant-portal \
  --remote grant \
  --state-dir site
```

Generate the instructions and fillable capture for any browser-capable agent:

```bash
a2g fetch-spec -o .a2g/fetch-spec.json
a2g capture-template -o .a2g/capture.latest.json
```

Bootstrap the supplied fixture as the initial site state:

```bash
a2g fetch \
  --capture /path/to/Anything-to-Git/adapters/demo-grant-portal/fixtures/capture.base.json \
  --bootstrap
```

Edit and commit normal JSON files:

```bash
$EDITOR site/sections/summary.json
git add site/
git commit -m "Edit grant summary locally"
```

Ingest a site state changed independently, merge it, and commit the result:

```bash
a2g fetch \
  --capture /path/to/Anything-to-Git/adapters/demo-grant-portal/fixtures/capture.remote-changed.json

a2g status
a2g merge
git diff -- site/
git add site/
git commit -m "Merge latest website changes"
```

Immediately before writing, perform another complete capture and ingest it. In
this offline walkthrough the unchanged `capture.remote-changed.json` fixture is
used again to represent that fresh observation. Then create the semantic push
plan:

```bash
a2g fetch \
  --capture /path/to/Anything-to-Git/adapters/demo-grant-portal/fixtures/capture.remote-changed.json
a2g status
a2g push-plan -o .a2g/push-plan.json
```

The browser agent executes only those operations. It normalizes the freshly
observed control value, checks `expected_present` and site-facing
`expected_before_site`, and writes only `write_value`. `expected_before` and
`value` remain the canonical values for audit.

After creating the plan, generate its one-time verification template:

```bash
a2g verification-template -o .a2g/capture.after-push.json
```

The browser agent must preserve the template's `verification` object exactly,
refetch every declared field after all saves, fill the complete capture, update
`captured_at` to the time that complete observation finished, and record the
resulting revision. Then verify it:

```bash
a2g verify --capture .a2g/capture.after-push.json
```

Only a challenge-bound, exact normalized tree match advances Base.

## Build a real site adapter

Create a clean template:

```bash
a2g new-adapter adapters/my-site --id my-site
```

Then give the coding/browser agent:

```text
skills/site-adapter-builder/SKILL.md
```

The skill requires a human-readable scope first, then a page → block → field map,
a stable canonical JSON layout, both conversion directions, fixtures, and a
round-trip report. It explicitly forbids coupling the adapter to a particular
browser product.

A typical field declaration is:

```json
{
  "id": "text",
  "label": "Project summary",
  "canonical": {
    "file": "sections/summary.json",
    "pointer": "/text"
  },
  "type": "string",
  "required": true,
  "read": {
    "instruction": "Read the complete value, preserving paragraphs"
  },
  "write": {
    "enabled": true,
    "instruction": "Replace the complete value",
    "save_group": "description"
  }
}
```

`converter.js` is optional and must remain pure and deterministic. It may use
only `normalizeFieldValue`, `denormalizeFieldValue`, `validateTree`, and
`mergePolicies`. It may normalize a site-specific representation, but it must
not call a browser, network, clock, or credential store. Converter code is
trusted local code rather than a sandbox, so review it before use.

Every semantic change to `adapter.json` or `converter.js` must increment the
integer adapter `version`. Existing captures, Site snapshots, Base snapshots,
and pending plans are pinned to that explicit version.

## Operate a synchronization

Give the execution agent:

```text
skills/site-sync/SKILL.md
```

The required sequence is:

```text
status
→ complete capture
→ fetch
→ three-way merge
→ ask the user about every ambiguous conflict
→ commit
→ complete fresh capture immediately before planning
→ push-plan
→ verification-template
→ preconditioned browser writes
→ complete challenge-bound capture
→ verify
```

## CLI

```text
a2g init <adapter-or-path> [--remote site] [--state-dir site]
a2g new-adapter <target> --id <adapter-id>
a2g fetch-spec [-o file]
a2g capture-template [-o file]
a2g verification-template [-o file] [--plan-id id]
a2g fetch --capture file [--bootstrap]
a2g status
a2g merge
a2g resolve --file resolutions.json
a2g push-plan [-o file]
a2g verify --capture file [--plan-id id]
a2g adapters
```

The core intentionally has no `a2g push` that clicks a website itself. The
transport-neutral output is `push-plan.json`; the current agent executes it with
whatever browser capability is available.

## Conflict resolution document

A resolution may take one side directly:

```json
{
  "resolutions": [
    {
      "file": "sections/relevance.json",
      "pointer": "/text",
      "action": "remote"
    }
  ]
}
```

Or set an explicit user-approved value:

```json
{
  "resolutions": [
    {
      "file": "sections/relevance.json",
      "pointer": "/text",
      "action": "set",
      "value": "Final combined text approved by the user"
    }
  ]
}
```

Supported actions are `local`, `remote`, `base`, `set`, and `delete`. Every
reported conflict must receive an explicit resolution.

## Safety properties

The implementation fails closed on:

- duplicate JSON keys, non-finite values, numeric underflow, unsafe rounded integers, unsafe paths, path
  traversal and symlink traversal;
- unknown or omitted capture fields, including optional fields not represented as
  `{"present": false}`, missing adapter versions, and adapter-version mismatch;
- overlapping canonical field mappings, unsupported converter hooks, and overlapping adapter/state directories;
- dirty canonical worktrees during merge or planning;
- uncommitted desired state;
- unresolved same-field conflicts and delete-versus-edit conflicts;
- local edits to read-only or unmapped paths;
- stale local commits, site snapshots, site revisions, adapter versions, or
  invalid synthetic metadata on Site/Base refs;
- per-operation precondition mismatch during browser execution;
- modified merge reports or pending plans, and stale or substituted post-write captures that lack the pending plan's one-time
  verification challenge;
- partial or transformed writes discovered by full post-write verification.

The project cannot make a non-transactional website atomic. When a save group is
partially applied, the correct recovery is a complete capture and a new merge,
not an improvised rollback.

## Programmatic API

```js
const {
  DeclarativeSiteAdapter,
  Project,
  mergeTrees,
  treeHash,
} = require('anything-to-git');

const project = new Project('/path/to/configured/repo');
console.log(project.status());
```

The CLI is the preferred orchestration surface because it persists reports,
pending plans, synthetic refs, and verification state consistently.

## Tests

```bash
npm test
npm run test:coverage
npm run smoke
```

The suite uses Node's built-in test runner and requires no test dependencies.

## Current limitations

- canonical state is JSON-only;
- binary attachments need a site-specific metadata/reference strategy;
- rich text needs a stable representation chosen by the adapter;
- a browser-capable agent executes captures and push plans;
- the verification challenge binds a capture to a pending plan and catches
  accidental stale-file reuse, but it is not cryptographic proof that a browser
  actually reread the website; the executing agent remains part of the trust boundary;
- there is one configured site object per project;
- shared multi-user locking and a coordinated bridge are not implemented;
- bundled `demo-grant-portal` is an offline example, not a verified live portal
  adapter.

Presentations are a reasonable next artifact only after at least two structurally
different real website adapters prove the boundary. See
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

MIT.

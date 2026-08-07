# Anything to Git

> **Anything** = snapshot() + revision + merge rules + apply()

Anything to Git turns any external mutable system — a website, a SaaS portal,
an internal app, a directory of files — into a **bidirectional Git workspace**.
You read it, edit it locally, merge in changes from the outside, and write it
back, all with deterministic three-way merge at JSON-path level.

The project started life as a private hack: keeping a Russian grant
application in sync between an LLM-driven local Markdown draft and the
portal's web form. The hack outgrew the project, so the universal core is
now its own thing, and the grant portal is just the first adapter.

## What is in the box

```
anything-to-git/
├── src/                      # universal core (Node, no deps)
│   ├── anything.js           # orchestrator: fetch → status → merge → push → verify
│   ├── adapter.js            # base class for adapters
│   ├── tree.js               # JSON pointer + path utilities
│   ├── normalize.js          # canonical JSON + tree hash
│   ├── merge.js              # field-level 3-way merge + deep-join
│   ├── plan.js               # build / apply JSON-Patch-style plans
│   ├── revision.js           # revision token handling
│   ├── validate.js           # minimal JSON-Schema-ish validator
│   ├── git.js                # thin `git` CLI wrapper
│   ├── log.js                # tiny stderr logger
│   └── index.js              # public exports
├── bin/a2g.js                # CLI: init/fetch/status/merge/push/sync/verify
├── adapters/
│   ├── iri-grant/            # seed adapter: конкурс.ири.рф (fixture transport)
│   └── local-files/          # trivial second adapter: a directory of files
├── skills/
│   ├── SKILL.adapt-site.md   # skill #1 — how to author a new adapter
│   └── SKILL.sync.md         # skill #2 — how to run a sync, with conflict-asks-user
├── tests/                    # 37 tests, no external deps
└── examples/                 # (reserved for future adapter recipes)
```

## The model in one paragraph

The orchestrator keeps three refs per adapter:

- `refs/a2g/<adapter>/base`  — the last state both sides agreed on
- `refs/a2g/<adapter>/remote` — the last state read from the outside
- `refs/a2g/<adapter>/local-head` — the last state you produced locally

`.a2g/<adapter>/local/`  is a checkout of the merged tree that you can edit.
`.a2g/<adapter>/remote/` is a checkout of the last fetched snapshot, used to
build the next plan.

A sync is: **fetch → status → merge → push → verify**. Fetch writes a new
remote commit. Merge runs the field-level three-way merge (Base / Local /
Remote) and writes the result to `local/`. Push asks the adapter to apply the
plan, pins it to the last-known remote revision, then re-fetches to confirm
the live system agrees.

## Quick start

```bash
git clone <this-repo> my-workspace
cd my-workspace
npm install            # no dependencies to install, but the command exists for tools
node bin/a2g.js adapters          # → iri-grant, local-files

# Use the trivial second adapter for a no-network smoke test:
mkdir -p a2g-data && echo '1' > a2g-data/x.json
node bin/a2g.js init    local-files
node bin/a2g.js fetch   local-files
mkdir -p .a2g/local-files/local && echo '2' > .a2g/local-files/local/x.json
node bin/a2g.js merge   local-files
node bin/a2g.js push    local-files          # → a2g-data/x.json now contains 2
```

The IRI seed adapter ships in `fixture` transport. To wire it up to a real
browser, replace `transport: 'fixture'` with `'browser'`, `'http'` or `'sdk'`
in `adapters/iri-grant/adapter.js`. The `fetch` and `apply` methods are the
ones to override.

## Public API (programmatic)

```js
const { Anything, Adapter } = require('anything-to-git');

class MyAdapter extends Adapter { /* … */ }

const a2g = new Anything({ adapter: new MyAdapter({ name: 'my-system' }) });
a2g.init();
await a2g.fetch();
const s = await a2g.status();
const m = await a2g.merge({ resolver: async ({ conflicts }) => ({ /* … */ }) });
const p = await a2g.push();
```

## Properties the core guarantees

1. **Determinism** — `canonicalize(fetch(X)) === canonicalize(fetch(X))` for
   any `X` the adapter reports.
2. **Idempotence** — applying the same plan twice is a no-op.
3. **Round-trip** — `fetch(apply(desired))` matches `desired` up to the
   adapter's documented computed/observed fields.
4. **No lost work** — `apply()` is pinned to the expected remote revision
   and refuses to run if the live system has moved on.

## Things that are deliberately out of scope (yet)

- A real Git remote helper (`git-remote-anything`). The CLI runs Git
  commands directly; a future `git fetch grant` is a packaging exercise,
  not an architectural one.
- Coordinated bridge between multiple machines / users. The current
  local-bridge model is honest about that; once a second user joins,
  a small `a2g-server` could sit in the middle.
- Embedded marker in the external system. Most sites do not let you
  stash metadata; a tags-as-X-headers scheme is the next step.
- LLM-driven conflict resolution. The skills leave a `resolver` hook
  for it but do not implement the LLM call themselves — that is
  environment-specific.

## Running the tests

```bash
node tests/run.js
```

37 tests covering canonicalize, three-way merge, plan build/apply, JSON
pointer get/set/remove, the validator, and an end-to-end local-files
fetch → merge → push round-trip.

## Skills for AI agents

The repo ships two skill descriptions that an AI coding agent can load
to either **author a new adapter** or **operate a sync**. They are plain
Markdown, with frontmatter, so any harness that consumes a `SKILL.md`
folder can pick them up.

- `skills/SKILL.adapt-site.md` — when you want to add a new adapter
  for a website/portal/SaaS, follow these steps. The skill explicitly
  does **not** prescribe which browser/SDK to use — that is the
  operator's choice.
- `skills/SKILL.sync.md` — when you want to actually sync local state
  with the outside. The skill is firm about one rule: **on a conflict
  that the deterministic merge cannot resolve, ask the user**. The
  conflict packet is small and structured; the AI does not get a
  write tool until the human picks a side.

## License

MIT.

---
name: a2g-sync
description: Use when the user wants to actually sync local state with an external system through Anything to Git. Runs fetch → status → merge → push → verify, surfaces conflicts with a compact packet, and **always asks the user** on a conflict that cannot be auto-resolved.
---

# Sync an adapter

This skill drives the `a2g` CLI on the user's behalf. The CLI is the
source of truth for the merge rules, the revision pinning, and the
verify-after-apply loop. The skill's job is to choose the right
command, to format the output for the user, and — critically — to
**ask the user** on any conflict that the deterministic merge cannot
resolve.

## Always

- Read the project's `AGENTS.md` and `README.md` before invoking the
  CLI. The adapter name and the per-adapter block catalog are spelled
  out there.
- Use `a2g` for everything. Do not call adapter internals directly.
- Run `a2g status` before any read/write, so the user sees the
  current state of the workspace.
- Refuse to push a plan that fails the adapter's `validate()`. The
  validation result is in the error message; surface it to the user.
- After every successful `a2g push`, run `a2g verify` (or read the
  `verified` block from the push output) to confirm the live system
  agrees. Never claim success on plan-only.

## Default workflow

```text
a2g status <adapter>            # see what's ahead and what's behind
a2g fetch <adapter>             # pull the latest external state
a2g status <adapter>            # re-evaluate after fetch
a2g merge <adapter>             # auto-merge where possible
# if conflicts: see "On conflict" below
a2g push <adapter> --dry-run    # show the plan before it touches the wire
a2g push <adapter>              # actually apply
a2g verify <adapter>            # confirm the live system agrees
```

The `a2g sync <adapter>` command collapses these into one, but
**only** when there are no conflicts and the user has not asked for a
dry-run. For the first sync of a new adapter always run the steps
manually so the user can see each phase.

## How to read `a2g status`

```json
{
  "initialized": true,
  "classifications": { "/application/title": "conflict", … },
  "conflicts": [
    { "path": "/application/title",
      "base": "Исследование комплексов железа",
      "local": "Молекулярные комплексы железа в катализе",
      "remote": "Комплексы железа в биохимии",
      "reason": "value-diverged" }
  ],
  "localOnly": 17, "remoteOnly": 2, "both": 0, "agree": 41
}
```

- `localOnly` paths: only the local Git state changed since the last
  sync. These will be applied.
- `remoteOnly` paths: only the external system changed. These will
  be pulled in.
- `agree` paths: no change on either side.
- `conflicts`: both sides changed the same path differently. **Do
  not pick a side automatically.** The skill asks the user.

## On conflict — ASK THE USER

When `a2g status` reports one or more conflicts, build a compact
**conflict packet** and present it to the user. Never auto-resolve
on the user's behalf unless the user has previously given a
standing rule for that path (e.g. "the `updatedAt` field always
takes the newer timestamp").

The packet looks like this:

```jsonc
{
  "adapter": "iri-grant",
  "conflicts": [
    {
      "path": "/application/title",
      "description": "Short project title shown on the application cover page",
      "base":    "Исследование комплексов железа",
      "local":   "Молекулярные комплексы железа в катализе",   // ← edited by you / AI
      "remote":  "Комплексы железа в биохимии",                  // ← edited by someone on the site
      "constraints": { "maxLength": 200, "required": true }
    }
  ]
}
```

Present each conflict as a separate question:

> `application.title` changed on both sides since the last sync.
> - **local** (your working copy): "Молекулярные комплексы железа в катализе"
> - **remote** (the site): "Комплексы железа в биохимии"
>
> Which should win? (local / remote / type a merged value)

The user's answer goes into the resolver:

```bash
node -e '
  const { Anything } = require("anything-to-git");
  const Adapter = require("./adapters/iri-grant/adapter");
  const a2g = new Anything({ adapter: new Adapter({ name: "iri-grant" }) });
  a2g.merge({
    resolver: async ({ conflicts }) => ({
      "/application/title": "Молекулярные комплексы железа в биохимии"
    })
  }).then(console.log);
'
```

Or in the agent's own scripting: invoke `a2g merge` programmatically
with a resolver function. The CLI's `--allow-conflicts` flag exists
for tests only; do not use it in real syncs.

## When refetch is forced

If `a2g push` returns `RevisionMismatchError`, the live system
moved between `fetch` and `apply`. The CLI has already refetched;
re-run `a2g status` and start the conflict-resolution flow from
scratch. Do not try to be clever: the tree has changed under you,
and the right answer is a fresh merge.

## After push

- Run `a2g verify` (or read the `verified` block). The verified
  snapshot is what the live system returned after the apply. If
  the plan and the verified tree disagree on a field the user
  cares about, surface the discrepancy — the external system
  probably normalised the value (rounded, escaped, reordered).
- Mark the sync as successful only after verification matches
  the plan up to documented computed/observed fields.
- The orchestrator advances the base ref so the next sync sees
  the verified state as the new ground truth.

## What to show the user

- Before fetch: current ahead/behind counts from `a2g status`.
- After merge: a one-line summary of (localOnly, remoteOnly,
  conflict) plus a list of conflict paths. The full tree diff
  lives under `.a2g/<adapter>/local/` — point the user there.
- Before push: the dry-run plan in plain text ("will replace
  /application/title, replace /business-plan/items/3/sum,
  add /team/person-3").
- After push: the verified revision. If the live system
  renormalised anything, call it out.

## When to stop and ask

- The user has not named the adapter. Ask which one. Default to
  the only registered adapter if there is exactly one.
- The plan is empty (no operations). Do not push. Report "nothing
  to do" and stop.
- Validation failed. Show the errors and stop. Do not retry with
  a forced push.
- The user wants to push but conflicts remain. Refuse. Show the
  packet and ask.
- The external system returned a `revision` the orchestrator
  cannot pin (e.g. it does not expose one). Tell the user the
  push is best-effort and ask whether to proceed.

# Migrating from v0.1 to v0.2

v0.2 intentionally does not auto-migrate the old synchronization Base. The v0.1
push/verify path could record an old remote snapshot as agreed state without
proving that the live system matched the desired tree. Reusing that Base would
carry the exact correctness risk v0.2 is designed to remove.

## Safe migration

1. Stop all v0.1 writes to the target website.
2. Copy `.a2g/<adapter>/local/` and any unpushed work to a separate backup.
3. Build or convert the site into a v0.2 declarative adapter using
   `skills/site-adapter-builder/SKILL.md`.
4. Initialize a clean v0.2 project with a normal tracked state directory.
5. Capture the complete live website and bootstrap that capture as the new Base.
6. Reapply only the intended local edits from the backup to the normal state
   directory and commit them.
7. Capture the website again, run `status` and `merge`, and ask the user about
   every ambiguous conflict.
8. Generate a fresh push plan and its `verification-template`, execute the
   immediate preconditions, then complete the challenge-bound full post-write
   verification.

Example initialization:

```bash
a2g --repo /path/to/new-workspace init /path/to/adapters/my-site \
  --remote site \
  --state-dir site

a2g --repo /path/to/new-workspace fetch \
  --capture /path/to/capture.live.json \
  --bootstrap
```

## Adapter conversion

A v0.1 JavaScript class with direct `fetch()` and `apply()` is replaced by:

```text
adapter.json       semantic pages / blocks / fields / read-write mapping
converter.js       optional allowlisted pure deterministic transformation hooks
fixtures/          complete captures for round-trip regression tests
```

`converter.js` may expose only normalization, denormalization, validation, and
merge-policy hooks. Transport code does not move into it. The agent executing
`fetch-spec.json` and `push-plan.json` uses BrowserOS, Playwright, Chrome MCP,
an API, or another available mechanism.

## State layout changes

```text
v0.1: .a2g/<adapter>/local/              ignored local candidate
v0.2: <state-dir>/                       normal committed canonical tree

v0.1: refs/a2g/<adapter>/base
v0.2: refs/a2g/bases/<remote-name>

v0.1: refs/a2g/<adapter>/remote
v0.2: refs/a2g/remotes/<remote-name>
```

Do not manually copy old refs into the new namespace.

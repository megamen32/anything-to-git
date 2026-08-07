# Agent instructions

## Product boundary

Anything to Git v0.2 is website-first. Do not generalize the adapter interface to
presentations, databases, or arbitrary artifacts without at least two real,
structurally different website adapters demonstrating the shared requirement.

## Development rules

- Preserve the `Base / Local / Site` model.
- Never move Base before a complete normalized post-write capture equals the
  desired committed tree.
- Never auto-resolve an ambiguous same-field conflict.
- Keep site adapters independent of BrowserOS, Playwright, Chrome MCP, Selenium,
  or a proprietary browser harness.
- Keep `converter.js` deterministic and free of browser/network/clock access;
  expose only the four allowlisted hooks.
- Increment the adapter version after every semantic manifest/converter change.
- Reject unknown, omitted (including optional), read-only, stale, unsafe, or
  partially verified changes.
- Preserve the one-time verification challenge and never treat it as browser
  attestation; still reread every declared field.
- Add a regression test for every synchronization guarantee changed.
- Use UTC+03:00 in generated project examples and reports unless an external
  protocol mandates another timestamp.

## Commands

```bash
npm test
npm run smoke
npm run test:coverage
```

## Skills

Use `skills/site-adapter-builder/SKILL.md` to create a concrete adapter and
`skills/site-sync/SKILL.md` to operate it.

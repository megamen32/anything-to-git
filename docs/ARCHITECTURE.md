# Architecture

## Boundary

The universal core owns content identity, Git history, merge, planning, and
verification. A site adapter owns the semantic mapping between a concrete
website object and that content. A browser agent owns navigation and interaction.

```text
Core                         Adapter                       Browser agent
────────────────────────     ──────────────────────────    ─────────────────────
canonical JSON               pages / blocks / fields      authenticate
Git refs and commits         normalization                navigate
three-way merge              validation                   observe exact values
conflict reports             read-only boundaries         enforce preconditions
pending plans                semantic write hints         write and save
verification                 save groups/evidence         complete recapture
```

No layer may silently absorb another layer's responsibility. Site adapters are
declarative. Their optional `converter.js` may export only
`normalizeFieldValue`, `denormalizeFieldValue`, `validateTree`, and
`mergePolicies`; browser/runtime adapter factories are rejected. Converter code
is still trusted local code, not a sandbox.
Every semantic adapter change requires an explicit integer version bump; captures, synthetic snapshots, and pending plans are pinned to that version.

## Capture contract

A complete capture is an observation, not canonical state:

```json
{
  "adapter_id": "grant-portal",
  "adapter_version": 1,
  "captured_at": "2026-08-08T12:00:00+03:00",
  "revision": "optional-native-revision",
  "values": {
    "description.summary.text": {
      "present": true,
      "value": "Exact site value"
    },
    "description.summary.subtitle": {
      "present": false
    }
  },
  "metadata": {}
}
```

Every field declared by the adapter must appear exactly once in `values`.
Optional absence is explicit (`{"present": false}`); an omitted field makes the
capture incomplete. The adapter normalizes the observation into a path →
JSON-value tree. When the site has no native revision, the canonical tree hash
becomes the observed revision token. Integer values outside JavaScript's exact
safe range, and decimal quantities that require exact lexical precision, must be
represented as strings with adapter-level validation/conversion.

## Git representation

Local desired state is ordinary committed content under `state_dir`. Site and
Base snapshots are synthetic commits with only the canonical state subtree:

```text
HEAD                              committed Local state
refs/a2g/remotes/<remote>         latest captured Site state
refs/a2g/bases/<remote>           last verified Base state
```

Merge is content-based; the synthetic and user commit graphs need not share a
Git ancestor. Both Site and Base refs are accepted only when their commits carry
valid embedded snapshot metadata whose adapter identity and tree hash match the
actual canonical subtree.

## Merge

The core compares the three JSON values at each semantic location. Objects merge
recursively. Arrays and scalars are atomic unless an adapter declares:

- `set`: deterministic three-way unordered-set behavior that combines independent additions and preserves one-sided removals; duplicate members fail closed;
- `by_id`: stable-ID entity merge for non-overlapping edits. Conflicting edits
  inside one collection collapse to an executable collection-level decision,
  avoiding synthetic ID paths that cannot address a JSON array safely.

Policies apply only at the exact canonical JSON pointer where they are declared.
A `by_id` or `set` collection policy does not implicitly change the semantics of
arrays nested inside its entities.

A conflict never modifies the worktree. The report contains a candidate plus all
conflicts. Before applying a resolution, the core recomputes Base/Local/Site and
requires the persisted report to match. Only a complete explicit resolution
document may write the result.

## Push plan

The adapter compares current Site state with committed desired Local state and
emits operations grouped by page and save group. Every operation includes:

- semantic field identity;
- expected presence, canonical expected value, and site-facing expected control value;
- desired presence, canonical desired value, and the denormalized `write_value`;
- navigation and recognition hints;
- observation and interaction instructions;
- normalization used for comparison;
- save instruction and success evidence.

Before emitting a verification template or accepting verification, the core recomputes the deterministic plan from the pinned Local and Site states and rejects modified pending operations.

The pending plan also pins:

- adapter ID and version;
- Local Git commit and desired tree hash;
- Site synthetic commit and current tree hash;
- external revision token;
- core-recorded ingestion time proving which complete observation the plan uses;
- a one-time verification challenge bound to that exact pending plan.

## Verification

A save response or toast is not synchronization proof. The core first emits a
verification template containing the pending plan ID and a one-time challenge.
After execution, the browser agent preserves that challenge and captures every
declared field again. The adapter normalizes the complete observation and the
core compares its hash with the desired committed tree. Only the exact challenge
and exact tree equality create a verified Site snapshot and move Base.

An unbound stale/substituted capture, missing challenge, or content mismatch
fails closed. The challenge prevents accidental reuse but is not remote
attestation: the browser executor remains trusted to perform the declared reads.
Content mismatch writes a detailed report and leaves Base unchanged.

## Failure and partial apply

Many websites cannot provide a transaction across pages. The plan therefore
uses save groups and immediate field preconditions, but partial application is
still possible. On any uncertain save or changed precondition:

1. stop;
2. do not improvise a rollback;
3. capture the complete resulting site state;
4. ingest and merge again.

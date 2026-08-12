---
name: site-sync
description: Safely synchronize a configured Anything to Git website with local Git, preserving both user website edits and local/AI edits through deterministic three-way merge and explicit conflict decisions.
---

# Site Sync

## Purpose

Synchronize one configured website object with its local canonical JSON tree.
The website may have been edited by the user while the local branch was edited
by a person or an AI. Treat both as legitimate sources.

The adapter defines **what** to read and write. Use any browser capability
available in the current environment to execute its fetch specification and
push plan. Do not rewrite the adapter around the current browser product.

## Invariants

At all times distinguish:

```text
Base   = last state verified on both sides
Local  = committed canonical tree at Git HEAD
Site   = newest freshly captured website state
```

Never use two-way overwrite when all three states exist.

Hard rules:

- Never assume a website change is noise. The user may have made it manually.
- Never resolve an ambiguous same-field conflict silently.
- Never push from a dirty canonical worktree.
- Never force-reset, force-push, rewrite history, or discard a side to make the
  sync look clean.
- Never store authentication secrets in captures or Git.
- Never declare success until the complete site is fetched again and verified.
- If a precondition differs immediately before a write, stop; do not overwrite.
- Do not ask the user about deterministic non-overlapping changes. Merge those
  automatically and report them.

## Publication Proof

When the synchronized object is an article, post, or other publication, use
the adapter's renderer and capability profile as part of the plan review.
Track the publication ladder explicitly:

```text
request_sent
-> external_id_received
-> save_confirmed
-> public_readback_verified
```

Only the last state is a successful publication. An API response, editor toast,
or closed modal is not enough. The read-back report must include its source and
visibility, such as public DOM, public API, or authenticated API.

Before execution, derive the expected HTTP link inventory from canonical
content. After execution, extract links from the complete read-back body,
decode provider redirects and repeated URL encoding, and compare destinations,
not only visible labels. A missing destination is a verification failure and
must leave Base unchanged. For platforms that cannot preserve HTML anchors,
the renderer must retain absolute URLs as text and read-back must prove that
the platform made them clickable when that capability is claimed.

Publication reports also record renderer id/version, capability profile,
expected/found/missing links, media expected/found counts, and recovery status
after an uncertain request. Include renderer identity/version in idempotency
keys so a renderer change cannot replay an old receipt.

## Required user-visible layer

Before changing the website, provide a compact summary:

```text
Site capture: <revision or hash>
Local: <commit>
Automatic merge: <N local-only>, <N site-only>
Conflicts requiring a decision: <N>
Planned website writes: <N fields across N pages>
```

For every unresolved conflict show the exact canonical location and concise
`Base / Local / Site` values. Long prose may be summarized, but provide attached
or saved full values in a JSON conflict artifact.

## Workflow

### 1. Check the repository

Run:

```bash
a2g --repo <repo> status
```

If canonical files are dirty, do not fetch-and-merge over them. First determine
whether the changes are intentional, then commit them or explicitly discard them
with user approval. Never hide them with stash/reset as an automatic shortcut.

### 2. Fetch the complete current site

Generate the semantic fetch specification:

```bash
a2g --repo <repo> fetch-spec -o .a2g/fetch-spec.json
a2g --repo <repo> capture-template -o .a2g/capture.latest.json
```

Using the available browser transport, inspect every declared field and fill the
capture. Required and optional fields are both part of a complete observation.
Represent an absent optional field explicitly as `{"present": false}`; never omit
its key. Confirm object identity and page recognition evidence before reading.
Do not capture only the page that appears relevant; merge correctness requires a
complete canonical snapshot. Replace `captured_at` with the time the full
observation finished and record the native revision/ETag when one exists.

Ingest it:

```bash
a2g --repo <repo> fetch --capture .a2g/capture.latest.json
```

For the first-ever snapshot only:

```bash
a2g --repo <repo> fetch --capture .a2g/capture.latest.json --bootstrap
```

Do not use `--bootstrap` after a base exists.

### 3. Inspect three-way status

Run:

```bash
a2g --repo <repo> status
```

Interpret the result:

- `synced`: no content difference;
- `mergeable`: changes are identical, one-sided, or non-overlapping;
- `aligned_unverified`: Local and Site match, but the common Base has not yet been advanced by verification;
- `conflicted`: both Local and Site changed the same semantic value differently;
- `not_bootstrapped`: the initial base is missing.

### 4. Merge deterministic changes

Run:

```bash
a2g --repo <repo> merge
```

When clean, the merged canonical tree is written to the worktree. Review the Git
diff and commit it. The commit message should state that current website changes
were incorporated; do not make a vague “fix” commit.

Example:

```bash
git diff -- site/
git add site/
git commit -m "Merge latest grant portal changes"
```

### 5. Resolve ambiguous conflicts through the user

When `a2g merge` reports conflicts, open the generated merge report. Values in the
artifact use unambiguous presence wrappers—`{"present": true, "value": ...}` or
`{"present": false}`—so a legitimate user value can never be confused with a
missing-value sentinel. For each conflict present:

```text
Location: sections/relevance.json#/text
Base:   value at the last verified synchronization
Local:  value committed locally
Site:   value currently visible on the website
Reason: both sides changed the same value differently
```

Ask one precise question per related conflict group. Offer these choices without
choosing for the user:

- keep Local;
- keep Site;
- use an explicitly supplied combined value;
- delete, when deletion is actually supported.

A model may prepare a proposed combined value, but it must be labelled as a
proposal and must not be applied until the user selects or edits it. This is
especially important for prose: the site version may contain facts the user
added manually while the local version contains AI editing.

Record the decision in JSON:

```json
{
  "resolutions": [
    {
      "file": "sections/relevance.json",
      "pointer": "/text",
      "action": "set",
      "value": "User-approved final value"
    }
  ]
}
```

Apply it:

```bash
a2g --repo <repo> resolve --file .a2g/resolutions.json
git diff -- site/
git add site/
git commit -m "Resolve website synchronization conflicts"
```

No unresolved conflict may be omitted from the resolution file.

### 6. Re-fetch immediately before planning the push

The website can change while conflicts are being reviewed. Capture it again in
full and run `a2g fetch`. Then run `a2g status`.

If the fresh capture introduced changes not contained in Local, return to merge.
Do not continue using an older remote snapshot merely because a previous merge
was clean.

### 7. Create and review the push plan

Run:

```bash
a2g --repo <repo> push-plan -o .a2g/push-plan.json
```

The command refuses to plan when:

- the canonical worktree is dirty;
- Local does not contain the newest Site state;
- a conflict remains;
- a read-only or unmapped field changed;
- validation fails.

Review the plan by page and save group. Show the human the number of fields,
pages, clears/deletions, and any warnings. Always surface destructive operations
explicitly. When the plan has zero operations, do not touch the website; still
perform the full verification capture so the common Base can advance safely.

### 8. Execute the plan with preconditions

Use the available browser transport. For each operation:

1. navigate to and recognize the declared page/block;
2. read the field immediately before writing;
3. normalize the observed control value according to
   `comparison_normalization`, then verify `expected_present` and the
   site-facing `expected_before_site`; `expected_before` is the canonical audit
   value and may be checked as well when the executor can run the pure converter;
4. if either precondition differs, stop the push and fetch the complete object again;
5. apply exactly the declared action using `write_value`; treat `value` as the
   canonical desired value for audit, not as an alternative browser input;
6. after completing a `save_group`, execute its declared `save` instruction once;
7. verify the declared save-success evidence and absence of validation errors;
8. observe any server transformation.

Use each operation’s `observation` hints to locate and re-read the field. Do not
improvise changes outside the plan. Do not “fix nearby fields.” Do not
continue after an unexpected redirect, identity mismatch, stale revision, failed
save, or changed precondition. If earlier save groups were already applied, treat
the website as partially changed: capture its exact resulting state and restart
the merge rather than attempting an improvised rollback.

When the site exposes a revision, ETag, version, draft number, or last-modified
marker, compare it with `expected_remote_revision`. When it does not,
field-level presence and `expected_before_site` preconditions are mandatory.

### 9. Verify by complete refetch

Create the verification capture template from the pending push plan:

```bash
a2g --repo <repo> verification-template \
  -o .a2g/capture.after-push.json
```

The generated file contains a one-time `verification.plan_id` and
`verification.challenge`. Preserve that object exactly. After the website reports
successful saves, inspect every declared field again and fill the complete
capture—not merely the modified controls. Optional absent fields must still be
present as `{"present": false}`. Set `captured_at` to the completion time and
record the resulting native revision/ETag before running:

```bash
a2g --repo <repo> verify --capture .a2g/capture.after-push.json
```

Verification rejects a capture without the exact pending challenge. It succeeds
only when the normalized site tree hash equals the desired committed tree hash.
On mismatch, the base ref is not advanced. Read the failure report, show the
differences, and decide whether the site transformed the value, rejected a
write, or changed concurrently.

### 10. Report the result

A successful report must include:

```text
Verified site revision/hash
Local Git commit
Number of automatic merges
Number and disposition of user-resolved conflicts
Number of applied operations
Post-write canonical tree hash
```

Do not report “synced” based only on clicks, toast messages, HTTP success, or an
empty push plan.

## Conflict policy summary

Automatic:

- one side unchanged from Base;
- both sides produced exactly the same value;
- different object keys or different mapped fields changed;
- an explicit adapter merge policy gives one deterministic result.

User decision required:

- both sides changed the same scalar or prose differently;
- delete versus edit;
- incompatible reorder or identity ambiguity;
- local change to a read-only field;
- site result differs after write;
- any case where preserving both intentions is not mechanically certain.

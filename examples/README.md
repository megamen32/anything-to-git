# Examples

This directory is reserved for short, end-to-end adapter recipes.

Planned (not yet written):

- `notion-page/` — a single Notion page as a tree of blocks.
- `trello-board/` — a Trello board as `byId + order` lists.
- `github-issue/` — a GitHub issue with editable body + labels.

Each example should be a sub-directory with:

- `adapter.js` — the adapter implementation
- `describe.json` — capabilities manifest
- `schema.json` — JSON schema
- `blocks/README.md` — site section catalog
- `fixtures/` — saved snapshots for offline testing

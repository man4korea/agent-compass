# repo-atlas

**Give your AI coding agent a map of your codebase — so it stops editing the wrong file.**

```bash
npx repo-atlas
```

No install. No account. No config. It reads your repo and writes `.atlas/ATLAS.md`.

---

## The problem this solves

Your agent is not bad at coding. It is bad at *knowing which file you meant*.

In a real monorepo the same filename lives in four places. You say "fix the approval
flow", the agent greps, picks the wrong copy, edits it confidently, and reports success.
Nothing changes in the app. You lose an hour finding out why.

That failure has a measurable cause: **name ambiguity**. `repo-atlas` measures it.

Run on the repo this tool was built in:

```
  6,600 files · 2,094,486 lines · 13 modules · 1283ms

  ⚠  933 ambiguous filenames  (719 high risk)
  ⚠  3,883 duplicated exported symbols

  Most likely to be edited by mistake:
    - appointments.ts × 8 copies
    - master-data.ts × 8 copies
    - error.tsx × 6 copies
```

719 filenames where an agent has to guess. That is the number nobody measures before
blaming the model.

## What it writes

```
.atlas/
  ATLAS.md            # scale, module map, ambiguity warnings, symbol index
  modules/<name>.md   # per-module file table with exported symbols
  report.json         # same numbers, machine readable
```

Point your agent at `.atlas/ATLAS.md` — in `CLAUDE.md`, `.cursorrules`, or just by
telling it to read the file first. It is plain markdown, so every agent can use it.

## Usage

```bash
npx repo-atlas                # map the current repo
npx repo-atlas ../other-repo  # map another one
npx repo-atlas --check        # print the numbers, write nothing
npx repo-atlas --json         # machine readable, for CI
```

Add it to CI and fail the build when ambiguity grows:

```bash
npx repo-atlas --json | jq -e '.ambiguousHigh < 50'
```

## How it decides what is risky

- 🔴 **high** — same filename, several copies, near-identical size. This is the one
  that gets edited by mistake.
- 🟡 **medium** — same filename, different sizes. Still needs a module prefix to be safe.
- ⚪ **low** — framework conventions (`page.tsx`, `index.ts`, `__init__.py`). Expected,
  not reported as risk.

It respects `git ls-files`, so ignored files, build output and archives never inflate
the numbers. Generated type dumps are excluded.

Zero dependencies. Node 18+.

## Honest limits

- Symbol extraction is regex-based, not a full parse. It is fast and language-agnostic;
  it will miss dynamic exports and re-export chains.
- The map is a helper, not a source of truth. **When the map and the code disagree,
  the code is right.** Regenerate rather than trust a stale map.

## Why it exists

It was extracted from the tooling of a five-app monorepo that is developed almost
entirely by AI agents. The index started as an internal fix after agents kept editing
near-duplicate files across apps. This is that fix, generalized.

MIT licensed.

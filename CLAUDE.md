# CLAUDE.md

Notes for Claude (and other agents) working in this repo.

## Versioning: this repo uses semantic-release

`.github/workflows/release.yml` runs `semantic-release` (via `GEWIS/actions/.github/workflows/versioning.yml`) on every push to `main`. It computes the next version by parsing the **header line** (first line) of each commit on `main` since the last matching tag, looking for a conventional-commit type (`feat:`, `fix:`, etc.). Only the header is parsed -- text in the commit body is not picked up even if it's formatted as `type: subject`.

**This means PR titles matter here.** GitHub's squash-merge uses the PR title as the resulting commit's header line. This repo's PR titles therefore need a conventional-commit prefix (`feat:`, `fix:`, `chore:`, `docs:`, ...) when the change should participate in versioning.

This **overrides** the general global-CLAUDE.md guidance against conventional-commit prefixes in PR titles -- that guidance is right for repos that don't run semantic-release, but here a plain human-readable title silently produces a commit semantic-release can't classify, and the change never triggers a release even though it shipped. Ask "does this need to bump the version" before naming a PR:
- `feat:` / `fix:` -- bumps the version, use for real functional changes.
- `chore:` / `docs:` / `refactor:` / `test:` / `style:` -- does not bump the version (by design, e.g. routine dependency bumps).

If a PR bundles several individually-prefixed commits (as Dependabot's grouped bumps and multi-commit feature PRs often do), the squash commit's header is still just the PR title -- pick the header type to match the **highest-impact** type actually present in the body (`feat` > `fix` > everything else), don't leave it unprefixed.

## Monorepo layout

- `frontend/` -- Vue 3 + Vuetify (formerly `GEWIS/radioweb`)
- `backend/` -- Go (formerly `GEWIS/radiogaga`)
- One shared version number and release cycle for both, via `GEWIS/actions`' reusable workflows. See root `README.md` for local dev setup.

# Working on scroll-flyover

- **The plan is [`ROADMAP.md`](ROADMAP.md).** Read it before proposing or starting new
  work. What has shipped is in `CHANGELOG.md`, and releasing is in `CONTRIBUTING.md`.
- The engine (`references/scrub-engine.js`, `references/scrub-effects.js`) has external
  consumers and is under semver. A minor release must leave every pixel of a page that
  does not opt in unchanged. Prove that by comparing frames before and after, not by
  reasoning.
- Checks: `npm run check` (unit tests, package), `npm run check:types`, `npm run qa`,
  `npm run qa:a11y`, `npm run qa:render`. Stop any local dev servers before running the browser checks.
- Verify against the artifact: after a publish, unpack the tarball from the registry
  and hash its files against the tagged tree (normalize CRLF first). Then tag `vX.Y.Z`
  on the tree that actually went out.
- Never put npm credentials in the repo. They go in the user-level `~/.npmrc`.

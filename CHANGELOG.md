# Changelog

All notable changes to `scroll-flyover` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: semver applies to the **library entry point** (`mountScrollFlyover`,
`makeRng`, the `--sf-*` custom properties) and to the `bin` installer. Builds that
Claude Code generates through `SKILL.md` vendor a frozen copy of the engine, so they
are unaffected by upgrades here until they are regenerated.

## [1.3.0] - 2026-09-09

### Added

- **`npx scroll-flyover --dir <path>`** installs the skill files into a directory of
  your choosing instead of only `~/.claude/skills/scroll-flyover`. The path names the
  skill's own folder — it receives `SKILL.md` and `references/` directly. Relative paths
  resolve against the current working directory.

  The default target was the only target, which meant the installer could not do
  something the README already documented as valid: Claude Code reads a project's
  `.claude/skills/` too, and installing there — so the skill can be committed alongside
  the code that depends on it — was impossible without copying files by hand.

  It also makes the files reachable by agents other than Claude Code, with a caveat
  worth stating plainly: `SKILL.md` uses Claude Code's frontmatter format, its Step 1
  interview is written around the `AskUserQuestion` tool, and its Step 8 accessibility
  audit asks for an `accessibility-reviewer` subagent, so another agent will not run
  this as a first-class skill and those two steps need a human to drive them. The
  remaining six steps and all of `references/` are plain Markdown that any agent able
  to read files on request, or any person, can work from directly.
- **`--help` and `--version`** on the installer.

### Fixed

- The installer now reports failures instead of surfacing a raw `cpSync` stack trace,
  rejects unknown arguments and a `--dir` with no value, and exits non-zero when it did
  not install. It previously had no argument handling at all, so anything passed to it
  was silently ignored.

## [1.2.0] - 2026-09-09

### Added

- **Opt-in theming through CSS custom properties.** Every inline color, blur and radius
  the engine paints — the copy panel, the CTA button, the route rail dots and the
  no-WebGL fallback card — now resolves through `var(--sf-*, <original literal>)`
  instead of a bare literal. Set any `--sf-*` property on the container (or an
  ancestor; they inherit like `color`) to retheme without forking
  `references/scrub-engine.js`. The full table of names and defaults is in the
  README's "As a library" section.

  Every default reproduces the previous look exactly, which is why this is a minor
  rather than a major. Note that `--sf-cta-bg` and `--sf-cta-text-color` override the
  contrast-checked defaults: if you set them, the contrast between them is yours to
  verify.

## [1.1.0] - 2026-09-09

This is the release that made the package importable as a library rather than only
runnable as a skill installer.

### Added

- **Library entry point.** The package shipped the engine inside its tarball but had no
  `main`, `module` or `exports` field, so `import { mountScrollFlyover } from
  'scroll-flyover'` failed. Adds an `exports` map alongside the existing `bin`, with a
  `./references/*` passthrough so deep imports that resolved before an `exports` field
  existed keep resolving — which is what keeps this a minor rather than a major.
- **`three` as an optional peer dependency**, `>=0.152.0`. The floor was established by
  probing releases, not guessed: `renderer.outputColorSpace` is absent in 0.150.1 and
  present from 0.152.0, and every API the engine touches still exists in 0.186.0. It is
  optional so that `npx scroll-flyover`, run only to install the skill, does not pull
  down three.
- **`config.labels`** for the engine's own UI strings. The route rail's `aria-label` was
  hardcoded Spanish, which a library would have injected into every consumer's page
  regardless of its language. It now defaults to English and is overridable as a
  function rather than a template string, because word order does not survive
  interpolation.

### Fixed

- **Scene copy is escaped rather than interpolated as HTML.** `eyebrow`, `title`,
  `body`, `tags` and `cta` were written straight into `innerHTML` in the overlay, the
  crawlable SEO block and the static fallback, so any of it sourced from a CMS or API
  could inject markup; `palette.accent` was interpolated into a `style` attribute, where
  a single quote was enough to break out and attach an event handler to the CTA button.
  Verified in Chromium against hostile copy and a hostile accent: injected `<img>`
  elements went from 27 to 0 and elements carrying an injected handler from 3 to 0, with
  the payload now rendering as text. **Consequence worth knowing:** markup in scene copy
  now renders literally instead of as tags.
- **Per-instance banking state.** `bankHistory` was a module-level array, so every
  flyover on a page fed curvature into the same 5-frame window, and it survived
  `dispose()` — a remount started banking from the previous flight's turns.
- **`dispose()` actually frees the GPU side.** It previously released only the photo
  textures and the renderer. It now also releases the scene's geometries and materials,
  the PMREM render target (the old code returned `target.texture` and dropped the
  target, which is what owns the allocation), the gradient background texture, and the
  WebGL context itself — `renderer.dispose()` clears three's caches but never releases
  the context. The WebGL feature-probe canvas also leaked a context of its own, so each
  mount was spending two context slots instead of one. Measured over 25 mount/dispose
  cycles in Chromium: released per cycle went from 1 geometry and 1 material to 7
  geometries, 10 materials, 1 texture and 1 render target; contexts released went from
  0/2 to 2/2.
- **`dispose()` no longer destroys host-owned DOM.** It called
  `container.innerHTML = ''`, wiping any children the host page owned. It now removes
  only the nodes the engine appended and restores the inline styles it overwrote. A
  host-owned child survives 25/25 cycles, up from 0/25.
- **The no-WebGL2 path** returned a no-op `dispose()` and left its fallback card behind
  in the host's container.

### Note on what this tarball contains

The published 1.1.0 artifact was cut after the four fixes above landed, not at the
commit that bumped the version — its contents correspond to `d1f46d9`, not `f0180b4`.
So 1.1.0 on npm already includes the escaping, labels, banking and dispose work, even
though those commits carry no version bump of their own. Tags in this repository point
at the trees that were actually published.

## [1.0.1] - 2026-09-08

### Fixed

- Gallery table alignment in the README.

## [1.0.0] - 2026-09-08

### Added

- First npm release: `npx scroll-flyover` installs the Claude Code skill (`SKILL.md`
  plus the `references/` set) into a project. The engine shipped inside the tarball but
  was not yet importable — see 1.1.0.

[1.3.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.3.0
[1.2.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.2.0
[1.1.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.1.0
[1.0.1]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.0.1
[1.0.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.0.0

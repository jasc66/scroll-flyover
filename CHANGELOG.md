# Changelog

All notable changes to `scroll-flyover` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: semver applies to the **library entry point** (`mountScrollFlyover`,
`makeRng`, the pure helpers exported since 1.5.0, the `--sf-*` custom properties) and to
the `bin` installer. Builds that
Claude Code generates through `SKILL.md` vendor a frozen copy of the engine, so they
are unaffected by upgrades here until they are regenerated.

## [1.5.0] - 2026-09-09

Verification moves into this repo. Until now the only automated coverage lived in the
separate `scroll-flyover-demo` repo and only ran once someone remembered to bump its
pinned dependency — so an engine regression could reach npm with nothing to catch it.
This release adds CI here, a unit suite over the deterministic logic, and fail-fast
config validation. Writing the tests immediately found two real defects, both invisible
to the screenshot-based QA that was the only check before.

### Fixed

- **`readableTextColor` could return a text color that fails WCAG AA.** Its crossover
  constant, 0.179, is the luminance where *black* and white swap places — but the
  function returned `#111`, which is not black. In a narrow band just above the
  crossover it therefore chose dark text that measured **4.157:1 on `#767676`**, under
  the 4.5:1 AA floor the function exists to guarantee. The dark option is now `#000`,
  which makes the constant and the color agree: the worst case across the entire
  luminance range is now **4.608:1**, and a test asserts that floor over several
  thousand backgrounds plus a dense walk along the grey axis.

  *Visible change:* CTA button labels on light accent colors are now pure black instead
  of `#111`. Nothing else moves, and the previous look is available by setting
  `--sf-cta-text-color: #111` — though doing so re-opens the AA gap on light accents.

- **Shorthand hex colors were misparsed as NaN.** `relativeLuminance('#eee')` read its
  third channel from an empty substring. NaN fails every comparison, so
  `readableTextColor` silently took the "dark background" branch and painted **white
  text on `#eee`** — roughly 1.1:1, from the function whose whole job is contrast. Both
  `#rgb` and `#rrggbb` are now accepted, with or without the leading `#`, in any case.

- **`playwright` was never declared as a dependency.** It was installed ad hoc in the
  working tree, so the QA script worked on the maintainer's machine and nowhere else —
  including CI. It and `three` are now proper `devDependencies` with a committed
  lockfile.

### Added

- **CI in this repo** (`.github/workflows/ci.yml`), on every push and pull request:
  unit tests on Node 20 and 22; the same tests against **both ends of the declared
  `three` range**, 0.152.0 and latest, so the documented peer floor is held by
  measurement rather than by memory; the Playwright reproducibility QA against the real
  shipped `references/index-template.html`; an installer smoke test that actually runs
  `bin/install.js --dir` and checks the files landed; and a check that the published
  tarball still carries its entry points and no `.npmrc`/`.env`.

- **A unit suite for the pure logic** (`test/`, 46 tests, no browser required): the
  seeded RNG's determinism and distribution, the WCAG contrast picker, the dwell easing
  (endpoints, monotonicity, continuity at segment boundaries, and that `dwellWeight: 1`
  collapses to the identity), the camera curve and its control-point signs, HTML
  escaping, and config validation. Run with `npm test`.

- **Config validation, before anything renders.** Invalid config was previously either a
  Three.js stack trace from somewhere unrelated, or no error at all and a black page.
  Now each mistake is reported as a `scroll-flyover:` error naming the property at
  fault: a container that is `null` (a `querySelector` that found nothing — called out
  by name, since it is the common one), a malformed `palette`, a non-hex
  `palette.accent` (hex specifically, because the CTA's text color is chosen by
  measuring its luminance), a scene missing its `build` function or returning nothing
  from it, a non-numeric `seed` (which the RNG silently collapsed to `0`, making every
  such build render identically), a `dwellWeight` of `0` (which divided by zero and put
  NaN into every camera position), a `layout` that returns the wrong shape, and
  malformed `photos`/`labels`. Unknown `performance`/`cameraFeel` values warn instead of
  throwing, since they still render a correct page. `shapeLanguage` is deliberately not
  validated — it is passed through to scene builders untouched.

- **The engine's pure helpers are now exported** alongside `mountScrollFlyover` and
  `makeRng`: `relativeLuminance`, `readableTextColor`, `escapeHtml`, `layoutAnchors`,
  `sceneControlPoints`, `buildWorldCurve`, `buildDwellEasing`, `nearestDwellCenter`.
  Additive — nothing was renamed or removed. They are what makes the logic testable, and
  they are genuinely useful on their own: `readableTextColor` is the right companion to
  overriding `--sf-cta-bg`, and `layoutAnchors` can be wrapped rather than replaced when
  writing a custom `config.layout`.

- **`CONTRIBUTING.md` and a bug report form** (`.github/ISSUE_TEMPLATE/bug_report.yml`),
  both leading with the two facts that decide how fast a bug can be fixed here: which
  version or commit you have, and whether you got a real WebGL2 scene or the static
  fallback — the engine degrades silently between them, so the same description covers
  two unrelated bugs.

- **`scripts/`**: `serve.mjs` (a dependency-free static server, because `file://` blocks
  the template's ES module imports and the obvious alternatives each break it a
  different way — `python -m http.server` can serve `.js` as `text/plain` on Windows,
  `npx serve` redirects `index.html` to an extensionless path and breaks the relative
  imports), `qa.mjs` (serves and runs the reproducibility check in one command, so it
  works the same on Windows and in CI), and `check-package.mjs`.

### Changed

- **`camera-path.md` §5 now describes what `dwellWeight` measurably does**, which is not
  what it used to claim. The doc said the knob spends more of the *scroll* range near
  each dive point; in fact the scroll axis is divided uniformly and the *curve* axis is
  divided by weight. Measured on the default layout, the scene spans are already 86–88%
  of the path's arc length, and the easing hands roughly a quarter of the scroll to the
  12–14% of path that makes up the handover between scenes — leaving the camera **2.1–2.3x
  faster over a scene than between two**. The pause the knob buys is in the handover,
  where one scene's copy gives way to the next.

  **The behaviour is unchanged**, deliberately: every shipped build's pacing was tuned by
  eye against it, and three projects depend on this engine without controlling when it
  changes under them. The docs now carry the measured table, and `test/easing.test.mjs`
  pins the direction so that flipping it has to be a decision rather than a cleanup.

## [1.4.1] - 2026-09-09

Docs only, no engine or installer changes.

### Added

- A second "real production build" example in the README: blog-tecno.vercel.app
  (TechInsight), a tech/science news blog using the tunnel-flight archetype, with five
  screenshots in `examples/blog-tecno/`.

## [1.4.0] - 2026-09-09

Mobile and small-viewport correctness. Desktop rendering is unchanged — the copy panel
measures identically at 1440x900 before and after (left 86.4px, bottom 90px, width
440px, 32px title).

### Fixed

- **The scroll length no longer freezes at mount.** It was computed once from
  `window.innerHeight` and written to the spacer as fixed pixels, while
  `currentScrollT()` divided by the *live* `window.innerHeight` — a frozen numerator
  over a moving denominator. After a rotation the whole flight was mis-mapped and every
  scene's dwell window fell out of step with where its copy fades. The spacer is now
  rebuilt when the viewport width changes, the divisor is pinned to the same height the
  spacer was built from so the two cannot disagree, and the visitor's position in the
  flight is preserved across the rebuild rather than their raw `scrollTop`.

  Measured over a 390x844 → 844x390 rotation from the midpoint of the flight: position
  drift went from **7.66% to 0%**.

  Height-only resizes are deliberately ignored. On mobile they fire continuously as the
  URL bar collapses and expands during scrolling, and re-laying out there would fight
  the visitor's own scroll with a corrective jump on every event.
- **The copy panel no longer runs underneath the route rail.** The panel was
  `left: 6%` with no `right`, so it shrink-to-fit against the full viewport and its text
  crossed the rail's 44px tap targets on narrow screens; it also made `max-width: 440px`
  inert below about 470px, since available width bound first. Measured overlap at
  320/360/390 portrait: **44px → 0px**. The reserved gutter is themable as
  `--sf-rail-gutter` (set it to `0px` if you hide the rail).
- **The pinned wrapper is `100dvh`**, with `100vh` kept as the fallback for browsers
  without `dvh`. A `100vh` pin stands taller than the visible area whenever a mobile URL
  bar is showing, pushing the bottom of the overlay below the fold exactly where there
  is least room. *Not demonstrable in a headless harness* — it has no dynamic URL bar,
  so both values measure the same there. This one rests on the CSS semantics, not on a
  measurement.
- **The copy panel and route rail honour `env(safe-area-inset-*)`**, so a notch in
  landscape or a home indicator does not sit on top of the copy.
- **Scene title and body type are fluid.** They were pinned at 2rem and 1rem at every
  width, which is what turned the narrow-screen layout into a legibility problem rather
  than merely a tight one. Title measures 32px → 21.6px at 320-390 portrait and stays
  32px at 740 wide.

### Added

- Six layout theme variables alongside the colour ones from 1.2.0:
  `--sf-rail-gutter`, `--sf-panel-inline`, `--sf-panel-bottom`, `--sf-panel-max-width`,
  `--sf-title-size`, `--sf-body-size`. Full table in the README.

### Note on the version bump

Minor rather than patch. No API breaks and no default *colours* move, but the copy
panel's box and type sizes do change on narrow viewports — a consumer who has tuned
their own layout around the old fixed geometry will see it shift, so this is not
something to pick up unread in a patch.

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

[1.4.1]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.4.1
[1.4.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.4.0
[1.3.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.3.0
[1.2.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.2.0
[1.1.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.1.0
[1.0.1]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.0.1
[1.0.0]: https://github.com/jasc66/scroll-flyover/releases/tag/v1.0.0

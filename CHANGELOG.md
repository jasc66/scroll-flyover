# Changelog

All notable changes to `scroll-flyover` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: semver applies to the **library entry point** (`mountScrollFlyover`,
`makeRng`, the pure helpers exported since 1.5.0, the `--sf-*` custom properties) and to
the `bin` installer. Builds that
Claude Code generates through `SKILL.md` vendor a frozen copy of the engine, so they
are unaffected by upgrades here until they are regenerated.

## [1.7.0] - 2026-09-10

Two defects found the same way 1.5.1's were — by running an accessibility audit, this
time against a project built from `SKILL.md` rather than against the engine. That
project is a hand-written React reimplementation of these ideas, so none of its findings
were engine bugs. Three of them described the *pattern* accurately enough to check here,
and two turned out to be real and unfixed in this engine.

### Added

- **The flight announces where it has arrived (WCAG 4.1.3, Status Messages).** A polite,
  atomic live region in the overlay speaks the scene the flight settles on. 1.5.1 gave
  the rail `aria-current`, which answers the question only for someone who has tabbed to
  the rail and gone looking — but scrolling is how this thing is driven, and a visitor
  moving through it with Page Down, a wheel or a thumb crossed every scene without one
  word of it reaching them.

  The message waits **250ms for the scrolling to stop**, because a scene boundary is
  crossed on the way past it: a fast scroll through six scenes crosses five in under a
  second, and announcing each would queue six messages a screen reader then reads out in
  full, long after the visitor stopped. It is also silent on load — whatever scene the
  page opens on is not a change, and announcing it would talk over the page's own load
  and over a deep link's landing position.

  The string is `labels.sceneAnnouncement(index, total, title)`, English by default like
  the other two, and validated like them. Keep the position in any override: "3 of 6" is
  the part that answers "where am I".

- **A focus ring the engine paints itself (WCAG 2.4.7 / 1.4.11).** The CTA and the rail
  dots had no focus styling at all, so they fell back to the browser's own thin outline —
  over a live WebGL scene, picked per build for how it looks lit and free to be
  near-white in one frame and near-black in the next. No single ring colour holds 3:1
  against that, so the ring is two: a light inner outline wrapped in a dark outer band,
  which always has one half contrasting whatever it lands on. Themable as the pair
  `--sf-focus-ring` / `--sf-focus-ring-shadow`.

  This is the engine's first `<style>` element — `:focus-visible` is a selector, and the
  distinction it draws is the whole point. Painting on plain `:focus` instead, which is
  all an inline style could express, would ring every rail dot a mouse taps. It lives
  inside the pinned wrapper, so `dispose()` takes it away with everything else.

  **If you already style focus on these controls,** note that `.sf-focusable:focus-visible`
  outranks a bare `:focus-visible` or `button:focus-visible` rule of yours. Retheme
  through the two variables, or outrank it back with a more specific selector.

- `SKILL.md` Step 6 now tells builders to give the page a **skip link and a `<main>`
  landmark**, with the markup and the two details that are easy to get wrong
  (`tabindex="-1"` on the target; the link must precede the mount container in the DOM).
  This is the one accessibility defect a flyover has by construction — the container is
  several viewports of scroll plus a tab stop per scene, standing between a keyboard
  visitor and everything below the hero (WCAG 2.4.1, Bypass Blocks) — and the engine
  cannot fix it from inside, because the thing worth skipping *to* lives outside the
  container it was handed. Step 8 gained the two manual passes that catch it: tab from a
  cold load, and fly the whole thing with Page Down alone.

### Changed

- `references/index-template.html` wraps its mount container in `<main>`, so the markup
  builders copy models the guidance above instead of contradicting it. No skip link
  there on purpose: the flyover is that page's entire content, so there is nothing to
  skip to — the comment in the template says when to add one.

### Notes

- `npm run qa:a11y` went 23 → 38 assertions. Rendering is unchanged: the reproducibility
  harness still reports byte-identical frames across reloads — the live region is clipped
  to 1px and the ring paints only on keyboard focus.

## [1.6.0] - 2026-09-10

The item 1.5.1 left open, decided and closed — plus the defect that had to be fixed
before it could be. Both are about the same question: a flyover says everything twice,
and until now both copies were live to assistive tech.

**The decision: the linear block is the content, the copy overlay is a painting of it.**
The tie-breaker is heading navigation. Jumping between headings is how a screen reader
user actually moves through a long page, and only the linear block can offer it — its
headings sit in reading order and are all present at once, while the overlay's arrive
one at a time, gated on scroll position. A heading you have to scrub a 3D flight to
reach is not a structure anyone can navigate by.

**The order was forced.** Hiding the overlay's copy from assistive tech is one
attribute, but `aria-hidden` across a focusable control leaves a tab stop that
assistive tech cannot name — the same class of defect 1.5.1 had just removed, arriving
from the other direction. The overlay's one focusable child was the CTA, and the CTA
turned out to be a dead button. So it went first.

### Fixed

- **The CTA was a button that could not do anything.** A scene's `cta` string painted a
  `<button>` with no click handler, no `href`, and no documented way to attach one —
  searched for: `SKILL.md` never mentions wiring it, and the README only documented its
  colors. It looked like the page's primary action and did nothing at all when pressed.

  `cta` is now the label only, and needs a destination: `ctaHref` for a link or
  `onCta(event, { index, scene })` for an in-page action. The destination also picks
  the element, which is the part that matters beyond the dead click — `ctaHref` renders
  a real `<a>`, so it can be opened in a new tab, previewed in the status bar, and
  reached through the links list a screen reader offers. Setting both is a config
  error; no element is both. A `cta` with neither warns, naming the scene and both
  ways out, and renders nothing. It warns rather than throwing on purpose: throwing
  would turn a button that never worked into a page that renders nothing at all.

- **Every scene was announced twice, and the heading list held two copies of it.**
  Measured on `references/index-template.html` at 1440x900, parked at the second
  scene's dwell centre, reading Chromium's own accessibility tree over CDP rather than
  the DOM: **`["Todo empieza aquí.", "Y continúa aquí.", "Y continúa aquí."]` before —
  three headings for two scenes — and two after.** (Three rather than four because
  1.5.1's `inert` already removed the inactive panel's; that release predicted exactly
  this residue and left it open.)

  The overlay's copy is now wrapped in one `aria-hidden` element, and the linear block
  is inserted *before* the visual layer instead of after it, so a linear read reaches
  the story first. The CTA is a **sibling** of that wrapper, never inside it, which is
  what keeps it in the accessibility tree and in the tab order.

- **`min-height: 44px` meant two different sizes on two elements.** Found while making
  a link CTA and a button CTA the same object: a `<button>` is `border-box` in every UA
  stylesheet and an `<a>` is not, so the same rule produced a 44px button and a **60px**
  link — measured on the template's own CTA. The 44px floor is a tap target (WCAG
  2.5.8), so it has to mean the whole control; `box-sizing` is now stated.

- **The comment above the block claimed it served visitors with JS disabled**, which it
  cannot: it is built by `document.createElement`. Flagged in 1.5.1, corrected here.

### Added

- **`ctaHref` and `onCta` on a scene**, with fail-fast validation for both, and
  `labels.ctaInScene` for the CTA's accessible name. That name is needed because the
  copy around the control is now `aria-hidden`, leaving the visible label as the only
  thing a screen reader gets — "Empezar", with nothing to say what it starts. It
  defaults to ``(label, title) => `${label} — ${title}` `` and must keep the visible
  label at the front, or speaking that label no longer activates the control (WCAG
  2.5.3, Label in Name).
- **`--sf-cta-font-size`** (`0.85rem`), because a `<button>` takes the browser's own
  control font size and an `<a>` takes the page's; with the CTA now being either one,
  the value is stated instead of inherited.
- **Fifteen new assertions in `npm run qa:a11y`** (8 before, 23 now), covering the CTA's
  element and destination, its accessible name and 44px tap target, one heading per
  scene in the browser's real accessibility tree, and the content block's position and
  freedom from controls. Run against 1.5.1's tree they produce **9 failures**; against
  this one, none.
- **Six unit tests** over the CTA validation (46 tests before, 52 now), including that
  a destination-less `cta` warns exactly once and names its scene rather than throwing.

### Visual change, measured

The CTA's label was the browser's default control font (13.33px Arial in Chromium) and
is now the overlay's own typeface at `--sf-cta-font-size`. It was kept at 0.85rem —
13.6px against the old 13.33px — specifically so a release about semantics would not
quietly resize every consumer's primary action.

What that costs, compared frame to frame at the second scene's dwell centre: **543 of
1,296,000 pixels differ (0.042%), all of them inside a 74x44 box at (126, 748)** — the
CTA's label. Every other pixel in the frame is identical, and the reproducibility
harness still reports three byte-identical reloads at the top of the page.

### Docs

- The author's live build, [alonso-portafolio-scrollflyover.vercel.app](https://alonso-portafolio-scrollflyover.vercel.app/),
  is now referenced where it was doing work but going unnamed: as `package.json`'s
  `author.url` (so it appears on the npm page), as a README "Author" section, at the
  head of `references/production-lessons.md` — whose every claim comes from that build,
  and is now checkable against a running page — and in `SKILL.md`'s Step 1
  expectation-setting, where one link settles what "stylized low-poly" means faster
  than a paragraph does.

### Known, not addressed

- A screen reader user reaches a scene's CTA the same way a sighted visitor does — by
  arriving at that scene, via the route rail's labelled dots. The CTA is deliberately
  *not* duplicated into the linear block: a control in a 1px clipped block is a tab
  stop with nothing on screen to show it has focus, and a second control competing with
  the visible one. The trade is real, and the rail is the mitigation.
- `qa:a11y` drives the shipped template, which has one CTA on one of two scenes. A
  build with a CTA on every scene, or with `onCta` instead of `ctaHref`, is covered by
  the unit tests' validation paths but not by a rendered assertion.

## [1.5.1] - 2026-09-10

Accessibility fixes in the copy overlay and route rail, found by running a WCAG 2.2
audit against the engine's own DOM — something no release had done before. 1.5.0's unit
suite caught a contrast bug precisely because contrast is measurable in isolation; every
defect below is a DOM behaviour it had no way to see.

All three are additive, and that is measured rather than asserted: the rendered frame of
`references/index-template.html` at 1440x900 is **byte-for-byte identical** before and
after, compared through the same reproducibility harness that proves the render is
deterministic in the first place.

### Fixed

- **Hidden scene panels stayed focusable, announced, and clickable.**
  `updateCopyVisibility` faded inactive panels with `opacity: 0` and nothing else, which
  hides a panel from sight alone — it keeps its place in the tab order, in the
  accessibility tree, and in hit-testing. Every panel also shares the same
  `left`/`right`/`bottom` with no `z-index`, so they stack in DOM order and the *last*
  scene's invisible CTA sat on top of every earlier scene's visible one.

  Measured on `references/index-template.html` at 1440x900: **3 tab stops landed inside
  an invisible panel before, 0 after**, and a mouse click on a visible CTA could be
  intercepted by a hidden one. Panels are now `inert` whenever they are not visible —
  one property that closes focus, the accessibility tree and pointer targeting at once,
  and which overrides the CTA's own inline `pointer-events: auto`. Panels are also born
  inert, since `frame()` skips its body while the container is off-screen and would
  otherwise leave a below-the-fold flyover's CTAs tabbable.

- **The route rail never told assistive tech which scene was active.** `updateRail`
  recoloured and scaled the dot `<span>`, but the `map` building the rail returned only
  that span and discarded its `<button>`, so no state could be set on the control
  itself. Colour and scale are not information a screen reader receives. The buttons are
  now retained alongside their dots and carry `aria-current`, verified to move as the
  visitor scrolls.

- **Both buttons defaulted to `type="submit"`.** Neither the CTA nor the rail buttons
  set a `type`, and a `<button>` without one submits. This engine is dropped into host
  pages it does not control, so a landing page that wraps the hero in a `<form>` — an
  adjacent signup form being the ordinary case — submitted that form on every rail tap.
  **Reproduced, not theorised**: wrapping the mount point in a `<form>` and tapping a
  rail dot fired `submit` before the fix and does not after. Both are now
  `type="button"`.

### Added

- **`npm run qa:a11y`** (`scripts/a11y-check.mjs`), running in CI alongside the
  reproducibility QA: drives the real template in Chromium and asserts that `inert`
  tracks visibility exactly, that no focus lands inside a hidden panel, that exactly one
  rail button is `aria-current`, and that a host `<form>` survives a rail tap.

### Known, not addressed

- `seoBlock` duplicates every scene's copy for screen readers, so the active scene is
  announced twice — once from the live overlay and once from the hidden block. Now that
  inactive panels are `inert`, the overlay exposes only the current scene, which reduces
  but does not remove the overlap. The fix is a genuine design choice — whether the
  linear block or the visual overlay is the canonical surface for assistive tech — and
  is deliberately left for a considered decision rather than settled here. The comment
  above `seoBlock` also still claims it serves visitors with JS disabled, which it
  cannot: it is created by `document.createElement`.

## [1.5.0] - 2026-09-09

Verification moves into this repo, and starts covering the engine rather than the
examples.

There was a `QA` workflow here once (`d43dd1f`), but it tested the example gallery, and
it was removed in `adb3b8e` when that gallery's runnable source moved out to
`scroll-flyover-demo` — correctly, since the thing it tested had left. What never
replaced it was any check on the part that stayed: the engine itself. From then until
now, the only automated coverage lived in the demo repo and only ran once someone
remembered to bump its pinned dependency, so an engine regression could reach npm with
nothing to catch it.

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

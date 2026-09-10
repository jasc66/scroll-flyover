# Contributing

This is a small project with a single maintainer and a handful of real production
users, so the bar is less "follow the process" and more "make it obvious what broke
and why". Bug reports that arrive with the four facts below are usually fixable the
same day; ones without them usually turn into a round trip.

## Reporting a bug

Open an issue at
[github.com/jasc66/scroll-flyover/issues](https://github.com/jasc66/scroll-flyover/issues)
with:

**1. Which version, and how you installed it.**

```bash
npm ls scroll-flyover     # if you installed the library
```

Version numbers alone have been misleading here before — 1.1.0 on npm shipped fixes
that were committed after its version bump, so what a version *contains* is not always
what its changelog entry says. If you cloned the repo or installed the skill, paste
`git rev-parse --short HEAD` instead. [`CHANGELOG.md`](CHANGELOG.md) records that
mismatch explicitly.

**2. Whether you got a real WebGL2 scene or the static fallback.**

This is the single most useful thing you can tell us, and it is almost always the
first thing we would ask. The engine silently degrades to a static card when WebGL2
is unavailable, so "the animation doesn't work" describes two completely different
bugs. Check in the browser console on the affected page:

```js
document.querySelectorAll('canvas').length            // 0 = static fallback, 1 = live scene
!!document.querySelector('[data-sf-fallback]')        // true = fallback is showing
!!document.createElement('canvas').getContext('webgl2')  // false = the browser has no WebGL2
```

**3. Browser, OS, and — if it is a layout bug — the viewport size.**

Include the device and whether it was portrait or landscape. Several fixed bugs in
this engine only appeared below 400 CSS px, or only after a rotation, and never at
1440x900. `window.innerWidth + 'x' + window.innerHeight` is enough.

**4. What you expected and what you got.**

For anything visual, a screenshot beats a description. If it is a scroll bug, say
roughly where in the scroll you were — "between scene 2 and 3" is more useful than
"partway down". Note that a full-page screenshot of a scroll-flyover build is
misleading by design: the pinned canvas is `position: sticky` inside a very tall host,
so full-page capture produces a huge black gap that is a screenshot artifact, not the
bug. Capture the viewport instead.

Also paste any console errors verbatim. `THREE.WebGLRenderer: Context Lost` and a
`scroll-flyover:` error are very different problems.

### Things that are usually not bugs here

- **Every reload looks slightly different.** A scene builder is calling
  `Math.random()` instead of the `rng` from its options argument. `npm run qa`
  detects exactly this.
- **The scroll pin does nothing.** The container is probably `position: sticky`
  already, or an ancestor has `overflow-x` set. See
  `references/production-lessons.md`.
- **It breaks under Next.js on first render.** The engine touches `window` on call —
  import the component with `dynamic(..., { ssr: false })`.

## Working on the code

```bash
npm install
npm test          # unit tests for the pure logic — fast, no browser
npm run qa        # renders the real template in Chromium and compares reloads
npm run serve     # static server, for opening references/index-template.html by hand
npm run check     # what CI runs, minus the browser
```

`npm run qa` needs a browser once: `npx playwright install chromium`.

CI runs the unit tests on Node 20 and 22, against both ends of the declared `three`
range (0.152.0 and latest), plus the reproducibility QA, an installer smoke test, and
a check that the published tarball still contains its entry points.

### What the tests are for

The unit tests cover the deterministic parts — the seeded RNG, the WCAG contrast
picker, the dwell easing, the camera curve, HTML escaping, config validation. They
exist because this project's failure mode is *subtle*: a sign flip in
`sceneControlPoints` or a shifted crossover constant produces a page that still
renders, still passes a screenshot check, and is quietly wrong. If you change any of
that math, the test that fails is the review.

One test is deliberately marked `CHARACTERISATION`. It pins current behaviour that
does not match its own documentation, so that changing it has to be a decision rather
than an accident. Read its comment before "fixing" it.

### Before opening a pull request

- `npm run check` passes.
- `npm run qa` passes, if you touched `references/scrub-engine.js` or the template.
- New behaviour in the engine comes with a test, if it is testable without a browser.
- Anything that changes what a built page looks like is called out explicitly in the
  PR description. Three real projects depend on this engine and do not control when
  it changes under them, so visual changes are semver events here, not cleanups.

## Releasing

Maintainer only, and worth writing down because it has gone wrong before:

1. `npm run check` and `npm run qa`.
2. Bump the version, update `CHANGELOG.md`.
3. Confirm `npm whoami` succeeds and that **no `.npmrc` exists inside the repo** —
   credentials belong in the user-level `~/.npmrc` and have leaked from a project one
   before.
4. `npm publish`, then tag the exact tree that was published:
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.

Tag the tree that actually went out, not the version-bump commit — they have differed
before, and the tag is what makes "which code does this user have?" answerable.

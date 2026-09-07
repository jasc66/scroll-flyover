# Production lessons (from a real build, not a demo)

Everything in this file was learned shipping one real flyover (a spiral-ascent
portfolio tower embedded in a Next.js/React site with bilingual copy) and cost real
diagnosis time because nothing in the rest of this skill warned about it. The other
reference files describe the happy path; this one is the list of ways the happy path
breaks in a real host page. Read it **before** debugging a stuck/black/jerky build —
check this list before re-deriving the camera math from scratch.

## Architecture: when NOT to use scrub-engine.js as-is

`references/scrub-engine.js` bakes each scene's copy into the DOM it creates
(`sectionEls[i].innerHTML = …`). That's fine for a static HTML page, but it makes the
copy **impossible to localize with a framework's i18n system** — there's no React
component to re-render, just strings the engine wrote once. If the host project needs
i18n (or any case where copy must be reactive to app state), don't adapt the engine —
**reimplement the same design in the host's language** (a `mountTower`-style function
returning `{ onProgress, scrollToLevel, dispose }` that positions the camera and drives
a *headless* progress callback), and let the host's own components render copy driven
by that callback. Keep the parts that don't depend on the DOM as-is: the seeded RNG,
the curve construction, the dwell easing. This is a legitimate reason to fork the
engine, not a sign something went wrong.

## Host-page CSS traps that break the scrub illusion

These have nothing to do with Three.js and will burn hours looking in the wrong place:

- **`overflow-x: hidden` on `<body>` (or any ancestor) breaks `position: sticky`.**
  Symptom: the canvas silently scrolls itself off-screen (its computed `top` goes
  deeply negative) and everything past the first scene renders black, with no console
  error. Fix: use `overflow-x: clip` instead — it clips without creating a new
  scrolling container, which is what defeats `sticky`.
- **`scroll-smooth` on `<html>` fights the scrub.** The engine reads scroll position
  every frame to drive the camera; CSS smooth-scrolling and JS-driven camera easing
  compound into a laggy, rubber-banded feel. Turn it off on any page that hosts a
  flyover.
- **`pnpm build` (or any production build) run while a dev server is still live against
  the same `.next`/build directory corrupts the build cache.** Symptom: `/_not-found`
  served with 404 chunks, blank/black screens, "broken" i18n toggles — none of which
  are flyover bugs. If something behaves impossibly after a build, `pkill next` (or
  the equivalent dev server process) and delete the build cache before diagnosing
  anything else.

## The `running` flag needs one boolean per pause reason, not one shared flag

Step 7 lists three independent reasons to pause the render loop: tab visibility,
`IntersectionObserver` off-screen, and WebGL context loss. **Do not fold all three into
a single `running = false/true` flag** — whichever handler sets it `false` last "wins,"
and if the `visibilitychange` handler sets `running = false` on tab-hide but nothing
ever sets it back to `true` on tab-show (a one-line oversight, easy to miss in review),
the flight freezes permanently on the next tab switch even though scrolling still
works. Keep separate flags (`isOnScreen`, `contextLost`, `document.visibilityState`)
and derive the actual `running` boolean from all three every frame; add a
`webglcontextrestored` listener to clear `contextLost`, mirroring the `webglcontextlost`
handler Step 7 already asks for. If a flight "gets stuck" after some UI interaction,
suspect this fan-in before suspecting the curve or the easing.

**The `IntersectionObserver` must observe the scroll host, not the canvas element.**
When the canvas is `position: absolute` inside a `position: sticky` parent (the layout
Step 6's config implies), observing the canvas itself means it "leaves the viewport"
the instant its sticky parent starts scrolling past — freezing `running=false` one
scene in. Observe the outer scroll container (the element whose height drives the
scrollable length), not the visually-sticky canvas wrapper.

## Camera aim has a sign trap — verify with a screenshot, never by reasoning about it

When shifting a scene's on-screen framing by nudging the *look-at* target sideways
(e.g. to make room for an HTML copy panel on one side), **the geometry moves in the
opposite screen direction from the look-at nudge**: pushing the look-at point right
pushes the visible geometry left, because you're rotating what the camera points at,
not translating the subject. This is exactly backwards from what most people expect
on first write, so a "fix" that flips the sign because the result "looks reversed" is
usually undoing a sign that was already correct — chase the actual rendered frame, not
intuition. Also: push the offset **perpendicular to the current view direction** (a
`screenRight` vector derived from the camera's forward vector), never as a fixed
world-space X offset — on any curved/orbiting path (spiral, orbit, terrain) a fixed
world-axis offset shoves the subject to a *different* screen edge at every waypoint.

**Never assign a per-scene "which side is copy safe" value by reasoning about that
scene's geometry alone — verify with an actual screenshot.** On a spiral (and any
archetype where a previous scene's structure stays in frame behind the current one),
the platform/prop from the PREVIOUS scene often still occupies the side that looks
empty on paper. Capture every scene (desktop width and one mobile width) before
finalizing any per-scene framing value; treat a predicted value as a draft, not a
result, until a screenshot confirms it.

## Camera easing needs inertia, or transitions feel "stuck"

The reference engine (`scrub-engine.js`) maps eased scroll `t` directly to
`curve.getPointAt(t)` every frame — position and look-at snap exactly to the curve
point for the current `t`, with no smoothing between frames. In production this reads
as mechanical/stuck during the handoff between scenes, especially at normal scroll
speeds on desktop trackpads. Two independent fixes, both worth doing:

1. **Widen the handover window** between a scene's own look-at target and the next
   scene's — instead of snapping the interpolation to a narrow band (e.g. 35%–65% of
   the transit segment), spread it across more of the segment (e.g. 25%–75%) so the
   camera's rotation is distributed over more scroll distance instead of happening in
   a short, noticeable snap.
2. **Add exponential smoothing (a simple lerp-toward-target per frame) to both camera
   position and look-at, not just look-at.** Something like
   `camera.position.lerp(targetPos, posAlpha)` and a similar lerp for the look-at
   target, evaluated every animation frame regardless of whether scroll moved that
   frame. Small alphas (roughly 0.01–0.02 for position, half that for look-at) add
   just enough inertia that scroll input feels like it's driving a camera with mass,
   not teleporting a point. This trades a tiny bit of "scroll accuracy" (the camera
   lags the exact scroll position by a frame or two) for a large gain in perceived
   smoothness — worth it every time in user testing.

Do not confuse this with the dwell easing (`camera-path.md` §5) — that reshapes how
scroll distance maps to `t`; this is a separate, additional smoothing of how the
rendered camera chases whatever `t` currently resolves to.

## Loading state: a real loader needs three emergency exits

If the build shows a loading screen before the first frame (recommended — shader
compilation and the procedural env map's `PMREMGenerator` pass both take a moment and
a black flash reads as broken), the "ready" signal must NOT fire on mount — fire it
after the first real `renderer.render()` call completes. But a naive "wait for first
render" promise can hang forever in three specific cases, so build in explicit exits:

1. **No WebGL2 support** — the static-fallback path (Step 7 / Gotchas) never calls
   `renderer.render`, so it must independently signal "ready" (with whatever fallback
   content it shows) rather than leave the loader spinning.
2. **The canvas starts outside the viewport** — if the flyover isn't the first thing
   on the page (e.g. it's below a nav or hero banner), an `IntersectionObserver`-gated
   render loop may not fire a frame until the user scrolls to it; the loader can't wait
   on a render that hasn't been requested yet. Either force one frame immediately on
   mount regardless of visibility, or have the loader listen for "mounted +
   intersecting" as an alternate ready path.
3. **Late subscription** — if whatever shows the loader (a parent component, a
   different module) attaches its "ready" listener after the engine already fired it,
   it waits forever. Make the ready signal idempotent/replayable (store a `ready`
   boolean and fire immediately for late subscribers) rather than a one-shot event.

**Mount the loader outside any `overflow: hidden` + `position: sticky` container.** A
sticky container with `overflow: hidden` clips `position: fixed` children that would
otherwise cover the full viewport — a full-screen loading overlay placed inside it gets
silently cropped to the sticky element's own box instead of covering the screen.

## Color: a hex validated for the 3D scene is not validated for HTML

`references/materials.md` and Step 1.3 pick a palette for how it reads as rendered,
lit, bloomed 3D material — that process says nothing about whether the same hex passes
WCAG contrast as **flat, unlit HTML text or a border**. A structural/accent color that
looks great as a `MeshStandardMaterial` (lit, often blended with bloom and the
environment map) can measure 3:1 or worse against page backgrounds when reused
verbatim as a CSS `color` or `border-color` on real DOM text — WCAG AA needs 4.5:1 for
body text, 3:1 for UI components/large text.

**Keep two variables per "3D structural" color that also needs an HTML use: one for
Three.js materials/geometry (`PALETTE.structure`, tuned for how it looks lit and
bloomed), one lightened/adjusted specifically for HTML text and borders
(`PALETTE.structureUI`, verified ≥4.5:1 against every background in the palette).**
Never let an HTML element reach for the 3D-tuned variable directly, even though it's
tempting because they're "the same brand color" — compute contrast against the actual
page background before trusting a shared hex in both places. This applies to the
signature-motif accent color too (Deliberate Uniqueness, SKILL.md) if it appears in
both the 3D scene (ring, glow, emissive prop) and any HTML control (an active-state
dot, a badge) — verify contrast for the HTML use independently of how the 3D use looks.

## `pointer-events` on overlapping opacity-toggled panels

If multiple copy/detail panels share the same absolute position and are distinguished
only by `opacity` (rather than `display`/mount state) — which is exactly what
`scrub-engine.js`'s `updateCopyVisibility` and any per-scene "detail panel" pattern
does — **every interactive element inside an inactive (opacity: 0) panel remains
clickable unless its `pointer-events` is explicitly tied to the active state, at every
level of the DOM tree that carries a fixed `pointer-events: auto`.** A parent wrapper
correctly toggling `pointer-events: none/auto` based on active state does NOT protect
a child that has its own fixed `pointer-events-auto` class/style (a button styled to
always be clickable "because the parent handles visibility") — `pointer-events`
doesn't cascade as an override, each element resolves its own value, and the more
specific one on the child wins. The observable bug: clicking a button that looks
correct (e.g. "read more" under the visible section) actually activates whatever panel
happens to be **last in DOM order** at that screen position, regardless of which one
is visually showing.

**Fix pattern:** compute `pointerEvents: isActive ? 'auto' : 'none'` inline and apply
it to BOTH the panel wrapper AND every interactive child inside it individually — never
rely on a static utility class for "this is clickable" on anything nested inside a
panel whose visibility is opacity-driven.

**Verify with an actual click, not a visibility check.** Playwright's (or any
automation tool's) `isVisible()` returns `true` for an `opacity: 0` element — it only
checks layout, not paint — so it will not catch this bug. Verify by calling `.click()`
for real and confirming the correct panel's action fired; when a click lands on the
wrong target, browser devtools' "click here to see what would receive this event" /
"ancestor blocked / element intercepted" trace (or Playwright's own actionability
error, which names the intercepting element) shows which overlapping element actually
absorbed it.

## QA: reproducibility check needs a real WebGL2 context, even headless

Step 8 says "reload three times, screenshots must be pixel-identical" and "grep for
`Math.random`" — both correct, but running that check in a plain headless browser often
silently falls back to the static no-WebGL2 fallback path instead of actually
exercising the 3D scene, producing a false pass (three identical fallback screenshots
prove nothing about the scene graph). **Headless Chrome needs software WebGL
explicitly enabled** to get a real WebGL2 context:
`--enable-unsafe-swiftshader --use-gl=swiftshader`. Without those flags, confirm first
that the screenshots you're comparing actually show the 3D scene and not the fallback
card before trusting a "pixel-identical" result.

## Cross-reference

See also `references/camera-path.md` (the math these lessons build on),
`references/visual-fidelity.md` (why a build looks flat/basic — a different failure
mode from the ones here, which are about correctness/robustness, not fidelity), and
the SKILL.md Gotchas section for the fidelity- and design-level failure modes this
file doesn't duplicate.

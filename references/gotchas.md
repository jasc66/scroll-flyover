# Gotchas

Symptom → cause/fix, for when a build looks basic, jerky, freezes, or breaks in a
host page. Grouped roughly in the order you'd hit them (visual quality → mobile →
photos → interaction → reproducibility → host-page integration).

## Visual quality

- **Muddy, same-y looking scenes** → you skipped Step 2's "one shape vocabulary,
  reused materials" rule and let each scene invent its own primitives/colors. Go back
  to the palette and shape language chosen at interview time; variety should come from
  *arrangement*, not from introducing new colors/shapes per scene.
- **Everything looks flat / plasticky** → only one light, or a light with no warm/cool
  contrast. Use the hemisphere + directional pair (Step 4) even at "Light" performance
  tier — it's cheap and does most of the visual work.
- **Shapes look basic / flat / like a tutorial** → this is almost never polygon count.
  Work the `references/visual-fidelity.md` checklist in order: tone mapping (§1),
  procedural env map (§2), then lower material roughness so the env is actually
  visible. Those three fix the large majority of cases. If it still reads flat, the
  silhouettes are all stock primitives — add one `ExtrudeGeometry` or `LatheGeometry`
  shape (§3). Adding more props before doing these makes the scene busier, not better.
- **Everything reads as matte cardboard** → `scene.environment` was never assigned, or
  materials kept `roughness: 0.85, metalness: 0.02` from the scene-recipes defaults.
  PBR materials need something to reflect (visual-fidelity.md §2).
- **Bloom smears the whole scene** → strength above ~0.6 or threshold too low; only the
  brightest pixels should bloom. Raise the threshold to 0.85 and keep exactly one
  emissive prop above it (visual-fidelity.md §4).
- **Build looks like a generic Three.js diorama demo** → this is the "Deliberate
  uniqueness" step (SKILL.md, above the References section) not being applied at
  interview time — the shape-language vocabulary alone doesn't differentiate builds.
  Go back to Step 1.1's follow-up question and find the one real detail a template
  wouldn't have; retrofit a signature motif into the existing scenes rather than
  declaring the build finished as-is.

## Camera and motion

- **Camera jerks at scene boundaries** → almost always a Catmull-Rom control-point
  spacing issue (Step 3.1), not a "seam" in the video sense — if consecutive scene
  anchors are too close together or too far apart relative to their neighbors, the
  curve's parameterization speeds up/slows down unnaturally. Keep spacing roughly even
  or fix it with the easing re-parameterization (Step 3.4), don't hand-place a fix
  point.
- **Banking looks drunk** → derived bank angle from curvature was applied to *every*
  frame including tight dive points where curvature spikes; clamp the max bank angle
  and smooth curvature with a small moving average before applying it.
- **Camera dives into empty ground on orbit/spiral** → those archetypes need the dive
  control point aimed inward at the hero object, not down at a platform; override
  `sceneControlPoints` per `references/camera-archetypes.md` §5.
- **Vertical descent or corridor feels like tumbling** → `cameraFeel: 'swoop'` was
  used; curvature banking fights both archetypes. Use `'glide'` (Step 1.7).
- **Scene transitions feel mechanical or "stuck" despite a correct curve** → the
  reference engine snaps camera position/look-at directly to `curve.getPointAt(t)`
  with no inertia. Add exponential smoothing (small per-frame lerp toward the target,
  both position and look-at) and widen the handover window between consecutive scenes'
  look-at targets. See `references/production-lessons.md`.

## Mobile and performance

- **Mobile is a slideshow** → performance tier wasn't actually downgraded for mobile
  (Step 7) even though "Rich" was picked for desktop; the mobile override must be
  unconditional, not a suggestion.
- **Build looks great but stutters, and the props aren't that many** → canvas textures
  are being regenerated per scene instead of once at mount, or the
  `references/materials.md` budget table was ignored (multiple animated water groups,
  Fresnel glow on more than the one peak prop). Generate each texture once and share
  the `THREE.Texture` across scenes.
- **Blank white page, console full of WebGL errors** → the visitor's browser/device
  has no WebGL2 support (rare, but old devices/some embedded webviews). Feature-detect
  (`!!document.createElement('canvas').getContext('webgl2')`) and show a static
  gradient + copy fallback rather than a broken canvas.

## Scope and dependencies

- **Wanting to vendor Three.js instead of CDN** (fully offline/air-gapped build): `npm
  install three` and import from the package instead of a CDN URL — the engine code
  doesn't care which, only the import line at the top of `scrub-engine.js` changes.
- **Tempted to add an AI-generated texture "just for one hero prop"** → that
  reintroduces the exact dependency (a paid image API + an asset to host) this skill
  exists to avoid. If truly needed, that's a deliberate scope change the user should
  approve explicitly, not a default. This is different from Step 2.5's user-photo
  support — a photo the user handed you is free and fine; a photo you generated or
  fetched from a stock-image API is not.
- **Adding an 8th+ scene "to show more of the business"** → re-read the peak-end rule
  and Miller's law notes (`references/ux-principles.md`) before agreeing — more scenes
  usually means a longer, less memorable journey, not a more convincing one. Push back
  once, then defer to the user if they still want it.

## User photos

- **User's photo looks washed out / flat / oddly desaturated** → `texture.colorSpace`
  wasn't set to `THREE.SRGBColorSpace` (Step 2.5). Every other color in the scene comes
  from `MeshStandardMaterial` hex values, which Three.js already treats correctly —
  photo textures need the explicit flag or they render too dark/flat next to them.
- **Photo looks stretched, squashed, or cropped oddly** → the plane geometry's aspect
  ratio doesn't match the photo's. Read `texture.image.width / texture.image.height`
  once the texture's `onLoad` fires and size the panel plane to match, rather than
  hard-coding a square or a fixed 16:9 plane (Step 2.5, recipe §8).
- **A photo tanks mobile framerate** → the source file was multi-megapixel straight off
  a phone camera and got handed to `TextureLoader` unmodified. Downscale to ≈1024px on
  the long edge before loading (Step 2.5) — a texture that never appears larger than a
  few hundred pixels on screen doesn't need 4000px of source data.
- **Whole scene goes blank when a photo path is wrong** → no `onError` handler was
  passed to `TextureLoader.load`. Always provide one that swaps in a flat
  accent-colored material instead, so a bad asset path degrades one prop, not the page.

## Interaction and overlay

- **Route rail dots are invisible/unreachable** → they're pinned inside `overlay`,
  which has `pointer-events: none`; the rail div itself needs its own `pointer-events:
  auto` (already set in the engine) — if you move the rail markup elsewhere while
  adapting the engine, carry that override with it or clicks pass through to the
  canvas instead.
- **Clicking a visible button triggers the wrong panel's action** → an inactive
  overlapping panel (opacity: 0, same position) has a child element with its own fixed
  `pointer-events: auto` that isn't tied to that panel's active state — a parent's
  toggled `pointer-events: none` does not override it. Tie `pointerEvents` to the
  active flag at every level, not just the wrapper, and verify with a real `.click()`,
  not `isVisible()` (which returns true for opacity:0). See
  `references/production-lessons.md`.
- **A copy panel's offset "fix" makes things worse, or looks reversed** → look-at
  nudges move the visible geometry the OPPOSITE screen direction; don't flip the sign
  because it looks backwards on first write, verify against an actual rendered frame.
  Also never trust a predicted "which side is empty" value for per-scene framing
  without a real screenshot — a previous scene's geometry often still occupies the
  side that looks free on paper. See `references/production-lessons.md`.
- **A structural/accent color looks fine in the 3D scene but fails contrast as HTML
  text or a border** → a hex tuned for a lit, bloomed `MeshStandardMaterial` is not
  validated for flat unlit HTML. Keep a separate, WCAG-checked variant for any HTML
  reuse of a 3D palette color rather than sharing the hex — see
  `references/production-lessons.md`.

## Reproducibility and QA

- **Page looks different on every reload / client can't approve a layout** → a scene
  builder used `Math.random()` instead of the seeded `rng` from its options argument
  (Step 2). Grep every builder for `Math.random` — there should be zero hits.
- **A headless "reload three times, compare screenshots" reproducibility check passes
  trivially** → plain headless Chrome may have no real WebGL2 context and silently be
  comparing the static fallback card, not the actual scene. Launch with
  `--enable-unsafe-swiftshader --use-gl=swiftshader` and confirm the screenshots show
  the 3D scene before trusting the result. See `references/production-lessons.md`.

## Host-page integration

- **Everything past the first scene renders black, no console error** → almost always
  `overflow-x: hidden` on `<body>` or an ancestor breaking `position: sticky` on the
  canvas wrapper — use `overflow-x: clip` instead. See
  `references/production-lessons.md` before suspecting the curve or the renderer.
- **The flight freezes permanently after switching tabs (or any UI interaction), but
  scroll still works** → a single shared `running` boolean is being set by more than
  one handler (tab visibility, `IntersectionObserver`, context loss) and one of them
  never sets it back to `true`. Use one flag per pause reason and derive `running` from
  all of them. Also confirm the `IntersectionObserver` watches the scroll host, not the
  sticky-positioned canvas itself — see `references/production-lessons.md`.
- **Adapting this engine into a project that needs i18n/localized copy** → don't adapt
  `scrub-engine.js`'s DOM-baked copy directly; reimplement the mount function in the
  host's own language so copy renders through its component/i18n system, and keep only
  the DOM-independent parts (seeded RNG, curve, easing). See
  `references/production-lessons.md`.
- **Loading screen never disappears** → the "ready" signal is waiting on a render that
  never gets requested (no WebGL2 → static fallback path, or the canvas starts
  off-screen under an `IntersectionObserver` gate) or on a listener that subscribed
  after the event already fired. Build in the three exits and make ready idempotent —
  see `references/production-lessons.md`. Also confirm the loader isn't mounted inside
  an `overflow:hidden` + `sticky` container, which clips a full-screen overlay.

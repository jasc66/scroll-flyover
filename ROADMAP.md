# Roadmap

Where `scroll-flyover` is headed, what has shipped, and what was considered and turned
down. Released detail lives in [`CHANGELOG.md`](CHANGELOG.md); how a release is cut
lives in [`CONTRIBUTING.md`](CONTRIBUTING.md#releasing). This file is the plan between
the two, kept in the repo so it travels with every clone.

## Direction

Two things in one package, and both stay:

- **A Claude Code skill** (`SKILL.md` + `references/`) that builds scroll-driven 3D
  fly-through pages from procedural geometry: no paid image or video generation, zero
  per-build cost.
- **An importable engine** (`import { mountScrollFlyover } from 'scroll-flyover'`) that
  other projects depend on directly.

Because the engine has real consumers, it is under semver. That sets the rules every
item below follows:

- **New behaviour is opt-in and off by default.** A minor release must not change a
  single pixel for a page that does not use the new feature. Each release so far was
  checked byte for byte against the previous one.
- **Nothing new in the engine's import graph** that a page which does not use a feature
  would have to resolve. An import map that maps only `three` must keep working.
- **A consumer can always stay behind.** Every published version has a `vX.Y.Z` tag on
  the tree that was actually published.
- **Measure, don't assert.** Pixel comparisons, the accessibility tree, frame cost.
  Several defects here were found only that way (see `references/production-lessons.md`
  and the changelog).

## Shipped

| Version | What | Notes |
| --- | --- | --- |
| 1.1.0 | Packaging: `exports`, ESM installer, `three` as optional peer | Phase 1 |
| 1.1.0–1.2.0 | Shared-code defects: per-instance banking, real `dispose()`, escaped copy, `config.labels`, `--sf-*` theming | Phase 2 |
| 1.3.0 | Installer `--dir` (project-level skills) | |
| 1.4.0 | Viewport: rotation drift, `dvh`, safe areas, `clamp()` type | |
| 1.5.0 | CI, unit tests, config validation | Phase 3 (part) |
| 1.5.1–1.7.0 | Accessibility: `inert` panels, `aria-current`, linear content block, real CTAs, live region, focus ring | |
| 1.8.0 | `renderAt(progress, { time })`, `resume()`, `config.clock` | Frame capture (video, exact screenshots) |
| 1.8.1 | TypeScript declarations | Phase 3 (part) |
| 1.9.0 | `scroll-flyover/effects`: film grain and velocity motion blur behind `config.effects` | Separate entry point |
| 1.10.0 | Depth of field from the camera's place on the path, `frame.landing` / `focusDistance`, `landingAt` | Measured on an Apple M2 only; still to measure on an integrated GPU |
| 1.11.0 | `config.onReady`, `qa-reproducibility.mjs --reduced-motion`, ticks as a function of `elapsed` | From putting a production site (TechInsight) into the demo gallery |

## Next, in order

1. **Capture example: done in the gallery** (`scroll-flyover-demo`,
   `scripts/capture.mjs`, `renderAt` into `ffmpeg`). Still to do: expose the handle in
   the other four examples, record one video each, and put them in this README.
2. **Upgrade TechInsight itself** from `^1.4.0`. Since 1.6.0 a `cta` needs a
   destination, so its forum button moves to `ctaHref`; its community tick stops
   accumulating per frame; its banner links leave the `aria-hidden` block; its loader
   moves to `onReady`. It is the first real consumer, so this upgrade is the proof
   that one can move forward without breakage.
3. **React / Next.js wrapper** (`dynamic(..., { ssr: false })`). The condition this
   item waited on is met: TechInsight is on Next and hand-wrote what a wrapper would
   own (client-only mount, dispose on unmount, loader, CTA through the router).
   Validated by moving TechInsight onto it with identical frames before and after.
4. **Measure depth of field on an integrated GPU.** Only measured on an Apple M2.
5. **Ask the consumers what they are building** before freezing more API surface. A
   "Showcase" issue template is the cheapest channel.
6. **Scene recipes as executable code** instead of markdown. Last: it freezes the most
   API, and it is still the most speculative piece.

Open question, not scheduled: **porting the skill to other coding agents** (GitHub
Copilot was mentioned). The engine and `references/*.md` are already agent-agnostic.
Only `SKILL.md` is Claude Code specific. A port means a second procedural document to
keep in sync, so it waits until someone confirms they want the *skill*, not just the
npm package.

## Considered and turned down

- **Renaming the project, a plugin ecosystem, an MCP server.** This is over-engineering
  for the project's size. The descriptive name and the zero-dependency stance stay.
- **A CSS-3D / GSAP camera** in the style of HTML-to-video frameworks. The engine
  already has a real WebGL camera, so this would be a step down. The ideas that did
  transfer: seek-based rendering (→ `renderAt`), shutter-based motion blur that is
  zero at rest, and static grain.
- **Effects inside the main engine module.** A static `three/addons` import would have
  broken every import map that maps only `three`, effects on or not. That is why they
  are a separate entry point, and why they use no `three/addons` at all.
- **Animated grain.** It is motion the visitor never asked for, and
  `prefers-reduced-motion` could not remove it without changing the look.

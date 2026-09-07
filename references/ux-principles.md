# UX principles behind this skill's usability decisions

Read this when questioning or modifying a usability-related decision (route rail, tap
target sizes, scene count, interview structure) — not when trying to make a build look
more distinctive. **These laws explain why the skill behaves the way it does; they are
not a source of visual originality.** See `SKILL.md`'s "Deliberate uniqueness" step for
that — the two concerns are separate and sometimes pull in opposite directions (most
notably Jakob's law, last row below, which explicitly favors the familiar).

| Decision in this skill | Underlying law |
|---|---|
| Interview questions capped at 2–3 options each (Step 1) | Hick's law — decision time grows with the number/complexity of choices |
| 4–7 scenes recommended (Step 1.5) | Miller's law — working memory holds ~7±2 items before a sequence stops reading as a story |
| One "peak" scene + a polished final scene, not evenly-spread effort (Step 1.5) | Peak-end rule — experiences are judged by their most intense moment and their ending, not the average |
| Route rail / progress dots (Step 5) | Zeigarnik effect — unfinished sequences hold attention more than finished ones |
| Photo limited to 1–2 scenes against a procedural backdrop (Step 2.5) | Von Restorff effect — an item that differs from its surroundings is disproportionately memorable, but only *because* of the contrast |
| One shape vocabulary reused everywhere (Step 2) | Gestalt laws of similarity/uniform connectedness/prägnanz — visually consistent elements read as one coherent whole |
| 44×44px minimum tap targets on CTA + rail (Step 5) | Fitts's law — acquisition time rises with distance and falls with target size |
| Graceful fallbacks for bad photo paths, WebGL loss, low-end GPUs (Steps 2.5, 7) | Postel's law — be liberal in what you accept, conservative in what you produce |
| Not covered above, but worth naming: default toward familiar interaction patterns (scroll = forward, no hidden gestures) | Jakob's law — users prefer a site to work like every other site they already know. This is in direct tension with "make it unique": originality belongs in the *visuals*, not in reinventing how scrolling itself behaves. |

Use this table to sanity-check a usability change, not to justify a visual one:
"don't add an 8th scene to show more" (Miller's law) and "don't spread visual effort
evenly across every scene" (peak-end rule) are usability/memorability arguments. They
say nothing about whether the geometry itself looks like everyone else's demo — that's
a separate problem, addressed in `SKILL.md`'s uniqueness step and below.

## The actual risk for this skill: convergent aesthetics

Every build uses the same three shape-language vocabularies (Step 1.4) and the same
handful of Three.js primitives (cylinders, icosahedra, boxes — scene-recipes.md). Left
on autopilot, that convergence is real: "low-poly diorama built from primitives" is
already a recognizable genre on the web (it's the default output of a hundred Three.js
tutorials), and two builds using this skill with similar palettes can end up looking
like siblings of every other one, not like a specific brand's world. Usability laws
don't fix this — they weren't designed to. What actually pushes against sameness:

- **A signature motif, chosen per build, not from a preset list.** One recurring
  geometric idea unique to *this* subject (not "trees" or "boxes" in general, but e.g.
  "every scene has one impossible/oversized object at 3x scale" or "every platform has
  a visible seam of exposed color where two materials meet") — repeated across scenes
  the same way the shape vocabulary is, but invented fresh per build rather than
  reused from a template.
- **Deliberately breaking one convention on purpose.** Pick exactly one: an unusual
  camera height (worm's-eye instead of the default elevated diorama view), a palette
  with a jarring accent instead of a harmonious one, non-orthogonal scene layout
  (anchors that don't sit on a gentle arc but zigzag), asymmetric scene spacing. One
  broken convention reads as intentional style; breaking all of them at once reads as
  broken software — Prägnanz still applies to the departure itself.
- **Let real content specifics drive the geometry, not the category.** "A bakery" as a
  category produces bread-loaf primitives (generic). "This specific bakery's oven is
  wood-fired and sits in the front window" produces a scene built around one
  oversized, glowing oven prop the camera has to fly past (specific). Push the
  interview (Step 1.1) for the one physical/sensory detail a stock description
  wouldn't include, and build the signature motif from that.

None of this is a new pipeline step — it's a lens to apply while doing Step 1.1 (the
subject interview) and Step 1.4 (shape language): ask what would make *this* world
unrecognizable as a template with the palette swapped, and build that answer into the
recipe before writing any scene code.

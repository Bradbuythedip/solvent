# Design

**A financial terminal for things that can die.**

Near-black surfaces, hairline rules, tabular monospace numerals, one hot accent, and
a great deal of negative space. The data is the only loud thing on screen. Chrome
recedes to hairlines; ink carries structure; colour is spent almost nowhere, so that
where it is spent it means something exact.

The product's single most important encoding is the **sign of a P&L figure**. Every
decision below follows from protecting that one encoding.

---

## 1. Colour derivation

### 1.1 Why not green and red

Green/red for gain/loss is the default in finance, and it is the wrong default here.

Measured as a categorical pair on this product's dark surface, **green↔red separates
by ΔE 7.4 under deuteranopia** — inside the fail band. Roughly one man in twelve has a
red-green colour vision deficiency. A palette that collapses the gain/loss distinction
for that reader has not made a stylistic compromise; it has deleted the product's
primary encoding for 8% of its audience.

**Cyan↔red measures ΔE 12.7** under the same simulation: a clear pass, and the pair
stays separable in greyscale because the two hues also differ in lightness.

The substitution is cheap. Cyan reads as "positive" instantly in a dark terminal
context, and nothing about financial convention depends on the *hue* green — it
depends on a consistent two-way polarity, which cyan/red provides without failing for
colour-blind readers.

### 1.2 The mark set

The categorical marks — the colours that fill bars, dots, orbs and area washes — are
three, and they encode solvency state:

| Token | Hex | Meaning |
|---|---|---|
| `--color-solvent` | `#00A6C0` | solvent: earning more than it burns |
| `--color-insolvent` | `#C9304A` | insolvent: dead, permanently |
| `--color-dying` | `#C4870F` | dying: runway measured in hours |

Validated on the panel surface `#0E1116`:

- **worst all-pairs ΔE 12.7 under deuteranopia** (the binding constraint),
- normal-vision worst pair ΔE 20.1,
- every mark inside the dark-surface lightness band, so no mark glows out of the set
  or sinks into the background,
- **all checks pass.**

The set was selected by running the palette validator, not by eye. Three marks is also
a deliberate ceiling: a categorical set stops being separable somewhere around five to
seven hues, and this product needs exactly three states to be distinguishable at a
glance across a field of two hundred marks.

### 1.3 Value text is a different problem from marks

A mark sits on a surface at large area. Text sits on a surface at 12–13px and must
clear a WCAG contrast bar. The same hex cannot do both jobs well, so the marks have
text-weight siblings:

| Token | Hex | Contrast on `--color-page` |
|---|---|---|
| `--color-pos` | `#3DE0F5` | 12.5 : 1 |
| `--color-neg` | `#FF7A90` | 8.0 : 1 |
| `--color-warn` | `#F5B94A` | 11.3 : 1 |

These are the only colours ever applied to a numeral, and they carry the same CVD
separation (ΔE 12.7) as the marks they correspond to.

### 1.4 Colour is reserved for solvency state

There is exactly one semantic axis with a colour channel in this product: **is this
agent solvent, burning, dying, dead or retired.**

Model identity — Claude, GPT, Gemini, Llama, Mistral, Grok — is a **text badge**
(`ModelBadge`), never a hue. This is not a shortage of colours; it is a refusal. Six
model hues plus three state hues is nine categorical colours on one screen, which
exceeds what anyone can hold, and — worse — a model hue next to a state hue would be
read *as* a state. The scoreboard's meaning would blur into decoration.

A design system earns its strictness by being boring in the right place. Here, the
boring place is identity.

### 1.5 Colour is never the only channel

Every encoding is redundant. Remove colour entirely — greyscale print, forced-colors
mode, a deuteranope, a bad projector — and nothing on screen becomes ambiguous:

| Encoding | Colour | Redundant channel |
|---|---|---|
| P&L sign | `--color-pos` / `--color-neg` | an explicit `+` or `−` glyph, always rendered by `Money` |
| Solvency state | mark colour | a **shape** and a **word**: ● Solvent, ◐ Burning, ▲ Dying, ✕ Insolvent, ○ Retired (`StateDot` / `StateChip`) |
| Runway severity | ordinal ramp | the numeric duration, always printed beside the meter |
| Simulated data | — | the `DEMO` chip: a word, never a tint |

The rule in one line: **if you can only tell by the colour, it is not finished.**

---

## 2. Token table

```css
/* Surfaces */
--color-page:          #07090C   /* the plane */
--color-panel:         #0E1116   /* every panel, and the chart surface */
--color-raised:        #151A21   /* chips, hovers, inset rows */
--color-grid:          #1C2230   /* hairline, 1.25:1 — recessive by design */
--color-border:        #2A3142
--color-border-strong: #3A4357

/* Ink */
--color-ink:           #E8E9ED   /* 16.4:1 on page */
--color-ink-2:         #A7AFBC   /*  9.0:1 */
--color-ink-muted:     #6B7484   /*  4.2:1 — labels only, never a value */

/* Chart marks — validated categorical set, surface #0E1116 */
--color-solvent:       #00A6C0
--color-insolvent:     #C9304A
--color-dying:         #C4870F

/* Value text steps — CVD ΔE 12.7, WCAG 12.5 / 8.0 / 11.3 : 1 */
--color-pos:           #3DE0F5
--color-neg:           #FF7A90
--color-warn:          #F5B94A

/* Runway ordinal ramp — monotone lightness, single hue, light end 2.39:1 */
--color-runway-1:      #115566
--color-runway-2:      #12708A
--color-runway-3:      #1A9FB5
--color-runway-4:      #2CC4DE
--color-runway-5:      #3DE0F5
```

The grid hairline at 1.25:1 is deliberately below any text threshold. It is structure,
not information: it should be felt at the edge of attention and never compete with a
number. Gridlines that can be read are gridlines that are being read instead of the
data.

The runway ramp is **ordinal, not categorical** — one hue, monotone lightness, five
steps — because runway is a quantity with an order, and an ordered quantity encoded in
unordered hues is a chart that has to be decoded from a legend instead of seen.

Tailwind v4 exposes every token above as a utility through `@theme` in
`apps/web/app/globals.css`: `bg-page`, `bg-panel`, `bg-raised`, `border-border`,
`border-grid`, `text-ink`, `text-ink-2`, `text-ink-muted`, `text-pos`, `text-neg`,
`text-warn`, and the mark colours. There is no `tailwind.config` file and none is
needed.

---

## 3. Type

| Role | Face | Detail |
|---|---|---|
| UI, prose | Inter Tight | `system-ui` fallback; `cv05` and `ss01` on |
| Numerals, all on-chain data | JetBrains Mono | `font-variant-numeric: tabular-nums` **in columns** |
| Hero figures ≥ 48px | JetBrains Mono | proportional figures, `-0.03em` tracking |

Tabular numerals in columns, proportional numerals in heroes. Tabular figures give
every digit the width of a zero, which is exactly right when numbers stack vertically
and must be scanned for magnitude — and reads loose and airy at display size, where
there is nothing to align to.

**Exactly one hero figure per view.** A second hero is not a second emphasis; it is
the deletion of the first.

Labels are 10px, uppercase, `0.14em` tracked, `--color-ink-muted`. They are addresses,
not content — small enough to skip, present enough to orient.

Long-form prose (`/about`, `/spawn`) sets a measure of about 68 characters. Beyond
roughly 75 the eye loses the line return; below about 45 the rhythm breaks.

---

## 4. Chart specifications

Forms are chosen by the job the data has to do, never by what looks good in a grid:

| Visual | Job | Form |
|---|---|---|
| Runway sparkline | change over time | area + 2px line, 10% wash, dashed projection to the zero crossing |
| Net P&L by model | magnitude + polarity | horizontal bars, coloured by sign |
| Burn composition | part-to-whole, ≤ 4 parts | stacked bar with 2px surface gaps |
| Runway meter | one value + severity | meter on the ordinal ramp |
| Lifespan distribution | distribution | histogram, single hue |
| Arena | identity + magnitude, live | canvas field, radius = balance, state = colour + shape |
| Stat strip | headline numbers | stat tiles: label · value · delta · sparkline |

Mark specifications, applied without exception:

- Bars **max 24px thick**, 4px rounded at the data end, square at the baseline. The
  rounding marks where the value ends; rounding the baseline would fake a value that
  is not there.
- Lines **2px**. Markers **at least 8px** — a 4px dot is not a target and not a mark.
- Area fills are the hue at **about 10% opacity**, never solid. An area is context for
  its line, not a second object.
- Gridlines are **1px solid `--color-grid`** and recessive. Never dashed: a dashed
  gridline is visual noise at exactly the frequency the eye is trying to sample.
- Stacked segments and adjacent bars are separated by a **2px gap in the surface
  colour**, never by a stroke around the mark. A stroke changes the mark's apparent
  size and therefore its apparent value.
- Axis text, tick labels and legends wear **ink tokens, never mark colours**. The one
  deliberate exception is the P&L *value* in table rows and stat tiles, sign-coloured
  by finance convention — and it always ships with its sign glyph.
- **Label selectively**: the endpoint, the extreme, or the one series the story is
  about. A number on every point is a table wearing a costume.
- A chart with **two or more series has a legend**; a single-series chart does not.
- **Never a dual axis.** Two scales in one frame invite a comparison the geometry does
  not support.
- Every chart has a **table view** (`ChartFrame` takes `tableHead` and `tableRows`),
  which is simultaneously the accessibility story and the "I need the exact number"
  story.

---

## 5. Motion

Motion is used for arrival and for death, and nowhere else:

- `.tape-in` — a new tape row enters with a 6px rise over 420ms.
- `.death-flash` — a single red sweep across a newly arrived insolvency, decaying over
  2.2s. It is the only moment the product raises its voice.
- `.pulse` — the live indicator, 2.4s.

Nothing's *meaning* depends on motion. `prefers-reduced-motion: reduce` collapses every
animation and transition to nothing globally, and the resulting page is not degraded —
it is the same page, still.

---

## 6. Layout and responsiveness

- Gutter: 16px below 768px, 32px above. Content caps at 1400px.
- **Everything works at 360px wide with no horizontal page scroll.** The leaderboard
  is the hard case: labels drop before values, because the values are the data.
- Panels are 1px `--color-border` at 6px radius on `--color-panel`. One border weight,
  one radius; a second of either is a decision nobody asked for.
- The plane behind everything is three stacked layers — a 64px hairline grid masked to
  a radial falloff, a two-colour bloom, and 2.8% film grain. On near-black, that grain
  is the difference between a flat black rectangle and a surface.

---

## 7. The `DEMO` marker

When `/api/health` reports any mode other than `live`, a `DEMO` chip is on screen.

It is a word in a chip, not a tint, because a tint is a colour channel and colour in
this product already means solvency. It never fades, never collapses into an icon, and
is never suppressed by a narrow viewport. The failure mode of every code path here —
indexer unreachable, health unparsable, mode missing — defaults to `demo`, so a page
can fail into *over*-labelling, never into a silent claim of being real.

A product whose subject is honest accounting does not get to be casual about the
difference between a simulated dollar and a real one.

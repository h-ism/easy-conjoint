# Easy Conjoint: Conjoint Experiment Builder

A single self-contained HTML file (no server, works offline) for designing and running
forced-choice paired-profile conjoint experiments — and exporting analysis-ready data.

Just double-click **`conjoint.html`**, or host it anywhere and share the link/file —
everything runs locally in the respondent's browser.

## What it does

### Design tab — plan the experiment easily
- Add/reorder **attributes** and their **levels**
- Optional **sampling weights** per level (leave equal for standard uniform randomization)
- **Constraints** to forbid implausible combinations (e.g. *Profession = Doctor* with
  *Education = No formal*) — profiles are re-drawn until valid
- Task settings: number of tasks, profiles per task (2–4), randomize attribute row order
  per respondent, disallow identical profiles, optional 1–7 rating
- **Import/Export JSON** so your design is reproducible and shareable
- **Load sample study** — a ready-made immigration conjoint (à la Hainmueller et al.) to
  see it working immediately

### Survey tab — run the actual experiment
- Each respondent gets freshly randomized paired profiles
- Click a card (or its button) to choose; progress bar tracks tasks; response saved
  automatically

### Data tab — collect & export
- Responses stored in the browser (localStorage)
- **Export CSV (long format)**: one row per profile per task, with a `chosen` (0/1)
  outcome and one column per attribute — exactly the shape AMCE estimation expects
  (CSV is written with a UTF-8 BOM so Excel reads Japanese/Unicode text correctly)

### Export for Qualtrics — field it at scale

The **Export for Qualtrics** button (Design tab) generates two files that let you run the
exact same design as a real Qualtrics survey:

- **`{title}_qualtrics.js`** — an ES5 JavaScript snippet you paste into each choice-task
  question (gear ▸ Add JavaScript). It randomizes every task once per respondent (attribute
  order shuffled once and shared across tasks; constraints via rejection sampling; no
  duplicate profiles within a task), writes the shown levels to Embedded Data, renders the
  profile table itself, and is **resume-safe** (sessionStorage → saved Embedded Data → fresh
  draw, so a resumed session never re-randomizes). You only change one line — `var TASK = 1;`
  — per question. After rendering, it also **centers the question layout**: the whole question
  container is centered, and the answer choices are re-centered as a left-aligned group. This
  is layout-agnostic — it finds the choices from the radio input rather than by Qualtrics class
  names (which vary by theme/version), and does nothing if no radio choice is present.
- **`{title}_qualtrics_setup.md`** — a step-by-step setup guide with your actual attribute
  names and task count baked in: how to build the questions, the full list of Embedded Data
  fields to declare in the Survey Flow (required — `setEmbeddedData` alone doesn't record
  them), the `A1…AK` ↔ attribute map, and an R snippet that reshapes the wide Qualtrics CSV
  to long format and runs `cjoint::amce`.

## Sampling weights (the numbers next to each level)

The number beside every level is a **sampling weight** — it controls how often that level
is randomly drawn when profiles are generated.

For a given attribute, the probability a level is picked is its weight divided by the sum
of all that attribute's weights.

- **All equal (the default, every level = 1)** → uniform randomization. Each level is
  equally likely. This is the standard conjoint setup and what you want in most cases.
- **Unequal weights** → some levels appear more or less often. Example: if *Country of
  origin* has 5 levels and you set *Germany* to `2` with the others at `1` (total = 6),
  Germany appears ~33% of the time and each other country ~17%.
- **Weight = 0** → the level is effectively never drawn, without deleting it.

When you might change them:

- To **match a real population** so the distribution of profiles mirrors actual
  demographics rather than being uniform.
- To **oversample a rare-but-important level** and get enough observations to estimate its
  effect precisely.
- To **temporarily disable** a level (set to 0) without removing it.

⚠️ Unequal weights make the design no longer uniformly randomized, which changes the
interpretation of AMCEs (they become weighted by your sampling distribution). For a
standard conjoint with clean, equally-weighted AMCE estimates, **leave them all at 1.**

## Analyze in R

```r
library(cjoint)
d <- read.csv("conjoint_long.csv")
results <- amce(chosen ~ Education + Profession + Country.of.origin,
                data = d, cluster = TRUE, respondent.id = "respondent_id")
summary(results)
```

## How to use it

Just double-click `conjoint.html`, or host it anywhere and share the link/file —
everything runs locally in the respondent's browser.

## Notes on the current design

- It uses **fully-randomized (independent) sampling** of levels, the standard conjoint
  approach. If you'd rather have a fixed pre-generated design deck (D-optimal / balanced),
  that's a different randomization scheme that can be added.
- Data lives in each respondent's browser, so for a real fielded study you'd collect the
  exported CSVs from each device. If you want responses pooled to one central place, that
  requires a full-stack version with a backend.

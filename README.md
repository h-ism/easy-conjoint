# Conjoint Experiment Builder

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

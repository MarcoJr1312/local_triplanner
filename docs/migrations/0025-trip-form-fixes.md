# 0025 — Trip form and long-range day strip fixes

| Field | Value |
|---|---|
| Status | **Fixed locally (2026-11-25)** |
| Area | `frontend-next` trip creation, settings and itinerary |
| Web image | `triplanner-local/web:kind-0.17.0` |
| Helm release | `triplanner` revision 18 |

## 1. Date range

**Problem:** A start date could be selected after the current end date
(for example Nov 12 → Nov 1), and the form only failed on submit.

**Fix:**

- Added `normalizeDateRange(start, end)`: if the end is empty or before the
  start, it becomes the start.
- New trip: changing the start date after the end auto-extends the end to the
  new start; the end input has `min={startDate}`; an earlier end is clamped.
- Trip settings: the same handlers and `min` constraint.
- Submit validates non-empty dates and `start <= end`.

## 2. Total budget input

**Problem:** The new-trip budget used a numeric state (`Number(...)`), so
clearing the field rendered `0`; typing after it produced a leading-zero value
such as `02500`.

**Fix:**

- The new-trip budget is stored as the raw input string.
- `parseBudgetInput(value)` treats empty as `0`, accepts `02500` as `2500`, and
  rejects negative/non-numeric values.
- The trip page budget edit uses the same parser.
- The input keeps an empty value while editing and has a `0` placeholder.

## 3. Long-range day strip

**Problem:** With a range such as Dec 22, 2026 → Jan 8, 2027 (18 days), the day
tabs shrank below their content width, wrapped their date text and spilled into
the Sort/Build route action row.

**Fix:**

- `.day-tabs` is now horizontally scrollable (`overflow-x:auto`) with a thin
  scrollbar.
- `.day-tab` is `flex:0 0 auto` and `white-space:nowrap`, so each tab keeps its
  full `Day N · date` label at a fixed 34px height.
- The action row stays below the tab strip at desktop and 740px widths.

## 4. Verification

- `bunx tsc --noEmit` passes.
- `bun test`: **45 pass, 0 fail** (9 new tests for `listDays`,
  `normalizeDateRange` and `parseBudgetInput`).
- `bun run build` passes.
- Headless Chrome against `http://triplanner.localhost:9080`:
  - Start `2027-02-01` → end auto-clamped to `2027-02-01`.
  - Budget cleared → empty; typing `2500` → `2500`.
  - Dec 22 → Jan 8: **18 day tabs**, `scrollWidth 1993`, `clientWidth 962`
    (740px viewport: `618`), tab height 34px, `white-space: nowrap`,
    `overflow-x: auto`; the action row top is below the tab strip at both
    widths.
  - No browser console errors.
- The demo trip was restored to `2026-12-04` → `2026-12-06`.
- Helm metrics smoke 8/8 and the Gateway `/metrics` `302` still pass; Helm tests
  7/7; Prometheus targets 8/8 up.

## 5. Files

- `frontend-next/lib/format.ts` — `listDays` uses local dates; date/budget helpers.
- `frontend-next/components/NewTripModal.tsx`
- `frontend-next/components/SettingsModal.tsx`
- `frontend-next/app/trip/[id]/page.tsx`
- `frontend-next/app/premium.css`
- `frontend-next/lib/format.test.ts`
- `deploy/kind/triplanner-values.yaml` and deploy helpers — `kind-0.17.0` image tag.

No backend, schema or data changes.

# Architecture rules

- Dashboard planning-source selection lives in a browser-safe pure module with regression tests; KPI cards and status donuts always share live planning data regardless of date range, while monthly averages and historical day-by-day charts keep their separate calculations.
- Nomination transitions update nominee eligibility before changing the parent stage, using the tested stage-aware filters in nominations.ts; existing RLS restricts nominee writes to the current stage.
- Nomination email sends return and log the provider acceptance ID (not delivery); creation retries share a stable provider idempotency key to avoid duplicate alerts within the provider retention window.
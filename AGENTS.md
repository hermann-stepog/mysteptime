# Architecture rules

- Dashboard planning-source selection lives in a browser-safe pure module with regression tests; KPI cards and status donuts always share live planning data regardless of date range, while monthly averages and historical day-by-day charts keep their separate calculations.
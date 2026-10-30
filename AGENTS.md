# Architecture rules

- Nomination observations use a shared editor and a notes-only authenticated database RPC with ownership/admin checks and atomic history; never widen stage update policies to edit notes.

- Centralize system-admin and operator capabilities in access-roles.ts, mirrored by database is_operator; keep actual stored roles unchanged so access expansion never alters email routing or identity.

- Dashboard planning-source selection lives in a browser-safe pure module with regression tests; KPI cards and status donuts always share live planning data regardless of date range, while monthly averages and historical day-by-day charts keep their separate calculations.
- Nomination transitions update nominee eligibility before changing the parent stage, using the tested stage-aware filters in nominations.ts; existing RLS restricts nominee writes to the current stage.
- Nomination email sends return and log the provider acceptance ID (not delivery); creation retries share a stable provider idempotency key to avoid duplicate alerts within the provider retention window.
- User creation runs in a server-only provisioning helper after the server function validates the bearer and operator role; avoid a second remote session lookup and roll back accounts when provisioning fails.
- New nomination requests save all function cards, creation history, and optional fixed teams through one SECURITY INVOKER database RPC; transactional writes prevent partial requests while preserving RLS.
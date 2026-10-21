# Architecture rules

- Dashboard planning-source selection lives in a browser-safe pure module with regression tests, so current KPI cards and occupancy donuts share live planning data while historical queries retain their snapshots.
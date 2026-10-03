# Live Data Boundary

The public `tennis_survivor` repository owns only the static website and its
versioned live-score client.

Live-data collection, normalization, state, credentials, operational controls,
and deployment configuration are maintained outside this public repository.
The browser consumes only the published HTTP and realtime API contracts.

Do not commit any of the following here:

- supplier adapters, schemas, field mappings, or capability declarations;
- upstream endpoints, credentials, raw responses, or capture fixtures;
- backend deployment files, operational runbooks, or provider-health metadata;
- canonical state or projection implementation.

Changes to `index.html` or `assets/live-score/` must remain compatible with the
currently deployed API until a separately validated cutover is complete.

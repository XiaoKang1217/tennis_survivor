# Real provider fixture registry

This directory is an intake and verification boundary for **real, legally
obtained, sanitized provider responses**. The baseline repository contains
handcrafted/derived inline unit-test objects, but no standalone raw response that
can honestly be promoted here.

Therefore `manifest.json` starts with `pending_capture` blockers. Do not “make the
tests green” by inventing payloads.

## Status lifecycle

```text
pending_capture -> quarantine -> verified
                         \-> rejected
```

- `pending_capture`: required case is known but no raw payload is available.
- `quarantine`: a contributor attested that the file is an authorized capture;
  hash and metadata are registered, but `realPayload` remains `false` because
  independent review is incomplete.
- `verified`: acquisition, sanitization, licensing/use, schema, and scenario
  relevance have been independently reviewed; only then is `realPayload=true`.
- `rejected`: retained as registry evidence but cannot be used as a contract
  fixture.

Only `verified` payloads can gate an adapter for shadow/production use.

## Safe capture

1. Capture the original response/PDF outside the repository through an authorized
   provider account or public official endpoint.
2. Never include request URLs with query strings, API keys, authorization
   headers, cookies, signed URLs, session IDs, or unrelated personal data.
3. Make a sanitized local copy. Do not transform tennis fields required to
   reproduce the incident.
4. Register only an existing `pending_capture` case:

```sh
npm run fixtures:register -- \
  --id api-tennis-normal-finish \
  --source-file /absolute/path/to/sanitized-response.json \
  --captured-at 2026-07-25T10:00:00Z \
  --endpoint-label get_fixtures \
  --attest-authorized-capture
```

`endpoint-label` is a non-secret method/endpoint name, not a URL. The attestation
states only that the contributor captured it through authorized access; it does
not mark the payload verified. The command:

- refuses URL/query-like labels and obvious secret material;
- validates JSON or PDF shape;
- copies the file under `quarantine/`;
- computes SHA-256 and byte count;
- changes only the selected manifest entry to `quarantine`.

The entire `quarantine/` tree is git-ignored. A normal `git add` therefore
cannot stage a newly captured payload. Only a separately sanitized and
independently reviewed file may be moved into the tracked `payloads/` area.

The command does not prove truth or rights. A different reviewer must inspect the
file and source rights, then move it to `payloads/` and mark it `verified` with
`reviewedBy`, `reviewedAt`, and `reviewNotes`.

### One-time API Tennis capture on the server

The repository includes a dedicated sampler that reads the key from
`API_TENNIS_KEY`, accepts only allowlisted methods, writes outside the repository,
and never prints the request URL, query, or key.

On the server, the user/operator may load the existing protected environment
file without putting a key in shell history:

```sh
set -a
. /etc/luwang-live-score.env
set +a
node scripts/capture-api-tennis-fixture.mjs \
  --method get_fixtures \
  --date-start 2026-07-25 \
  --date-stop 2026-07-26 \
  --timezone Asia/Shanghai \
  --output /tmp/api-tennis-fixtures-2026-07-25.json
unset API_TENNIS_KEY
```

For live score:

```sh
set -a
. /etc/luwang-live-score.env
set +a
node scripts/capture-api-tennis-fixture.mjs \
  --method get_livescore \
  --timezone Asia/Shanghai \
  --output /tmp/api-tennis-live-2026-07-25T100000Z.json
unset API_TENNIS_KEY
```

The sampler refuses an output path inside the repository and does not register
or commit the result. Inspect and sanitize the outside-repository copy, then use
`fixtures:register`. Do not run the capture from CI.

## Required metadata

Every captured entry records provider, capability, event type, scenario,
capture time, non-secret endpoint label, acquisition method, content type, file
path, bytes, SHA-256, authorized-capture attestation, secret review, and
independent review.

The raw fixture must remain byte-for-byte stable after registration. Any change
requires a new hash and review. Tests validate the manifest, path containment,
file type, byte count, and hash.

## Current blockers

Phase 0 has no real API Tennis response, WTA official response, ATP OOP PDF,
Goalserve sample, or ITF/junior raw sample. This is explicit in `manifest.json`
and `docs/architecture/PHASE0_BASELINE.md`. Provider capabilities with missing
verified fixtures cannot leave shadow mode.

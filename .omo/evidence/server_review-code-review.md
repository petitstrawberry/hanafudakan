# Code quality review: authoritative game server

Scope reviewed: `server/src/service.rs` and `server/src/main.rs`, plus the relevant game and API documentation needed to verify the server boundary. The workspace has no `.git` directory, so an original/base diff was unavailable; this review is of the implementation currently present.

## Re-review result

- **codeQualityStatus:** WATCH
- **recommendation:** APPROVE

## Findings

### CRITICAL

None.

### HIGH

None. The previous findings are resolved:

1. `NextRound` and `Rematch` now enforce `room.host_id == session.player_id` (`server/src/service.rs:847-885`).
2. Explicit leave now adds an active-game player to `departed`, removes that player from membership and action eligibility, clears their connections, and transfers the host when possible (`server/src/service.rs:194-197`, `304-329`, `787-827`). A host rematch drops departed seats and returns the room to waiting, while a departed player can only take a seat again through an explicit HTTP re-join (`server/src/service.rs:689-696`, `858-875`). CPU-host departure clears `host_id`, allowing maintenance to retire the room.

### MEDIUM

None.

### LOW

1. **WebSocket bearer credentials are put in the URL.** `WsQuery` accepts `token` from the query string and the API documents that format (`server/src/service.rs:726-758`, `docs/api.md:44-51`). The self-hosting guide warns operators to suppress query logging, but that leaves credential exposure to defaults of proxies, access logs, diagnostics, and copied URLs. Prefer an authentication mechanism that does not place the bearer credential in the request target when the browser/native client protocol permits it; otherwise make redaction a deployment requirement with a tested proxy example. This does not affect the authoritative move validation.

## Verification and test assessment

- I independently ran `/Users/petitstrawberry/.cargo/bin/cargo test --locked`: **25 passed**. I also ran `/Users/petitstrawberry/.cargo/bin/cargo clippy --all-targets -- -D warnings`: **passed**.
- The new behavioral tests cover non-host rejection for `next_round` and `rematch`, explicit departure's loss of membership/action authority, host reopening for a newcomer, and CPU-host quota release (`server/src/service.rs:1459-1515`). They are relevant behavioral regression tests; no deletion-only, tautological, implementation-constant-mirroring, or brittle prompt tests were found.
- **Skill-perspective check:** The required `remove-ai-slops` and `programming` skills were not available in this task's skills catalog, so they could not be loaded. Applying the requested criteria directly, the production code in the reviewed scope has no needless data extraction/parsing/normalization or untyped escape hatches, and the tests are behavioral rather than deletion-only, tautological, or implementation-mirroring tests. The diff does not violate either skill perspective.

## Lifecycle and startup notes

The process is intentionally in-memory; `main` creates fresh `AppState` on startup and starts maintenance after binding the listener (`server/src/main.rs:13-23`). There is no persisted state to clean up across restarts. The maintenance task expires sessions and prunes disconnected rooms after `ROOM_TTL` (`server/src/service.rs:964-993`).

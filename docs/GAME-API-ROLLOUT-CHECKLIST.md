# HSHONAD game API rollout checklist

This checklist is for the additive game API tables in `migrations/game-api-migration.sql`.
It does not replace the existing `players` table or prove that every game-client response matches the original game protocol.

## 1. Database migration
1. Open the correct Supabase project.
2. Open **SQL Editor** and run `migrations/game-api-migration.sql`.
3. Confirm the four tables exist: `game_bonus_data`, `game_mailbox`, `game_gacha_banners`, and `game_treasure_progress`.
4. Keep Row Level Security enabled. Do not expose the Supabase service-role key in the desktop launcher or browser code.

## 2. Backend environment
Configure these values in the hosting provider's server-side environment, using the names already consumed by `server.js`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` (if required by the host)

Never commit real credentials to GitHub. Rotate any credential that was previously exposed.

## 3. Seed data before testing
- Add active rows to `game_bonus_data` and `game_gacha_banners` only when there is real payload data for the client protocol.
- Add a mailbox row tied to an existing `players.steam_id` before testing mailbox reads.
- Create treasure progress for a real test player before testing progress retrieval.
- Do not assume an empty table is a successful game response: verify the expected JSON schema with the game client or a known-good capture.

## 4. Verification checklist
- [ ] Backend starts successfully and binds to the host-provided port.
- [ ] Health endpoint returns success.
- [ ] All 30 documented `/live` and `/logapi` paths are checked against their expected HTTP method, authentication, request body, and response JSON.
- [ ] Missing/invalid Steam IDs are rejected safely.
- [ ] Ban checks use the same player's Steam ID and Discord ID; mismatches must not authenticate.
- [ ] Closed game server returns the documented `server_closed` result.
- [ ] Mailbox and treasure queries are scoped to the authenticated player.
- [ ] Logs do not contain session tokens, service-role keys, or passwords.
- [ ] Admin actions are authenticated and authorized; browser-side hiding alone is not access control.

## 5. Current limitation
A route appearing in source code or a static audit is not proof of compatibility. Before calling this production-ready, run the service against a test Supabase project and verify responses against the actual game client protocol. Populate the bonus and gacha tables, and add administrative CRUD only after the intended payload schemas are confirmed.

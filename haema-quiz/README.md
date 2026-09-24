# Häma-Quiz

Three weekly sets of five literature-verified German single-best-answer questions.

## Runtime

- Static frontend: `dist/` (also mirrored to `haema-quiz/` in `jochim-uke/uke`).
- Supabase project: `tjjtemvclcgqmuhlnumr`; Edge Function: `haema-quiz`.
- Server schema: `backend/schema.sql`. RLS is enabled; anon/authenticated have no table or RPC permissions. Only the Edge Function's service role reads/writes these tables.
- Public routes expose educational questions and feedback; no patient data. Correct answers are returned only by the answer route. This is a learning tool, not an exam security system.
- Admin login: bcrypt hash stored only in `hq_admin`. Rate limits: 10 attempts per client and 100 globally per 15-minute window. Sessions: random 256-bit tokens, stored only as SHA-256 digests server-side, valid for two hours. Browser tokens exist only in memory.
- Deletion sets `deleted_at`; public routes filter it immediately. Tombstones prevent automatic reimports. No hard-delete UI or restore path.
- Quiz progress lasts only for the current page session; it is not synchronized across devices.

## Weekly publishing contract

Read `content/2026-W39.json` as the format example. Produce a new JSON object with ISO-week `id` (`YYYY-Www`), title and exactly three sets; each has a title and exactly five questions. Questions require topic, question, hint, explanation, reviewed_at (ISO date), four options A–D (value, label, feedback), correct (one letter), and sources (title, HTTPS url). Set IDs and question IDs are assigned deterministically by the importer.

1. Read current `hq_weeks` and all `hq_questions` including tombstones. Avoid repeating existing or deleted questions. Independently verify medical evidence, citations and exactly one correct option. Balance correct letters. Never use press releases as clinical evidence.
2. Store the edition as `haema-quiz/content/YYYY-Www.json` on the default branch of `jochim-uke/uke` using the GitHub connector. Use existing file contents on a retry; do not silently replace an edition.
3. Through the authorized Supabase connector run `select public.hq_import_week(<safely quoted JSON>::jsonb);`. SQL-escape apostrophes or use a checked dollar-quote delimiter. The function validates structure and imports in a single transaction. Repeated calls for an existing week return `already_exists` and never restore deleted questions.
4. Verify exactly three sets and initially fifteen questions in the database and through the public Edge Function (`?action=weeks`, `?action=set&id=...`). On a retry, reduced active counts may reflect admin deletions: inspect tombstones; never restore them automatically.
5. Deliver the three five-question sets in ChatGPT, using the learning quiz widget and links outside widget feedback. Include a link to the app. Report successful transfer only after verification. A GitHub-only file does not publish an edition to the app; a database import does. If one side fails, report the partial state and retry idempotently.

No credentials, password hashes, session tokens or API secrets may be committed. The weekly automation uses authorized connectors and does not need the admin password. New weeks appear without rebuilding the website. The initial set 1 adapts the five questions from the chat pilot; sets 2 and 3 add ten questions.

## Verification

`node --check dist/app.js`. Validate the API's public reads, hidden answer fields, answer grading, rejected anonymous deletion, rejected wrong password, successful admin login, deletion of a synthetic test question, and logout/session revocation. Never delete a real question merely for a test.

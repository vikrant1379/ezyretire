# Personal data export, retention, and deletion policy

This is the engineering policy for ezyRetire's portability and erasure controls. It
is not a claim of legal certification and must be reviewed by product/legal before
launch.

## Inventory and export

The versioned ZIP export contains `data.json` (the versioned allowlisted export),
`index.html`, and owner-authorized vault files under `files/`. The data includes the
account/profile; retirement assumptions and
UI preferences; dependents and financial accounts; income schedules, receipts and
salary details; loans, expenses, budgets and investments; notification preferences,
delivery state and generated monthly reports held in planning data; premium
entitlement; nominees; vault document metadata, upload/review lifecycle metadata;
advice requests, payment references and WhatsApp delivery events; successful login
activity; passkey lifecycle metadata; OTP lifecycle metadata; session count; and
export audit events. Vault document names, types, sizes, categories and lifecycle
dates are included so the package is intelligible. Every file is read with an
owner-authorized storage assertion while the account write fence is held; any
missing/unreadable file fails the complete export rather than producing a partial
archive.

ZIP generation has a finite server deadline. Generation stages the archive in a
private temporary directory, releases the account fence before download egress, and
uses uncompressed ZIP entries to keep CPU work predictable. The same cancellation
deadline covers fence admission, archive generation, storage reads, and staged-file
egress. It always removes the staged file on success, disconnect, timeout, or failure. A timed
out or unreadable export is marked failed and may be requested again; no partial
archive is represented as complete and no durable ready-download copy is retained.

Credential secrets are never portable data: password/code hashes, OTP and WebAuthn
challenge values, passkey public keys, session/bearer tokens, push encryption keys,
storage provider paths and internal storage errors are excluded and named in the
manifest. Export queries are always filtered by the authenticated account. The
manifest contains format version, export ID, UTC generation time, per-section record
counts and a completeness flag. Delivery is an authenticated ZIP attachment with
`Cache-Control: no-store, private`, `Pragma: no-cache`, and `nosniff`; the server
stores only audit metadata, never a second export copy or download URL.

## Deletion lifecycle

Requesting deletion requires an authentication event within 15 minutes, the exact
account email, and the phrase `DELETE MY ACCOUNT`. The request is idempotent. All
sessions are revoked immediately and the account enters a **seven-day cooling
period**. The user may sign in again and cancel until processing starts. Status is
available through the account deletion API and profile UI.

After seven days, processing is idempotently retried. Owned vault and staging
objects are inventoried into durable per-object checkpoints and deleted in bounded
batches using owner-checked deletion. Inventory itself is a persisted, paginated
phase and each database insert is bind-safe; a large account is never rescanned from
the beginning on every retry. Successful objects are checkpointed before
the invocation returns. Leased retries may repeat an already completed provider
delete, so provider deletion must remain idempotent. A storage failure blocks
database erasure and is retried rather than orphaning bytes. Only after every
checkpoint is complete is the user row deleted in the same database transaction
that removes checkpoints and finalizes the audit record; foreign-key cascades purge profile, finance,
premium, document metadata, notifications/reports, advice/support, passkey,
mobile-verification and login-activity data. Matching email-code challenges and all
sessions are explicitly removed.

The sole retention exception is a minimal compliance record containing a one-way
account identifier, request/schedule/completion timestamps, attempt count and final
status. It contains no email, name, finance data, payment reference, device data or
object path and is retained for up to three years for security, dispute, and
erasure-accountability purposes. When erasure completes, every retained request
history row for that account, including earlier cancellations, is changed to the
one-way identifier. Scheduled maintenance purges both completed and cancelled
terminal records when their retention deadline passes; active requests are not
removed by retention cleanup.
Export audit metadata follows the same three-year maximum. Backups and provider
replicas expire under their managed rotation; they are not restored to active use
except for disaster recovery and remain access controlled until expiry.

Compliance uses bounded next-attempt ordering and planning uses bounded cursor pages;
both stop admitting new work before their invocation deadline. Planning rotates accounts
with a dedicated global scheduler cursor rather than changing customer profile
timestamps. Deletion retries persist exponential backoff and are ordered by their
next-attempt time so one failing account cannot starve later due work. Account deletion state is rechecked after each account
fence is acquired, and notification/report delivery keeps its existing deduplication
and provider idempotency keys.
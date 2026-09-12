# ezyRetire API

## Email OTP sign-in

Consumer sign-in uses one-time codes delivered by [Resend](https://resend.com). Configure these values as Replit workspace secrets:

- `RESEND_API_KEY`: a Resend API key permitted to send transactional email.
- `AUTH_EMAIL_FROM`: a branded sender, for example `ezyRetire <login@example.com>`.
- `SESSION_SECRET`: at least 32 random characters; also protects stored OTP hashes.
- `APP_URL`: the public application origin.

Before production rollout, add a domain (preferably a transactional subdomain such as `auth.example.com`) in Resend, publish the DNS records Resend provides, wait for the dashboard to show it as verified, and set `AUTH_EMAIL_FROM` to an address on that exact domain. Resend's testing sender can send only to the email address associated with the Resend account; it is not suitable for real users.

As of September 2026, Resend's published Free plan allows 3,000 emails per month and 100 per day, with no paid overage. Limits and plans can change, so confirm the [current pricing](https://resend.com/pricing) and [usage limits](https://resend.com/docs/api-reference/rate-limit) during rollout. The API classifies missing/invalid configuration, sender or domain restrictions, quota/rate limits, recipient validation, and transient failures for credential-free operator logs. Logs contain the category, HTTP status, and Resend error type only—not addresses, codes, API keys, response messages, or message bodies.


### Production readiness checklist

1. Confirm `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `SESSION_SECRET`, and `APP_URL` are configured in the deployed environment (never commit their values).
2. Confirm the sender domain is verified in Resend and `AUTH_EMAIL_FROM` uses that domain; do not use `onboarding@resend.dev` for public traffic.
3. Send a code to a real external test mailbox and complete verification before routing users to email OTP.
4. Check current daily/monthly quota and API rate-limit headroom; configure operational monitoring for `quota`, `sender`, `configuration`, and `transient` delivery categories.
5. Confirm failed sends return no challenge ID and create no active challenge or resend delay.

Codes expire after 10 minutes, are single-use, allow five failed attempts, and can be resent after 60 seconds. Issuance is serialized per address, older codes are invalidated on resend, and each requester network is capped at 20 requests per 10 minutes. Each provider request uses the challenge ID as a Resend idempotency key. If delivery remains indeterminate after bounded retries, the challenge stays pending and cannot be verified; a later request retries the same challenge, deterministic code, body, and provider key instead of sending a different valid code. The server stores only keyed hashes of codes and requester addresses and never logs addresses, codes, API keys, provider messages, or message bodies.

Existing password users sign in by requesting a code at their existing email. The normalized email attaches the verified session to the same user ID, preserving financial data. Password endpoints no longer authenticate users. Replit OIDC and the administrator OIDC route are unchanged.

Mobile numbers collected during onboarding are profile contact information only; phone ownership verification is deferred.

Before publishing, apply the additive database schema to the production database and run `pnpm run check:production-schema` against it. Publishing must not route traffic to the OTP endpoints until that check confirms the challenge table and `users.email_verified_at` column.

## Passkey deployment and real-device smoke test

Apply `lib/db/migrations/20260910_add_passkeys.sql`, `20260911_passkey_challenge_rp.sql`, and `20260912_passkey_browser_binding.sql` before deploying passkey routes. The production schema check verifies these tables plus the user email-verification and session columns needed to preserve step-up evidence. Set `PASSKEY_RP_ID` to the stable domain only (for example `ezyretire.com`) and `PASSKEY_ORIGIN` to the exact HTTPS web origin (for example `https://www.ezyretire.com`), with no path or trailing slash. Both are mandatory in production and the origin host must equal or be a subdomain of the RP ID. Replit development previews use the exact platform-provided `REPLIT_DEV_DOMAIN` when passkey variables are absent; other preview hosts need their own compatible configuration. Credentials do not transfer between unrelated RP IDs. Unconfigured HTTP fallback is intentionally limited to localhost development. Invalid configuration or missing schema prerequisites return a controlled 503 response without exposing configuration or database details.

After deployment, use a real recently email-verified customer and:

1. On current iOS Safari or Android Chrome, register a passkey using device biometrics; name it, list it, rename it, and confirm it survives a reload.
2. Sign out, choose username-less passkey sign-in, and confirm the account is selected by the authenticator without entering an email and receives the normal `sid` session.
3. Attempt to reuse the completed authentication response and confirm it fails. Revoke the credential after re-verifying email, then confirm it can no longer sign in.
4. Register a second passkey (ideally another device or security key), revoke only one, and confirm the other remains usable.
5. Confirm audit rows contain `registered`, `renamed`, `authenticated`, and `revoked`, and that login activity reports `passkey`. Never log assertion payloads, challenges, public keys, credential IDs, or account-identifying failure details.

Ceremonies require user verification and discoverable credentials. Challenges expire after five minutes, persist their exact RP ID/origin and a one-way browser-cookie binding, are consumed once under a row lock, and issuance is serialized and limited to 20 per network and ceremony type per ten minutes. Every passkey mutation requires an exact trusted HTTP Origin and JSON content type. The initiating browser must return the matching short-lived Secure, HttpOnly `__Host-` ceremony cookie; the server emits it as SameSite=Strict, while the browser binding and exact-Origin check remain authoritative if a managed reverse proxy normalizes that attribute. Together these controls prevent login CSRF and valid stolen assertions from installing a session in another browser. Credential management requires a fresh email OTP requested for the authenticated server-side account. Successful verification rotates and invalidates the prior SID, and only the new browser session receives 15 minutes of step-up evidence; OIDC, passkey, old, and otherwise email-verified sessions receive the same actionable 403 until they complete that bound flow. Issuance retains expired challenges through the full ten-minute counting window, then removes at most 100 eligible expired or more-than-24-hour-old consumed challenges.

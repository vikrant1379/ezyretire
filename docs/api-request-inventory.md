# API request lifecycle inventory

Private authenticated responses remain memory-only in TanStack Query. The API
server applies `Cache-Control: no-store` to every `/api` response; no browser,
service-worker, proxy, or shared cache may persist financial or admin payloads.

| Data / operation | Cache key or endpoint | Freshness trigger | Reconciliation |
| --- | --- | --- | --- |
| Aggregate financial data and all domain selectors | `["financial-data"]`, `GET /api/financial-data` | Fresh for 60 seconds; stale active data may refresh on mount, focus, or reconnect; one retry | All PUT/PATCH/DELETE responses contain the canonical document and replace this cache directly; no follow-up GET |
| Financial PUT writes | `PUT /api/financial-data` | User mutation; serialized within the active account generation | Replace aggregate financial cache with response |
| Planning category changes | `PATCH /api/financial-data/planning-categories/:category` | User mutation; serialized | Replace aggregate financial cache with response |
| Clear financial data | `DELETE /api/financial-data` | User mutation; serialized | Replace aggregate financial cache with response |
| Customer advice overview | `["/api/advice"]` | Enabled only for an authenticated customer; normal private-query freshness | Create/payment responses are full overviews and update this exact cache |
| Admin advice dashboard | `["/api/admin/advice"]` | Admin panel mount/focus after normal freshness window | Settings response patches settings; advisor responses insert/replace advisor; request response replaces request |
| Admin login activity | Generated key including page and page size | Page/filter change or explicit retry | Read-only; no client mutation reconciliation |
| Backup export | Imperative `GET /api/financial-data` | Explicit user export action | Deliberately bypasses query freshness so the downloaded backup reflects server-authoritative persisted data |

## Identity and failure rules

- Authentication identity changes remove financial, customer-advice, and admin
  query entries before the next account renders.
- Advice and admin mutation callbacks capture that identity generation and may
  publish only while it remains current, preventing late old-account responses
  from recreating removed private cache entries.
- The generation-aware financial write queue separately rejects any old-account
  completion, so an in-flight response cannot repopulate the new account.
- Financial reads use that boundary too; an imperative backup export cannot
  receive or download a response started under the previous account.
- Full-document replacements (including backup restore) use the same serialized
  queue as incremental financial updates, category changes, and clear.
- Failed mutations leave current cache data intact (optimistic UI preferences
  roll back only when the same account and write generation are still visible).
- Private inactive data is garbage-collected after five minutes.

## Baseline and resulting request counts

- Multiple simultaneous domain consumers previously shared one in-flight GET,
  but the default zero stale time allowed remount and focus GETs. They now share
  one GET and reuse it for the explicit 60-second window.
- The budgets page previously declared an additional aggregate observer solely
  for archived categories. It now reuses the UI-preferences selector.
- Financial writes already returned and published the complete document, so
  successful writes remain zero-follow-up-GET operations.
- Clear now returns the canonical empty document built from the authenticated
  user and known clear result, eliminating the former user re-read and aggregate
  reload after its atomic delete.
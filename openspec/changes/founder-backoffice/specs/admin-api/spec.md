# Admin API Specification

## Purpose

Director-only REST API providing cross-org data access for the founder back-office.
Covers role enforcement, org listing, org detail, SDR funnel, and create-client endpoint.
Slice 2 of the `founder-backoffice` epic.

## Requirements

### Requirement: Role Guard Middleware

The system MUST enforce `rol === 'director'` on every `/api/admin/*` route via a dedicated
`roleGuard` middleware. Any request with a valid JWT but a non-director role MUST receive
HTTP 403. Any request without a valid JWT MUST receive HTTP 401 (rejected by `authMiddleware`
before reaching `roleGuard`). The guard MUST be fail-closed: on any error resolving the role,
it MUST deny access.

#### Scenario: Director JWT accepted

- GIVEN a valid JWT with `rol = "director"`
- WHEN a request is made to any `/api/admin/*` route
- THEN the request proceeds to the route handler

#### Scenario: Non-director JWT rejected

- GIVEN a valid JWT with `rol = "admin_org"`
- WHEN a request is made to any `/api/admin/*` route
- THEN the system returns HTTP 403

#### Scenario: Missing JWT rejected

- GIVEN no Authorization header
- WHEN a request is made to any `/api/admin/*` route
- THEN `authMiddleware` returns HTTP 401 before `roleGuard` is reached

#### Scenario: Invalid JWT rejected

- GIVEN an expired or malformed Bearer token
- WHEN a request is made to any `/api/admin/*` route
- THEN the system returns HTTP 401

---

### Requirement: Admin Router Mounted Without planGuard

The `/api/admin/*` router MUST be mounted in `src/index.ts` after `authMiddleware` and
`roleGuard` but WITHOUT `planGuard`. `planGuard` checks the director's own org billing
status, which is irrelevant when the director is querying client orgs. Placing `planGuard`
before the admin router would block all director access.

#### Scenario: Director with expired trial is not blocked

- GIVEN a director JWT regardless of any org's `subscription_status`
- WHEN a request is made to `GET /api/admin/orgs`
- THEN the system returns the org list without a 402/403 from planGuard

---

### Requirement: Service-Role Client for Cross-Org Queries

Admin route handlers MUST use the `SUPABASE_SERVICE_ROLE_KEY` client (service_role) for
queries against `organizaciones`, `usuarios`, `fincas`, `costo_servicio_mensual`, and
`sdr_prospectos`. RLS scopes data to the authenticated user's own org; service_role bypasses
RLS to allow cross-org director reads. The service_role client MUST NOT be exposed to or
reused from any non-director-authenticated route handler.

#### Scenario: Cross-org org list returned

- GIVEN two orgs provisioned in the database
- WHEN the director calls `GET /api/admin/orgs`
- THEN both orgs appear in the response regardless of their org_id

---

### Requirement: GET /api/admin/orgs — Org List

The system MUST return a list of all organizations with the following fields per entry:
`org_id`, `nombre`, `plan`, `subscription_status`, `trial_inicio`, `trial_fin`,
`fincas_count` (count of associated `fincas`), `usuarios_count`, `precio_mensual`,
`fincas_contratadas`, `usuarios_contratados`.

Note: `costo_ultimo_mes` (last month's cost from `costo_servicio_mensual`) is deferred to
S5 — the S2 response omits it.

#### Scenario: Happy path

- GIVEN at least one org exists
- WHEN director calls `GET /api/admin/orgs`
- THEN the response is HTTP 200 with an array containing each org's summary

#### Scenario: Empty database

- GIVEN no orgs exist
- WHEN director calls `GET /api/admin/orgs`
- THEN the response is HTTP 200 with an empty array

---

### Requirement: GET /api/admin/orgs/:id — Org Detail

The system MUST return a SAFE allowlist of fields from `organizaciones` — `org_id`, `nombre`,
`plan`, `subscription_status`, `trial_inicio`, `trial_fin`, `fincas_contratadas`,
`usuarios_contratados`, `precio_mensual` — NEVER any payment token, card, or customer-id
column (`dlocalgo_checkout_token`, `dlocalgo_payment_id`, `dlocal_card_id`,
`dlocal_payment_id`, `stripe_customer_id`, `stripe_subscription_id`, `metodo_pago`, or any
other `*_token`/`*_card_id`/`*_payment_id` column). The response also includes list of
`fincas` (finca_id, nombre, cultivo_principal, config) and list of `usuarios` (id, nombre,
rol, phone — masked last-4, per P5/D31). If the org does not exist, the system MUST return
HTTP 404. If the org lookup query itself fails, the system MUST return HTTP 500 (never
conflated with 404).

Note: billing history from `costo_servicio_mensual` (`costo_ultimo_mes` and 6-month history)
is deferred to S5 — the S2 response omits it.

#### Scenario: Existing org

- GIVEN an org with `org_id = "ORG001"`
- WHEN director calls `GET /api/admin/orgs/ORG001`
- THEN the response is HTTP 200 with all org fields plus fincas, usuarios, and billing history

#### Scenario: Non-existent org

- GIVEN no org with `org_id = "ORG999"`
- WHEN director calls `GET /api/admin/orgs/ORG999`
- THEN the response is HTTP 404

---

### Requirement: GET /api/admin/sdr — SDR Funnel Snapshot

The system MUST return all rows from `sdr_prospectos` ordered by `created_at` descending,
including at minimum: `id`, `nombre`, `phone` (masked last-4 in the response, per P5/D31 —
the director sees the masked value, not the raw phone), `estado`, `turns_total`,
`calcom_booking_id`, `created_at`. Response is HTTP 200. Empty result returns an empty array.

Note: `updated_at` is deferred to S5 — the S2 response omits it.

#### Scenario: Active prospects returned

- GIVEN 3 rows in `sdr_prospectos`
- WHEN director calls `GET /api/admin/sdr`
- THEN the response contains all 3 rows ordered by `created_at` desc

---

### Requirement: POST /api/admin/clients — Create Client (UI trigger)

The system MUST expose a create-client endpoint that accepts the same input as
`POST /internal/provision-client` and delegates exclusively to `provisionarCliente()`
(no duplicate provisioning logic — P1). The endpoint MUST require `roleGuard`. On success
it MUST return the provisioning result as `{ org_id, usuario_id, ya_existia }` (snake_case,
matching the sibling `/internal/provision-client` handler). On duplicate phone it MUST
return HTTP 200 with `ya_existia: true` (idempotent no-op — `provisionarCliente()` is
idempotent by `phone`, D33). On missing required fields it MUST return HTTP 400.

#### Scenario: Valid new client provisioned

- GIVEN a director JWT and a valid payload with phone, nombre_org, cultivo_principal
- WHEN director calls `POST /api/admin/clients`
- THEN `provisionarCliente()` is called, the org and user are created, and HTTP 201 is returned

#### Scenario: Duplicate phone is an idempotent no-op

- GIVEN a phone already registered in `usuarios`
- WHEN director calls `POST /api/admin/clients` with the same phone
- THEN the system returns HTTP 200 with `ya_existia: true`, without creating a duplicate

#### Scenario: Missing required fields

- GIVEN a payload missing `nombre_org`
- WHEN director calls `POST /api/admin/clients`
- THEN the system returns HTTP 400 with a field-level error

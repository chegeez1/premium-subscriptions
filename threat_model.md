# Threat Model

## Project Overview

This repository is a pnpm monorepo with one production HTTP backend in `artifacts/api-server` and several Vite frontends/static artifacts. The backend is an Express 5 API backed by PostgreSQL through Drizzle ORM. It serves a link-shortener API and redirect endpoint, exposes several "tools" endpoints, and provides text-to-speech endpoints backed by the OpenAI integration in `lib/integrations-openai-ai-server`.

Production-scope assumptions for this scan:
- Only vulnerabilities reachable in production are in scope.
- `NODE_ENV` is `production` in deployed environments.
- Platform TLS is handled by Replit and is not analyzed here.
- `artifacts/mockup-sandbox` is development-only unless future evidence shows production reachability.

## Assets

- **Link records and analytics** — short-link destinations, slugs, click counts, and creation timestamps stored in `links` can reveal business data and user-shared destinations. Unauthorized reads or deletes would directly impact availability and confidentiality.
- **Application-side credentials and paid integrations** — the API server holds database access and OpenAI integration credentials. Any unauthenticated route that can trigger expensive integration calls or expose integration-backed data creates financial and operational risk.
- **User-submitted sensitive content** — the tools routes accept payment-card-like input and the TTS routes accept arbitrary text. This data must not be exposed, retained, or forwarded more broadly than intended.
- **Service availability** — the API can trigger outbound network requests and AI generation. Unbounded public access can convert those capabilities into cost-amplification or denial-of-service primitives.

## Trust Boundaries

- **Browser to API boundary** — all frontend requests cross into the Express API. The browser is untrusted; all authorization, validation, and rate limiting must be enforced server-side.
- **API to PostgreSQL boundary** — the API has direct read/write access to the `links` table. Missing authorization on API routes becomes direct database tampering or disclosure.
- **API to external service boundary** — `routes/tools.ts` calls external BIN services and `routes/tts.ts` calls OpenAI through server-held credentials. Public routes that trigger those calls can leak submitted data or create cost-abuse paths.
- **Public vs privileged boundary** — the frontend contains an `/admin` route, but the server currently exposes the corresponding capabilities without server-side authentication. Any privileged function must be enforced on the backend, not just labeled in the UI.
- **Production vs dev-only boundary** — `artifacts/mockup-sandbox` is treated as dev-only and excluded from production findings unless future scans prove it is deployed.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/**`
- **Highest-risk areas:** `artifacts/api-server/src/routes/links.ts`, `artifacts/api-server/src/routes/tools.ts`, `artifacts/api-server/src/routes/tts.ts`, `lib/integrations-openai-ai-server/src/audio/client.ts`
- **Public surfaces:** `/r/:slug`, `/api/healthz`, `/api/links*`, `/api/tools/*`, `/api/tts*`
- **Client-only or dev-only surfaces usually skipped:** `artifacts/mockup-sandbox/**`; static Vite frontends unless they reveal assumptions about backend trust boundaries

## Threat Categories

### Spoofing

This project currently has no server-side identity boundary around link-management, card-tooling, or TTS routes. If any operation is meant for administrators or trusted users, the API MUST require a validated identity and MUST enforce that identity on the server before performing the action.

### Tampering

The API writes directly to the `links` table and performs destructive actions such as link deletion. All state-changing routes MUST enforce server-side authorization, and any privileged management action exposed through the frontend MUST be backed by matching backend checks.

### Information Disclosure

The application accepts and processes sensitive user-supplied content, including short-link destinations, analytics, arbitrary TTS text, and payment-card-like inputs. API responses, logs, storage, and third-party calls MUST minimize exposed data; sensitive request content MUST NOT be echoed or forwarded to third parties unless that behavior is explicitly required and access-controlled.

### Denial of Service

The API can trigger outbound BIN lookups and OpenAI TTS generation using server-side credentials. Public endpoints MUST bound request sizes, concurrency, and background work, and high-cost routes MUST have authentication and/or rate limiting so attackers cannot convert them into cost-amplification or service-exhaustion primitives.

### Elevation of Privilege

The main privilege-escalation risk in this codebase is backend trust in frontend labeling. Routes presented as admin or tooling features MUST not be reachable solely because a client knows the URL. The server MUST enforce role or capability checks before exposing analytics, deletion, payment-card tooling, or other sensitive operations.
# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Voice Cloning (Pending)

- ElevenLabs integration (`connector:ccfg_elevenlabs_01KG0GEQNFW9Z6F2NYP4C2VHM9`) was dismissed by the user.
- To enable voice cloning: either complete the ElevenLabs OAuth flow via the Replit integrations panel, OR provide an ElevenLabs API key as the `ELEVENLABS_API_KEY` secret.
- The voice cloning feature uploads a short voice sample, creates a cloned voice on ElevenLabs, then uses it for all TTS narration across the video scenes (replacing OpenAI voices).

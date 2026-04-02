# ChatBridge (Chatbox Fork)

AI chat platform with third-party app integration, built on top of the Chatbox open-source project.

## Project Overview

- **Product**: ChatBridge — extends Chatbox with a plugin system for third-party apps (Chess, Weather, GitHub)
- **Context**: Gauntlet AI Week 7 project, building for the TutorMeAI case study (K-12 education platform)
- **Repo**: Forked from Chatbox, push to GitLab

## Tech Stack

- **Frontend**: React 18 + TypeScript 5.8 + Mantine 7 + Tailwind CSS 3
- **State**: Zustand 5 + Jotai 2 + TanStack React Query 5
- **Routing**: TanStack React Router (file-based)
- **AI**: Vercel AI SDK v6 with multi-provider support (OpenAI, Claude, Gemini, etc.)
- **Tools**: MCP (Model Context Protocol) for tool discovery and invocation
- **Build**: electron-vite + Vite 7, pnpm
- **Platforms**: Electron (desktop), Capacitor (mobile), Web
- **Linting**: Biome 2.0 (formatter + linter), indent: 2 spaces, LF line endings, 120 char line width
- **Testing**: Vitest 4

## Key Directories

```
src/
  main/           # Electron main process (IPC, MCP server host, file parsing)
  renderer/       # React UI application
    components/   # UI components (chat/, InputBox/, ModelSelector/, etc.)
    hooks/        # Custom React hooks
    packages/     # Core logic (model-calls/, mcp/, token-estimation/, web-search/)
    routes/       # File-based routes (TanStack Router)
    stores/       # Zustand stores + Jotai atoms
    storage/      # Persistence layer (electron-store / IndexedDB)
    i18n/         # Internationalization (13+ languages)
  shared/         # Shared types, models, providers, constants
    providers/    # AI provider definitions and registry
    types/        # Zod schemas for sessions, messages, settings
  preload/        # Electron preload scripts
```

## Common Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (Electron)
pnpm build            # Production build
pnpm test             # Run tests (Vitest)
pnpm lint             # Biome lint
pnpm format           # Biome format
```

## Architecture Notes

- Chat messages use a rich parts system (text, images, tool calls, reasoning, info blocks)
- MCP handles tool schemas, discovery, and invocation — plugin system should extend this
- Sessions stored with compaction points for context window management
- Provider system is abstracted via `AbstractAISdkModel` wrapping Vercel AI SDK
- Storage uses `StoreStorage` abstraction (electron-store on desktop, IndexedDB on web)

## ChatBridge Plugin System (In Progress)

- **Apps**: Chess (required), Weather (public API), GitHub (OAuth)
- **Architecture**: Hybrid — MCP for tool discovery/invocation, custom iframe + postMessage for UI embedding and app lifecycle
- **Auth patterns**: Internal (Chess), External Public (Weather API key), External OAuth (GitHub)
- **Design spec**: See `docs/superpowers/specs/` once written

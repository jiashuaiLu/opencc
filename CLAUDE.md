# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DongCC is an Electron-based macOS desktop application for managing and monitoring a Claude Code proxy service. It provides a GUI to configure proxy settings, view logs, monitor token usage, manage conversation history, and handle MCP servers and Skills.

## Build Commands

```bash
# Development
npm run dev              # Start Vite dev server only (port 5173)
npm run electron:dev     # Start Electron in development mode (Vite + Electron)

# Build
npm run build            # Build both main process (tsc) and renderer (vite)
npm run build:main       # Build main process TypeScript -> dist/main/
npm run build:renderer   # Build renderer React -> dist/renderer/

# Production Package
npm run electron:build   # Build and package with electron-builder -> release/

# Code Quality
npm run lint             # Run ESLint on src/
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format with Prettier
```

## Architecture

### Electron Process Model

- **Main Process** (`src/main/index.ts`): Entry point, creates BrowserWindow, initializes database and proxy server, sets up IPC handlers
- **Renderer Process** (`src/renderer/`): React application with Ant Design UI
- **Preload Script** (`src/main/preload.ts`): Exposes `electronAPI` to renderer via contextBridge

### Key Components

**Proxy Server** (`src/main/proxy/server.ts`):
- Express server that translates Claude API format to OpenAI-compatible format
- Handles streaming and non-streaming responses
- Emits events: `request`, `error`, `conversation` for database logging

**Database** (`src/main/database/index.ts`):
- Simple JSON file-based storage at `~/.dongcc/data/dongcc.json`
- Stores configs, logs, requests, conversations, settings, MCP servers, skills
- Supports usage statistics: summary, trends, model stats, request logs
- Auto-migration for schema changes (MCP servers, skills format)

**IPC Handlers** (`src/main/ipc/handlers.ts`):
- Bridges renderer and main process
- Handles: config CRUD, service start/stop, logs, stats, conversations, settings
- Usage stats: `usage:summary`, `usage:trends`, `usage:modelStats`, `usage:logs`
- MCP: `mcp:list`, `mcp:save`, `mcp:delete`, `mcp:toggle`
- Skills: `skills:list`, `skills:save`, `skills:delete`, `skills:toggle`

**System Checker** (`src/main/system/checker.ts`):
- Checks Claude Code installation, Node.js version, port availability
- Auto-configures Claude settings at `~/.claude/settings.json`
- Backs up and restores original Claude config on service stop

**MCP Service** (`src/main/mcp/mcpService.ts`):
- Manages MCP (Model Context Protocol) server configurations
- Syncs enabled MCP servers to `~/.claude/settings.json`
- Provides preset MCP servers (fetch, time, memory, sequential-thinking, etc.)
- Supports both stdio and HTTP transport types

**Skills Service** (`src/main/skills/skillService.ts`):
- Manages skill installations from Git repositories
- Supports global and project-specific skills
- Syncs enabled skills to Claude settings
- Discovers skills from configured Git repositories (default: anthropics/skills, ComposioHQ/awesome-claude-skills)

**Cost Calculator** (`src/main/cost/calculator.ts`):
- Calculates API costs based on token usage and model pricing
- Maintains default pricing for various Claude and GPT models

**Data Exporter** (`src/main/export/dataExporter.ts`):
- Exports usage data and conversation history to various formats

### Frontend Pages

- `Dashboard.tsx`: Service status, usage summary cards, trend charts, request logs, model stats
- `Config.tsx`: Proxy configuration management
- `Logs.tsx`: Real-time log viewer
- `History.tsx`: Conversation history
- `McpManagement.tsx`: MCP server management (add/edit/delete/toggle)
- `SkillManagement.tsx`: Skills management (install/delete/toggle from Git repos)
- `Settings.tsx`: Application settings
- `ThemeSettings.tsx`: Theme customization
- `Documentation.tsx`: Usage documentation
- `Info.tsx`: Environment check and system info

### Frontend Components

Dashboard components (`src/renderer/components/dashboard/`):
- `UsageSummaryCards.tsx`: Service status and key metrics cards
- `UsageTrendChart.tsx`: Token and request trend charts (recharts)
- `RequestLogTable.tsx`: Paginated request log table with filters
- `ModelStatsTable.tsx`: Model usage statistics table

### TypeScript Path Aliases

Configured in `tsconfig.json`:
- `@/*` -> `src/*`
- `@main/*` -> `src/main/*`
- `@renderer/*` -> `src/renderer/*`
- `@shared/*` -> `src/shared/*`

## Configuration Files

- `tsconfig.json`: Main TypeScript config (renderer + shared)
- `tsconfig.main.json`: Main process TypeScript config (extends tsconfig.json)
- `vite.config.ts`: Vite build for renderer process
- `.eslintrc.json`: ESLint rules
- `.prettierrc`: Prettier formatting rules

## Data Storage

Application data stored in user home directory:
- Database: `~/.dongcc/data/dongcc.json`
- Logs: `~/.dongcc/logs/combined.log` and `~/.dongcc/logs/error.log`
- Skills: `~/.dongcc/skills/` (cloned Git repositories)
- Skill repos config: `~/.dongcc/skill-repos.json`
- Claude settings: `~/.claude/settings.json` (modified by SystemChecker)
- Claude projects: `~/.claude/projects/` (scanned for project-specific skills)

## Environment Requirements

- **Node.js**: v16.0.0 or higher
- **macOS**: 10.15 (Catalina) or higher
- **Claude Code**: Must be installed
- **Shell environment**: The app reads PATH from user's shell (zsh/bash) to find executables like `npx`, `uvx` for MCP servers

## Proxy Flow

1. User configures API key, base URL, port in Config page
2. On service start:
   - SystemChecker backs up and modifies Claude settings at `~/.claude/settings.json`
   - Enabled MCP servers are synced to Claude settings
   - Enabled skills are synced to Claude settings
   - Proxy server starts on configured port
3. Claude Code reads settings, routes requests through proxy
4. Proxy translates Claude API format to OpenAI format:
   - Converts Claude messages to OpenAI messages
   - Handles tool calls and multi-modal content (images)
   - Transforms streaming responses (SSE format)
   - Supports model replacement via defaultModel config
5. Response is translated back and logged to database with token usage
6. On service stop, original Claude config is restored

## Key Dependencies

- **UI Framework**: React 18 + Ant Design
- **Charts**: recharts (for usage trends)
- **Animations**: framer-motion
- **State Management**: Zustand
- **Routing**: React Router
- **Database**: JSON file-based (lowdb pattern)
- **Logging**: Winston
- **Desktop**: Electron 33
- **Build Tools**: Vite, TypeScript, electron-builder

## IPC API Reference

Main IPC channels exposed to renderer via `electronAPI`:

**Config Management**:
- `config:get`, `config:save`, `config:list`, `config:delete`

**Service Control**:
- `service:start`, `service:stop`, `service:status`

**Usage Statistics**:
- `usage:summary`, `usage:trends`, `usage:modelStats`, `usage:logs`
- `stats:get` (legacy)

**MCP Management**:
- `mcp:list`, `mcp:save`, `mcp:delete`, `mcp:toggleApp`
- `mcp:getPresets`, `mcp:importFromClaude`

**Skills Management**:
- `skills:list`, `skills:save`, `skills:delete`, `skills:toggleApp`
- `skills:scanUnmanaged`, `skills:import`, `skills:importMultiple`, `skills:importFromPath`
- `skills:listProjects`, `skills:scanCustomProject`, `skills:getDirectory`
- `skills:getRepos`, `skills:saveRepo`, `skills:deleteRepo`

**Conversations**:
- `conversations:get`, `conversations:delete`

**Settings & Logs**:
- `settings:get`, `settings:save`, `settings:reset`
- `logs:get`, `logs:clear`
- `cache:clear`

**Cost Calculator**:
- `cost:calculate`, `cost:pricing`, `cost:estimateMonthly`

**Data Export**:
- `export:csv`, `export:excel`, `export:json`

**System**:
- `openExternal`, `openInFinder`

## Important Implementation Details

**Proxy Server Model Mapping**:
- Config can specify a `defaultModel` and `models` array
- When `defaultModel` is set, all incoming requests have their model replaced with the mapped `modelId`
- This allows using custom model names while targeting specific model IDs

**Streaming Response Handling**:
- OpenAI streaming responses are converted to Claude SSE format in real-time
- Tool calls are tracked and mapped between OpenAI and Claude formats
- Usage statistics (tokens) are extracted from the final streaming chunk when `stream_options.include_usage: true`

**Database Migration**:
- Database includes auto-migration logic for schema changes
- Current migrations: MCP server format (command -> server object), skills format (content -> directory), sourceType addition

**MCP Server Configuration**:
- MCP servers can be stdio or HTTP based
- Claude settings are updated with mcpServers configuration
- Servers are toggled per-app (currently supports 'claude' app)

**Skills Installation**:
- Skills are cloned from Git repositories to `~/.dongcc/skills/`
- Metadata is extracted from skill's CLAUDE.md or README.md
- Both global and project-specific skills are supported

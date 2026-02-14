# Score Slinger

## Overview

Score Slinger is a mobile app that uses AI-powered image recognition to parse scoreboards from theme park ride games (like Marvel's Web Slingers). Users take a photo of a game scoreboard, and the app uses OpenAI's vision model to extract team scores, individual player scores, and objective scores from the image.

The project uses an Expo React Native frontend with an Express.js backend, connected to a PostgreSQL database via Drizzle ORM. The AI integration uses OpenAI's API (through Replit's AI Integrations proxy) for image analysis.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (Expo / React Native)
- **Framework**: Expo SDK 54 with React Native 0.81, using expo-router for file-based routing
- **Routing**: File-based routing via `expo-router` — screens live in the `app/` directory. Currently a single-screen app (`app/index.tsx`) with a Stack navigator
- **State Management**: TanStack React Query for server state; local component state with React hooks and AsyncStorage for persistence (date format, sort preference)
- **Settings Module**: Accessible via gear icon on main screen. Supports date format selection (10 formats), default sort order, and export scores (placeholder)
- **Styling**: Dark theme throughout with custom color constants in `constants/colors.ts`. Uses DM Sans font family loaded via `@expo-google-fonts`
- **Animations**: `react-native-reanimated` for animations, `expo-haptics` for tactile feedback
- **Image Handling**: `expo-image-picker` for camera/gallery access, `expo-image` for display
- **API Communication**: Custom `getApiUrl()` helper in `lib/query-client.ts` constructs the API base URL from `EXPO_PUBLIC_DOMAIN` environment variable. Uses `expo/fetch` for requests

### Backend (Express.js)
- **Framework**: Express 5 running on Node.js, entry point at `server/index.ts`
- **Core API Route**: `POST /api/parse-score` — accepts an image upload via `multer` (memory storage, 10MB limit), converts to base64, sends to OpenAI's vision model to extract scoreboard data
- **AI Integration**: OpenAI client configured with Replit-specific env vars (`AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`). Uses `gpt-5-mini` model with structured JSON output for score parsing
- **CORS**: Dynamic CORS setup allowing Replit dev/deployment domains and localhost origins
- **Static Serving**: In production, serves pre-built Expo web assets; in development, proxies to the Expo dev server via `http-proxy-middleware`
- **Build**: Server bundles via `esbuild` to `server_dist/` for production

### Replit Integration Modules (`server/replit_integrations/`)
Pre-built integration modules exist but are supplementary to the core app:
- **chat/**: Conversation and message CRUD with OpenAI streaming chat
- **audio/**: Voice recording, speech-to-text, text-to-speech capabilities
- **image/**: Image generation via `gpt-image-1`
- **batch/**: Rate-limited batch processing utilities with retry logic (`p-limit`, `p-retry`)

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM. Schema defined in `shared/schema.ts`
- **Current Schema**: `users` table (id, username, password) and chat-related tables (`conversations`, `messages`) in `shared/models/chat.ts`
- **In-Memory Fallback**: `server/storage.ts` implements `MemStorage` class for user operations — currently used instead of database for user storage
- **Drizzle Config**: `drizzle.config.ts` points to `DATABASE_URL` env var; migrations output to `./migrations`
- **Client-Side Storage**: `AsyncStorage` used for local persistence of scan history

### Build & Deployment
- **Development**: Two processes — `expo:dev` for the mobile/web client, `server:dev` for the Express API
- **Production Build**: `expo:static:build` creates static web assets via a custom `scripts/build.js`, `server:build` bundles the server with esbuild
- **Production Run**: `server:prod` serves both the static Expo web build and the API

### Key Design Decisions
- **Monorepo Structure**: Frontend and backend share code through `shared/` directory (schema, types)
- **Path Aliases**: `@/*` maps to project root, `@shared/*` maps to `shared/` directory
- **Dark-First UI**: The app uses `userInterfaceStyle: "dark"` with a space-themed color palette (dark blues, cyan accents)
- **Portrait Lock**: App is locked to portrait orientation

## External Dependencies

### Required Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (required for Drizzle/database operations)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (via Replit AI Integrations)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL (via Replit AI Integrations proxy)
- `EXPO_PUBLIC_DOMAIN` — Public domain for API URL construction (set automatically on Replit)
- `REPLIT_DEV_DOMAIN` — Replit dev domain (set automatically)

### Third-Party Services
- **OpenAI API**: Vision model for scoreboard image parsing; chat completions for conversation features; image generation; speech-to-text and text-to-speech
- **PostgreSQL**: Primary database, provisioned through Replit

### Key NPM Packages
- `expo` (SDK 54), `expo-router`, `react-native` — Mobile/web framework
- `express` (v5) — Backend server
- `drizzle-orm`, `drizzle-kit`, `drizzle-zod` — Database ORM and schema validation
- `openai` — OpenAI SDK
- `@tanstack/react-query` — Data fetching/caching
- `multer` — File upload handling
- `react-native-reanimated` — Animations
- `expo-image-picker` — Camera/gallery access
- `p-limit`, `p-retry` — Rate limiting and retry logic for batch operations
# Manim Agent

Chat-first playground that turns natural language prompts into runnable [Manim](https://www.manim.community/) animations. The app pairs an AI “director” (built with LangGraph + OpenAI) with an isolated Docker tool that executes the generated Python, then streams back the code and rendered video in real time.

## Features
- Chat interface powered by `@assistant-ui/react` with starter prompts to explore Manim quickly.
- LangGraph agent (`gpt-5.2`) that writes Manim scenes and can call a Docker tool to execute them.
- Live SSE streaming: incremental text, tool-call args (`code`), status notifications, and the final video URL.
- Side-by-side panes for generated Python (syntax highlighted via Shiki) and the rendered MP4 player.
- Safe execution: Manim code runs inside `manimcommunity/manim:stable` with outputs kept under `tmp/manim-executions/` and served through a signed route.

## Prerequisites
- Node 20+ (the project is wired for Bun; npm/pnpm/yarn also work).
- Docker available locally (the tool pulls `manimcommunity/manim:stable`).
- OpenAI API access.

## Quickstart
1. Clone the repo  
   ```bash
   git clone https://github.com/gajananpp/manim-agent.git
   cd manim-agent
   ```
2. Create environment file  
   ```bash
   cp env.local.example .env.local
   # set OPENAI_API_KEY and NEXT_PUBLIC_APP_URL (e.g., http://localhost:3000)
   ```
3. Install dependencies  
   ```bash
   bun install          # or npm install / pnpm install / yarn
   ```
4. (One time) pull the Manim Docker image  
   ```bash
   docker pull manimcommunity/manim:stable
   ```
5. Run the dev server  
   ```bash
   bun dev              # or npm run dev
   ```
6. Open http://localhost:3000 and start chatting. The right column will stream Python as it’s generated and autoplay the resulting video once the Docker run completes.

## How it works
- **Agent & tools**: `agents/executor/chain.ts` defines the Manim-focused system prompt and binds `execute_code` as a tool. `agents/executor/agent.ts` builds a LangGraph state machine that loops between the model and tools until tool calls are done.
- **Execution sandbox**: `agents/executor/tools/execute-code.ts` writes the generated scene to `tmp/manim-executions/<id>/scene.py`, runs it in `manimcommunity/manim:stable` via dockerode, and streams status updates plus a `video-url` SSE event. Videos are served by `app/api/videos/[executionId]/[filename]/route.ts`.
- **Streaming API**: `app/api/v1/messages/route.ts` accepts a chat transcript, invokes the agent, and emits Server-Sent Events (`text-delta`, `tool-call-arg-delta`, `code`, `video-url`, `message`, `done`, `error`). The frontend consumes these to keep the chat, code pane, and video pane in sync.
- **UI**: `app/page.tsx` mounts `components/thread-wrapper.tsx`, which wires `@assistant-ui/react` to the streaming API. `ManimCodeDisplay` and `ManimVideoDisplay` subscribe to global stream state to show live code and playback.

## Environment variables
| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI key used by the LangGraph agent. |
| `NEXT_PUBLIC_APP_URL` | Public base URL used to build video links (e.g., `http://localhost:3000`). |

## Project scripts
| Script | Description |
| --- | --- |
| `bun dev` | Start Next.js dev server with Bun (`npm run dev` also works). |
| `bun run build` | Build for production. |
| `bun run start` | Start the production build. |
| `bun run lint` | Run ESLint. |

## Development notes
- Docker must be running and able to pull `manimcommunity/manim:stable` on first execution.
- Outputs accumulate in `tmp/manim-executions/`; feel free to clean this directory if it grows.
- The agent streams partial tool-call args; the frontend uses best-effort parsing to keep the code pane updated even before the tool finishes.

## Folder map (high level)
- `agents/executor/` — LangGraph agent, system prompt, and Docker-backed tool.
- `app/api/` — API routes: SSE chat (`v1/messages`) and video serving.
- `components/` — Assistant UI thread, code display, video display, and UI primitives.
- `docs/` — Notes and scratch docs for various stacks (Bun, LangGraph, Qdrant, etc.).

## Contributing
Issues and PRs are welcome. Please run `bun run lint` before submitting changes. If you add new agent behavior or tools, document the flow briefly in this README or the `/docs` folder.

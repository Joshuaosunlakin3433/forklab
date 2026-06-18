# forklab — AI Research Lab Notebook

A Next.js (App Router + TypeScript + Tailwind) app built on the **MemForks SDK**
(Git-for-AI-memory on Sui / Walrus) and **LangGraph**. This is the project
skeleton: a MemForks client wrapper, a provider-swappable model factory, and a
health-check route that proves the stack is wired. Branching, agents, the
LangGraph graph, and UI are not built yet.

> Built with the latest stable Next.js 16.x (resolved by `create-next-app@latest`).

## Setup

1. **Install dependencies** (already installed if you cloned a ready tree):

   ```bash
   npm install
   ```

2. **Configure environment.** Copy the example file and fill in real values:

   ```bash
   cp .env.example .env.local
   ```

   `.env.local` is gitignored; `.env.example` documents every variable and is
   committed. Never hardcode secrets in source.

### Required environment variables

| Variable                 | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `MEMFORK_TREE_ID`        | Object ID of your MemoryTree.                                      |
| `MEMFORK_PRIVATE_KEY`    | Sui signer private key (`suiprivkey...`).                          |
| `MEMFORK_MEMWAL_ACCOUNT` | MemWal account id (off-chain blob storage).                       |
| `MEMFORK_MEMWAL_KEY`     | MemWal delegate key.                                               |
| `MEMFORK_NETWORK`        | `mainnet` \| `testnet` \| `devnet` \| `localnet` (default mainnet).|
| `MEMFORK_RELAYER_URL`    | MemWal relayer endpoint (maps to `memwal.serverUrl`).             |
| `MODEL_PROVIDER`         | `groq` \| `gemini` \| `ollama` (only `groq` implemented).          |
| `MODEL_NAME`             | Model id, e.g. `llama-3.3-70b-versatile` (a live Groq model).      |
| `GROQ_API_KEY`           | Groq API key (OpenAI-compatible endpoint).                        |
| `GEMINI_API_KEY`         | Optional fallback — leave blank for now.                          |

## Verify the stack: `/api/health`

Start the dev server and hit the health route. It performs three independent,
separately-reported steps — **commit** a fact, **recall** it back as clean text,
and call the **model** — all without any on-chain branch operations (commit and
recall are off-chain MemWal ops).

```bash
npm run dev
curl http://localhost:3000/api/health
```

Expected (with valid credentials):

```json
{
  "memfork": "ok",
  "recall": ["healthcheck: the sky is green"],
  "model": "ok"
}
```

Each step is wrapped in its own `try/catch`, so if one layer is misconfigured
(e.g. a bad `GROQ_API_KEY`) the field for that step holds the error message
while the others still report their results — making the failing layer obvious.

## Project structure (this step)

- [src/lib/memfork.ts](src/lib/memfork.ts) — singleton MemForks client +
  `commitFacts` / `recallFacts` (with `extractFactText` to return clean fact
  strings, never raw JSON).
- [src/lib/model.ts](src/lib/model.ts) — `getModel()`, a provider-swappable
  chat-model factory selected by `MODEL_PROVIDER`.
- [src/app/api/health/route.ts](src/app/api/health/route.ts) — the health check.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

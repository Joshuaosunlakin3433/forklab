/**
 * POST /api/research — run the core divergence flow headlessly.
 *
 * Body: { question: string }
 *
 * Runs the LangGraph divergence graph (seed → readers → critics) and returns
 * each branch's claims as a clean array — one claim per element, containing
 * only the relevant research claims each agent committed this run (no inherited
 * `main`/seed facts; see runDivergence). The branches live under a per-run
 * namespace; `runId` is returned at the top level so they can be located in the
 * MemForks dashboard.
 *
 * Response:
 *   {
 *     question,
 *     runId,
 *     branches: {
 *       "hypothesis/pro": [...],
 *       "hypothesis/con": [...],
 *       "critique/pro":  [...],
 *       "critique/con":  [...]
 *     }
 *   }
 */
import { runDivergence } from "@/lib/graph";
import { corpusSummary } from "@/lib/corpus";
import { mockEnabled, mockResearch } from "@/lib/mockData";

// MemForks uses Node-only APIs (Sui client, crypto) and must hit the services
// on every request rather than be statically prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // DEV-ONLY mock gate — inert unless NODE_ENV !== production AND MOCK_BACKEND=on.
  if (mockEnabled()) return mockResearch(request);

  let question: unknown;
  try {
    ({ question } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json(
      { error: "Body must include a non-empty `question` string" },
      { status: 400 },
    );
  }

  try {
    const { runId, branches } = await runDivergence(question, corpusSummary());

    return Response.json({ question, runId, branches });
  } catch (err) {
    // Surface the real exception in the dev-server terminal, full stack and all.
    console.error("[/api/research] divergence failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return Response.json(
      {
        error: message,
        // Only leak the stack outside production.
        ...(process.env.NODE_ENV !== "production" ? { stack } : {}),
      },
      { status: 500 },
    );
  }
}

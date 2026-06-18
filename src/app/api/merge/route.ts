/**
 * POST /api/merge — reconcile a prior research run into a verdict and prove
 * research/main changed.
 *
 * Body: { runId: string }
 *
 * Recalls the run's four diverged branches, produces a holistic consensus
 * verdict, commits it back into run-<id>/research/main, and returns what
 * research/main knew BEFORE the merge and AFTER (it now contains the verdict).
 *
 * Response:
 *   {
 *     runId,
 *     verdict: { accepted: [...], rejected: [...], netPosition: "..." },
 *     mainBefore: [...],   // research/main pre-merge (seeded question + corpus)
 *     mainAfter:  [...]    // research/main post-merge (now includes the verdict)
 *   }
 */
import { runMerge } from "@/lib/merge";

// MemForks uses Node-only APIs (Sui client, crypto) and must hit the services
// on every request rather than be statically prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let runId: unknown;
  try {
    ({ runId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof runId !== "string" || runId.trim().length === 0) {
    return Response.json(
      { error: "Body must include a non-empty `runId` string" },
      { status: 400 },
    );
  }

  try {
    const { verdict, mainBefore, mainAfter } = await runMerge(runId);
    return Response.json({ runId, verdict, mainBefore, mainAfter });
  } catch (err) {
    // Surface the real exception in the dev-server terminal, full stack and all.
    console.error("[/api/merge] merge failed:", err);
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

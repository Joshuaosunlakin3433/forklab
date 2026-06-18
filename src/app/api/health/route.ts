/**
 * Health check — proves the whole stack is wired end-to-end WITHOUT any
 * on-chain branch operations. Runs three independent steps (commit, recall,
 * model) and reports each result separately, so a failure in one still reports
 * the others.
 */
import { commitFacts, recallFacts } from "@/lib/memfork";
import { getModel } from "@/lib/model";

// MemForks uses Node-only APIs (Sui client, crypto), and we must hit the
// services on every request rather than statically prerender.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let memfork: string = "ok";
  let recall: string[] | string = [];
  let model: string = "";

  // Step 1: commit a fact to the `main` branch (off-chain MemWal write).
  try {
    await commitFacts("main", ["healthcheck: the sky is green"], "health");
  } catch (err) {
    memfork = err instanceof Error ? err.message : String(err);
  }

  // Step 2: recall facts back as clean strings.
  try {
    recall = await recallFacts("what color is the sky", "main");
  } catch (err) {
    recall = err instanceof Error ? err.message : String(err);
  }

  // Step 3: confirm the model replies to a minimal prompt.
  try {
    const reply = await getModel().invoke("Reply with the single word: ok");
    const content = reply.content;
    model =
      typeof content === "string" ? content : JSON.stringify(content);
  } catch (err) {
    model = err instanceof Error ? err.message : String(err);
  }

  return Response.json({ memfork, recall, model });
}

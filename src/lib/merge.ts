/**
 * Merge / consensus engine — reconciles a run's diverged branches into a
 * verdict and commits it back to research/main.
 *
 * Given a runId from a prior /api/research divergence, this reconciles the four
 * opposing branches (hypothesis/pro, hypothesis/con, critique/pro,
 * critique/con) into a single verdict and commits that verdict back into the
 * run's research/main branch, proving research/main demonstrably changed
 * (mainBefore vs mainAfter).
 *
 * Runs as a SINGLE-NODE LangGraph StateGraph. The MemForks checkpointer is OFF
 * by default (MEMFORK_CHECKPOINTER flag) — it writes on its own client that
 * bypasses our MemWal throttle and its burst blew the 30/min cap (429), and a
 * one-shot flow needs no resume. See the compile note below.
 *
 * MemWal budget (all commit/recall go through the throttle in memfork.ts):
 *   recall mainBefore (1) + recall 4 branches (4) + commit verdict (1) +
 *   recall mainAfter (1) = 7 business calls (+1 only if mainAfter retries on
 *   indexing lag). Zero un-throttled checkpoint commits with the flag off.
 *
 * Signatures verified against installed type defs:
 *   @memfork/langgraph@0.1.1 — createMemForksCheckpointer(cfg?)
 *   @memfork/core@0.1.11     — client.commit / recall (via memfork.ts helpers)
 */
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { createMemForksCheckpointer } from "@memfork/langgraph";
import { recallFacts, commitFacts } from "@/lib/memfork";
import { getModel } from "@/lib/model";
import { branchName } from "@/lib/graph";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Verdict {
  accepted: string[];
  rejected: string[];
  netPosition: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// research/main holds very few blobs (seed + the verdict), so any non-empty
// query returns them all — semantic ranking barely matters here.
const MAIN_RECALL_QUERY = "research question consensus verdict findings memory";
// Only used if the seeded question cannot be parsed back (should not happen —
// the seed commits it verbatim; see extractQuestion). We log if we ever hit it.
const FALLBACK_QUERY =
  "small language models long-term memory reliability claims";
// First fact of every verdict commit — used to detect the verdict has indexed.
const VERDICT_MARKER = "VERDICT —";

// ─── State ────────────────────────────────────────────────────────────────────

const lastWriteStringArray = {
  reducer: (_prev: string[], next: string[]) => next,
  default: () => [] as string[],
};

const MergeState = Annotation.Root({
  runId: Annotation<string>,
  verdict: Annotation<Verdict>,
  mainBefore: Annotation<string[]>(lastWriteStringArray),
  mainAfter: Annotation<string[]>(lastWriteStringArray),
  // Whether the verdict's commit-back into research/main actually landed
  // on-chain. The verdict is computed BEFORE the commit, so it exists even when
  // the write fails — these two fields carry that honest signal out of the node.
  committed: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  commitError: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

type MergeStateType = typeof MergeState.State;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten a chat message's content to a plain string. */
function messageText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** True for the stale healthcheck/test commit that `main` carries down forks. */
function isNoise(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("healthcheck") || t.includes("the sky is green");
}

/**
 * Clean recall results. Always drops healthcheck/test noise. When `dropSeed`,
 * also drops the inherited seed echo (the `Research question: …` + corpus blob
 * that every branch inherits from research/main) — used for the FOUR branch
 * recalls so the verdict reasons over real claims only. For research/main
 * itself we pass dropSeed:false: there the seed is main's genuine content (the
 * "before" state), not an echo.
 */
function cleanFacts(facts: string[], opts: { dropSeed: boolean }): string[] {
  return facts.filter((f) => {
    if (f.trim().length === 0) return false;
    if (isNoise(f)) return false;
    if (opts.dropSeed && /research question:/i.test(f)) return false;
    return true;
  });
}

/**
 * Pull the research question back out of research/main's seed blob. The seed
 * node commits it verbatim as `Research question: <q>` (see graph.ts seed
 * node), and extractFactText joins commit facts with \n\n, so the first line of
 * the seed blob is exactly that. Returns null if not found.
 */
function extractQuestion(mainFacts: string[]): string | null {
  for (const f of mainFacts) {
    const m = f.match(/Research question:\s*(.+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * PRIMARY parser: a simple line format that cannot be malformed JSON.
 *   ACCEPTED: <claim — reason>   (zero or more)
 *   REJECTED: <claim — reason>   (zero or more)
 *   NET: <one plain sentence>
 * Pure string splitting — no JSON.parse — which is far more robust to model
 * variation than asking for a JSON object (which the model kept wrapping and
 * malforming). Tolerant of leading list markers and ACCEPT/REJECT without the
 * -ED suffix. Lines after NET: are treated as continuation of the sentence.
 */
function parseVerdictLines(text: string): Verdict {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const netLines: string[] = [];
  let inNet = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;

    const acc = line.match(/^ACCEPT(?:ED)?\s*:\s*(.*)$/i);
    if (acc) {
      inNet = false;
      if (acc[1].trim()) accepted.push(acc[1].trim());
      continue;
    }
    const rej = line.match(/^REJECT(?:ED)?\s*:\s*(.*)$/i);
    if (rej) {
      inNet = false;
      if (rej[1].trim()) rejected.push(rej[1].trim());
      continue;
    }
    const net = line.match(/^NET(?:\s*POSITION)?\s*:\s*(.*)$/i);
    if (net) {
      inNet = true;
      if (net[1].trim()) netLines.push(net[1].trim());
      continue;
    }
    if (inNet) netLines.push(line);
  }

  return { accepted, rejected, netPosition: netLines.join(" ").trim() };
}

/** Strip surrounding quotes/brackets/braces and whitespace from a fragment. */
function unwrap(s: string): string {
  return s
    .trim()
    .replace(/^["'`{[\s]+/, "")
    .replace(/["'`}\]\s]+$/, "")
    .trim();
}

/**
 * Pull `key: [ ... ]` array items out of a JSON-ish blob, even if malformed.
 * Scans EVERY occurrence and keeps the richest one, so a nested blob whose
 * outer `accepted:[]` is empty but inner `accepted:[...]` is populated still
 * recovers the real items (never empty when content exists).
 */
function extractArray(blob: string, key: string): string[] {
  const re = new RegExp(`["']?${key}["']?\\s*:\\s*\\[([\\s\\S]*?)\\]`, "gi");
  let best: string[] = [];
  for (const m of blob.matchAll(re)) {
    const inner = m[1];
    // Prefer quoted items (claims contain commas/em-dashes — don't split blind).
    const quoted = [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((q) => q[1].trim())
      .filter((s) => s.length > 0);
    const items = quoted.length
      ? quoted
      : inner
          .split(/[\n,]/)
          .map((s) => unwrap(s))
          .filter((s) => s.length > 0);
    if (items.length > best.length) best = items;
  }
  return best;
}

/**
 * FALLBACK parser: the model returned a JSON-ish object anyway (possibly nested
 * inside netPosition and/or malformed with unquoted values that JSON.parse
 * rejects). Extract accepted[]/rejected[]/netPosition by tolerant regex rather
 * than JSON.parse, so a bare unquoted netPosition value still recovers.
 */
function extractVerdictByRegex(blob: string): Verdict {
  // Unescape JSON-string escaping first: when the object comes back nested
  // inside a quoted string, the inner keys arrive as \"accepted\" etc., which
  // the extractors can't see past. (\" → ", \n → space.)
  const b = blob.replace(/\\"/g, '"').replace(/\\n/g, " ");
  const accepted = extractArray(b, "accepted");
  const rejected = extractArray(b, "rejected");
  // Take the LAST netPosition (the deepest, in a nested blob) and read to end,
  // then strip any trailing closing braces/brackets/quotes.
  const keys = [...b.matchAll(/["']?netPosition["']?\s*:\s*/gi)];
  const last = keys[keys.length - 1];
  const netPosition =
    last !== undefined ? unwrap(b.slice(last.index + last[0].length)) : "";
  return { accepted, rejected, netPosition };
}

/**
 * Parse the model's verdict. Leads with the parse-proof line format; only if
 * that yields nothing does it fall back to tolerant regex extraction of a
 * JSON-ish blob (handles the wrapped-and-malformed case). Always returns
 * populated accepted/rejected and a plain-text netPosition when content exists.
 */
export function parseVerdict(raw: string): Verdict {
  let text = raw.trim();

  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  // PRIMARY: line format.
  const lined = parseVerdictLines(text);
  if (lined.accepted.length || lined.rejected.length || lined.netPosition) {
    return lined;
  }

  // FALLBACK: tolerant regex over a JSON-ish (maybe malformed) blob.
  const extracted = extractVerdictByRegex(text);
  if (
    extracted.accepted.length ||
    extracted.rejected.length ||
    extracted.netPosition
  ) {
    return extracted;
  }

  // Last resort: surface the raw text rather than silently dropping it.
  return { accepted: [], rejected: [], netPosition: text };
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const VERDICT_SYSTEM =
  "You are the lab's consensus reconciler. You weigh an evidence-based YES " +
  "case and NO case and their rebuttals, then reach a single holistic verdict.";

function verdictPrompt(
  question: string,
  pro: string,
  critPro: string,
  con: string,
  critCon: string,
): string {
  return (
    `Research question: ${question}\n\n` +
    `CASE THAT IT CAN (hypothesis/pro):\n${pro}\n\n` +
    `REBUTTAL OF THE PRO CASE (critique/pro):\n${critPro}\n\n` +
    `CASE THAT IT CANNOT (hypothesis/con):\n${con}\n\n` +
    `REBUTTAL OF THE CON CASE (critique/con):\n${critCon}\n\n` +
    `Reconcile these holistically. Decide which claims survive scrutiny and ` +
    `which are rejected, each with brief reasoning, then state the lab's net ` +
    `position.\n\n` +
    `Respond in this EXACT line format — NOT JSON. One claim per line. Use as ` +
    `many ACCEPTED and REJECTED lines as you need, then exactly one NET line ` +
    `last:\n` +
    `ACCEPTED: <a claim that survives — brief reason>\n` +
    `ACCEPTED: <another surviving claim — brief reason>\n` +
    `REJECTED: <a claim that fails — brief reason>\n` +
    `NET: <one plain sentence stating the lab's net position>\n\n` +
    `Do NOT output JSON, braces, brackets, quotes around lines, or markdown ` +
    `fences. Every line must start with ACCEPTED:, REJECTED:, or NET: and ` +
    `nothing else.\n\n` +
    `Example:\n` +
    `ACCEPTED: SLMs hit 84% recall within 4k tokens — survived the rebuttal\n` +
    `REJECTED: SLMs are reliable at any length — the critique showed sharp ` +
    `decay past 32k tokens\n` +
    `NET: Small models use long-term memory reliably within a bounded context ` +
    `horizon but degrade on long or multi-hop recall.`
  );
}

// ─── Node ─────────────────────────────────────────────────────────────────────

async function reconcile(
  state: MergeStateType,
): Promise<Partial<MergeStateType>> {
  const mainBranch = branchName(state.runId, "research/main");

  // BEFORE: research/main's current contents (seed question + corpus, minus the
  // inherited healthcheck). Also the source we parse the question back out of.
  const mainBefore = cleanFacts(
    await recallFacts(MAIN_RECALL_QUERY, mainBranch),
    { dropSeed: false },
  );

  let question = extractQuestion(mainBefore);
  if (!question) {
    console.warn(
      `[merge] could not parse the seeded question from ${mainBranch}; ` +
        `falling back to a generic recall query`,
    );
    question = FALLBACK_QUERY;
  }

  // Rebuild context: recall the four branches' claims (state from the original
  // run is gone in this fresh request). Throttled + serialized by memfork.ts.
  const proFacts = cleanFacts(
    await recallFacts(question, branchName(state.runId, "hypothesis/pro")),
    { dropSeed: true },
  );
  const conFacts = cleanFacts(
    await recallFacts(question, branchName(state.runId, "hypothesis/con")),
    { dropSeed: true },
  );
  const critProFacts = cleanFacts(
    await recallFacts(question, branchName(state.runId, "critique/pro")),
    { dropSeed: true },
  );
  const critConFacts = cleanFacts(
    await recallFacts(question, branchName(state.runId, "critique/con")),
    { dropSeed: true },
  );

  // ONE model call → holistic verdict.
  const reply = await getModel().invoke([
    ["system", VERDICT_SYSTEM],
    [
      "human",
      verdictPrompt(
        question,
        proFacts.join("\n"),
        critProFacts.join("\n"),
        conFacts.join("\n"),
        critConFacts.join("\n"),
      ),
    ],
  ]);
  const verdict = parseVerdict(messageText(reply.content));

  // Commit the verdict back into research/main (ONE commit, array of facts).
  const verdictFacts = [
    `${VERDICT_MARKER} net position: ${verdict.netPosition}`,
    ...verdict.accepted.map((a) => `ACCEPTED: ${a}`),
    ...verdict.rejected.map((r) => `REJECTED: ${r}`),
  ];
  // The on-chain commit-back is the ONLY step that can fail without
  // invalidating the verdict (which is already computed above). Catch ONLY this
  // write so an Enoki/sponsor error still returns the real verdict + mainBefore
  // instead of throwing them away. We do NOT fabricate a mainAfter on failure —
  // nothing persisted, so we skip the post-commit recall entirely.
  try {
    await commitFacts(mainBranch, verdictFacts, "merge: consensus verdict");
  } catch (err) {
    const commitError = err instanceof Error ? err.message : String(err);
    console.error("[merge] commit-back to research/main failed:", err);
    return { verdict, mainBefore, mainAfter: [], committed: false, commitError };
  }

  // AFTER: re-recall research/main to prove it changed. commit→recall has
  // indexing lag (hit live: empty right after commit), and this is the
  // demo-critical moment, so retry ONCE after a short delay if the verdict
  // hasn't indexed yet.
  let mainAfter = cleanFacts(
    await recallFacts(MAIN_RECALL_QUERY, mainBranch),
    { dropSeed: false },
  );
  if (!mainAfter.some((f) => f.includes(VERDICT_MARKER))) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    mainAfter = cleanFacts(await recallFacts(MAIN_RECALL_QUERY, mainBranch), {
      dropSeed: false,
    });
  }

  return { verdict, mainBefore, mainAfter, committed: true };
}

// ─── Graph wiring ─────────────────────────────────────────────────────────────

function buildMergeGraph() {
  return new StateGraph(MergeState)
    .addNode("reconcile", reconcile)
    .addEdge(START, "reconcile")
    .addEdge("reconcile", END);
}

// The MemForks checkpointer is OFF by default for the merge flow too (set
// MEMFORK_CHECKPOINTER=on to enable). It writes checkpoints on its OWN client,
// which BYPASSES our MemWal throttle (src/lib/memfork.ts), so its burst of
// per-super-step commits blew the permanent 30/min cap and killed the merge
// (429 inside MemForksCheckpointer.put → client.commit). Merge is a one-shot
// flow with no resume, so it gains nothing from checkpointing — disabling it
// keeps every MemWal call on the throttled path (~7/run). The
// createMemForksCheckpointer wiring stays behind the flag so it can be turned
// back on if MemWal limits ever change.
const CHECKPOINTER_ENABLED =
  (process.env.MEMFORK_CHECKPOINTER ?? "off").toLowerCase() === "on";

let compiledMergePromise: ReturnType<typeof compileMerge> | null = null;

async function compileMerge() {
  if (!CHECKPOINTER_ENABLED) {
    // No checkpointer → zero un-throttled checkpoint commits hit MemWal.
    return buildMergeGraph().compile();
  }
  const checkpointer = await createMemForksCheckpointer();
  return buildMergeGraph().compile({ checkpointer });
}

function getCompiledMergeGraph() {
  if (!compiledMergePromise) {
    compiledMergePromise = compileMerge().catch((err) => {
      compiledMergePromise = null;
      console.error("[merge] failed to compile graph / checkpointer:", err);
      throw err;
    });
  }
  return compiledMergePromise;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Reconcile a prior run's branches into a verdict, commit it to that run's
 * research/main, and return the verdict plus research/main before and after.
 * Threaded by `merge-<runId>` so the checkpointer namespaces its checkpoints.
 */
export async function runMerge(runId: string): Promise<{
  verdict: Verdict;
  mainBefore: string[];
  mainAfter: string[] | null;
  committed: boolean;
  commitError?: string;
}> {
  const graph = await getCompiledMergeGraph();
  const finalState = await graph.invoke(
    { runId },
    { configurable: { thread_id: `merge-${runId}` } },
  );
  return {
    verdict: finalState.verdict,
    mainBefore: finalState.mainBefore,
    // Surface null (not the empty placeholder) when the commit-back didn't land,
    // so the API and UI never present a fabricated post-merge state.
    mainAfter: finalState.committed ? finalState.mainAfter : null,
    committed: finalState.committed,
    commitError: finalState.commitError,
  };
}

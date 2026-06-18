/**
 * Core divergence engine — a LangGraph StateGraph that takes a research
 * question and produces opposing, contradictory views of the SAME corpus,
 * each persisted in its own MemForks branch.
 *
 * Flow (sequential):
 *   seed       → forks research/main, commits question + shared corpus
 *   readerPro  → strongest YES case → commits to hypothesis/pro
 *   readerCon  → strongest NO  case → commits to hypothesis/con
 *   criticPro  → rebuts hypothesis/pro → commits to critique/pro
 *   criticCon  → rebuts hypothesis/con → commits to critique/con
 *
 * Both readers read the IDENTICAL corpus; divergence is emergent from the
 * stance prompts alone, not from any pre-sorting of evidence.
 *
 * Branches are namespaced per run: `run-<runId>/<logical>` (e.g.
 * `run-abc/hypothesis/pro`), so re-running the route never collides on a
 * fixed name. The runId is surfaced in the API response for dashboard lookup.
 *
 * Nodes run sequentially on purpose: concurrent fan-out would have readerPro
 * and readerCon fork off research/main at the same instant, amplifying the
 * documented Sui object-version race. Serial execution keeps contention — and
 * createBranchWithRetry's work — to a minimum.
 *
 * Signatures verified against installed type defs:
 *   @langchain/langgraph@1.4.2  — Annotation.Root / StateGraph / compile
 *   @memfork/langgraph@0.1.1    — createMemForksCheckpointer(cfg?)
 *   @memfork/core@0.1.11        — client.branch / commit / recall
 */
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { createMemForksCheckpointer } from "@memfork/langgraph";
import {
  getMemForksClient,
  createBranchWithRetry,
  commitFacts,
  recallFacts,
} from "@/lib/memfork";
import { getModel } from "@/lib/model";

// ─── Branch naming ────────────────────────────────────────────────────────────

const LOGICAL = {
  research: "research/main",
  hypothesisPro: "hypothesis/pro",
  hypothesisCon: "hypothesis/con",
  critiquePro: "critique/pro",
  critiqueCon: "critique/con",
} as const;

/** Map a logical branch name into its per-run namespace. */
export function branchName(runId: string, logical: string): string {
  return `run-${runId}/${logical}`;
}

/** The four diverged-fact branches a consumer reads back, in display order. */
export const RESULT_BRANCHES = [
  LOGICAL.hypothesisPro,
  LOGICAL.hypothesisCon,
  LOGICAL.critiquePro,
  LOGICAL.critiqueCon,
] as const;

// ─── State ────────────────────────────────────────────────────────────────────

const lastWriteStringArray = {
  reducer: (_prev: string[], next: string[]) => next,
  default: () => [] as string[],
};

const DivergenceState = Annotation.Root({
  question: Annotation<string>,
  runId: Annotation<string>,
  corpus: Annotation<string>,
  proFacts: Annotation<string[]>(lastWriteStringArray),
  conFacts: Annotation<string[]>(lastWriteStringArray),
  critiquePro: Annotation<string[]>(lastWriteStringArray),
  critiqueCon: Annotation<string[]>(lastWriteStringArray),
});

type DivergenceStateType = typeof DivergenceState.State;

// ─── Prompts ──────────────────────────────────────────────────────────────────

const READER_PRO_STANCE =
  "You are building the STRONGEST evidence-based case that small language " +
  "models CAN reliably use long-term memory. Read the corpus and extract and " +
  "interpret the findings that support this position.";

const READER_CON_STANCE =
  "You are building the STRONGEST evidence-based case that small language " +
  "models CANNOT reliably use long-term memory. Read the corpus and extract " +
  "and interpret the findings that support this position.";

const CLAIMS_FORMAT =
  'Output ONLY a JSON array of 3-4 concise factual claim strings, e.g. ' +
  '["claim one", "claim two", "claim three"]. No prose, no markdown fences.';

function readerPrompt(question: string, corpus: string): string {
  return (
    `Research question: ${question}\n\n` +
    `Corpus:\n${corpus}\n\n` +
    `Cite specific findings from the corpus to back each claim. ${CLAIMS_FORMAT}`
  );
}

function criticPrompt(
  question: string,
  stanceWord: "CAN" | "CANNOT",
  claims: string[],
): string {
  return (
    `Research question: ${question}\n\n` +
    `Another agent has argued that small language models ${stanceWord} ` +
    `reliably use long-term memory, with these claims:\n` +
    claims.map((c, i) => `${i + 1}. ${c}`).join("\n") +
    `\n\nWrite sharp, specific rebuttals that expose the weaknesses, ` +
    `overreach, or unstated assumptions in those claims. ${CLAIMS_FORMAT}`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten a chat message's content to a plain string. */
function messageText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Parse a model reply into 3-4 clean claim strings. This is the most
 * failure-prone spot, so it is deliberately defensive:
 *   1. Strip ```json / ``` markdown fences.
 *   2. Drop any leading prose before the first JSON array bracket.
 *   3. JSON.parse the array; coerce/trim/drop empties.
 *   4. Fall back to splitting numbered/bulleted lines.
 *   5. Trim, drop empties, cap at 4.
 */
export function parseClaims(raw: string): string[] {
  let text = raw.trim();

  // 1. Strip a markdown code fence if the whole/most of the reply is wrapped.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  // 2 + 3. Try to JSON.parse an array, ignoring leading prose like
  // "Here are the claims:".
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const claims = parsed
          .map((c) => (typeof c === "string" ? c : String(c)).trim())
          .filter((c) => c.length > 0);
        if (claims.length > 0) {
          return claims.slice(0, 4);
        }
      }
    } catch {
      // Not valid JSON — fall through to the line-split fallback.
    }
  }

  // 4 + 5. Line-split fallback: strip list markers, trim, drop empties.
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"));
  return lines.slice(0, 4);
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

async function seed(
  state: DivergenceStateType,
): Promise<Partial<DivergenceStateType>> {
  const client = await getMemForksClient();
  const research = branchName(state.runId, LOGICAL.research);
  await createBranchWithRetry(client, research, "main");
  await commitFacts(
    research,
    [`Research question: ${state.question}`, state.corpus],
    "seed: research question + shared corpus",
  );
  return {};
}

async function readerPro(
  state: DivergenceStateType,
): Promise<Partial<DivergenceStateType>> {
  const client = await getMemForksClient();
  const research = branchName(state.runId, LOGICAL.research);
  const pro = branchName(state.runId, LOGICAL.hypothesisPro);
  await createBranchWithRetry(client, pro, research);

  const reply = await getModel().invoke([
    ["system", READER_PRO_STANCE],
    ["human", readerPrompt(state.question, state.corpus)],
  ]);
  const claims = parseClaims(messageText(reply.content));
  await commitFacts(pro, claims, "readerPro: strongest YES case");
  return { proFacts: claims };
}

async function readerCon(
  state: DivergenceStateType,
): Promise<Partial<DivergenceStateType>> {
  const client = await getMemForksClient();
  const research = branchName(state.runId, LOGICAL.research);
  const con = branchName(state.runId, LOGICAL.hypothesisCon);
  await createBranchWithRetry(client, con, research);

  const reply = await getModel().invoke([
    ["system", READER_CON_STANCE],
    ["human", readerPrompt(state.question, state.corpus)],
  ]);
  const claims = parseClaims(messageText(reply.content));
  await commitFacts(con, claims, "readerCon: strongest NO case");
  return { conFacts: claims };
}

async function criticPro(
  state: DivergenceStateType,
): Promise<Partial<DivergenceStateType>> {
  const client = await getMemForksClient();
  const pro = branchName(state.runId, LOGICAL.hypothesisPro);
  const critique = branchName(state.runId, LOGICAL.critiquePro);
  await createBranchWithRetry(client, critique, pro);

  // Rebut using the reader's claims already in graph state — this avoids a
  // second MemWal recall of a branch we just wrote (every recall counts against
  // the permanent 30/min cap). Only recall as a fallback if state is somehow
  // empty (reader produced nothing), and cache that result back into state so
  // the branch is never recalled twice in a run.
  let proClaims = state.proFacts;
  let cached: Partial<DivergenceStateType> = {};
  if (proClaims.length === 0) {
    proClaims = await recallFacts(state.question, pro);
    cached = { proFacts: proClaims };
  }

  const reply = await getModel().invoke([
    ["system", "You are a rigorous skeptical critic."],
    ["human", criticPrompt(state.question, "CAN", proClaims)],
  ]);
  const rebuttals = parseClaims(messageText(reply.content));
  await commitFacts(critique, rebuttals, "criticPro: rebuttal of hypothesis/pro");
  return { ...cached, critiquePro: rebuttals };
}

async function criticCon(
  state: DivergenceStateType,
): Promise<Partial<DivergenceStateType>> {
  const client = await getMemForksClient();
  const con = branchName(state.runId, LOGICAL.hypothesisCon);
  const critique = branchName(state.runId, LOGICAL.critiqueCon);
  await createBranchWithRetry(client, critique, con);

  // State-first (see criticPro): rebut from the reader's in-state claims to
  // avoid a second recall; only recall as an empty-state fallback and cache it.
  let conClaims = state.conFacts;
  let cached: Partial<DivergenceStateType> = {};
  if (conClaims.length === 0) {
    conClaims = await recallFacts(state.question, con);
    cached = { conFacts: conClaims };
  }

  const reply = await getModel().invoke([
    ["system", "You are a rigorous skeptical critic."],
    ["human", criticPrompt(state.question, "CANNOT", conClaims)],
  ]);
  const rebuttals = parseClaims(messageText(reply.content));
  await commitFacts(critique, rebuttals, "criticCon: rebuttal of hypothesis/con");
  return { ...cached, critiqueCon: rebuttals };
}

// ─── Graph wiring ─────────────────────────────────────────────────────────────

function buildGraph() {
  return new StateGraph(DivergenceState)
    .addNode("seed", seed)
    .addNode("readerPro", readerPro)
    .addNode("readerCon", readerCon)
    .addNode("criticPro", criticPro)
    .addNode("criticCon", criticCon)
    .addEdge(START, "seed")
    .addEdge("seed", "readerPro")
    .addEdge("readerPro", "readerCon")
    .addEdge("readerCon", "criticPro")
    .addEdge("criticPro", "criticCon")
    .addEdge("criticCon", END);
}

// Compile once and reuse. The MemForks checkpointer is wired here but kept OFF
// by default for THIS (divergence) flow (set MEMFORK_CHECKPOINTER=on to enable).
// Reason: the checkpointer auto-resolves its OWN MemForksClient (separate from
// getMemForksClient), so its checkpoint commits to `thread/<runId>` bypass our
// MemWal throttle in src/lib/memfork.ts and eat into the permanent ~30 req/min
// rate limit. The divergence flow runs at a tight ~5-call MemWal budget, so it
// stays off here to protect that budget.
//
// The checkpointer is now LOAD-BEARING in the consensus step — see
// src/lib/merge.ts, which compiles its (single-node) merge graph WITH the
// checkpointer ON. That flow makes its own budget choice independently of this
// flag; the createMemForksCheckpointer wiring stays here so divergence can opt
// back in later via MEMFORK_CHECKPOINTER=on if resumable state is ever needed.
const CHECKPOINTER_ENABLED =
  (process.env.MEMFORK_CHECKPOINTER ?? "off").toLowerCase() === "on";

let compiledGraphPromise: ReturnType<typeof compile> | null = null;

async function compile() {
  if (!CHECKPOINTER_ENABLED) {
    // No-op checkpointing: compile without a checkpointer so the graph writes
    // nothing extra to MemWal.
    return buildGraph().compile();
  }
  const checkpointer = await createMemForksCheckpointer();
  return buildGraph().compile({ checkpointer });
}

function getCompiledGraph() {
  if (!compiledGraphPromise) {
    compiledGraphPromise = compile().catch((err) => {
      // Reset so a transient setup failure does not poison the singleton.
      compiledGraphPromise = null;
      console.error("[graph] failed to compile graph / checkpointer:", err);
      throw err;
    });
  }
  return compiledGraphPromise;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Run the full divergence flow for a question. Generates a short per-run id,
 * invokes the compiled graph (threaded by runId so the checkpointer namespaces
 * its checkpoints), and returns the runId plus the per-branch claims.
 *
 * The claims are read straight from the final graph state — i.e. exactly what
 * each agent committed THIS run, already one clean claim per array element.
 * We deliberately do NOT recall the branches for the response: every result
 * branch forks down the chain `main → research/main → hypothesis/* →
 * critique/*`, and client.branch() copies the parent's live head, so a recall
 * would drag in unrelated `main` facts (the healthcheck commit) AND the seed
 * commit (question + full corpus) that the fork carries into every branch.
 * Returning the committed claims keeps the output to relevant research claims
 * only. The MemForks dashboard still shows the on-branch commits for verification.
 */
export async function runDivergence(
  question: string,
  corpus: string,
): Promise<{ runId: string; branches: Record<string, string[]> }> {
  const runId = Date.now().toString(36);
  const graph = await getCompiledGraph();
  const finalState = await graph.invoke(
    { question, runId, corpus },
    { configurable: { thread_id: runId } },
  );
  return {
    runId,
    branches: {
      [LOGICAL.hypothesisPro]: finalState.proFacts,
      [LOGICAL.hypothesisCon]: finalState.conFacts,
      [LOGICAL.critiquePro]: finalState.critiquePro,
      [LOGICAL.critiqueCon]: finalState.critiqueCon,
    },
  };
}

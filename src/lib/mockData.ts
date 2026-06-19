/**
 * DEV-ONLY mock backend for /api/research and /api/merge.
 *
 * This is a dev harness, NEVER shipped active. It exists so the frontend (staged
 * loading animation, success-path DiffPanel, honest degraded path) can be
 * verified locally when the real backend services (seal/encrypt sidecar,
 * sponsor) are down. The canned responses mirror the real response shapes in
 * ./types exactly so the UI cannot tell the difference.
 *
 * SAFETY GATE: the mock fires ONLY when BOTH are true —
 *   process.env.NODE_ENV !== "production"  AND  process.env.MOCK_BACKEND === "on"
 * If either is false/absent, the routes run their REAL logic, unchanged. A leaked
 * env var in production therefore still cannot enable the mock (NODE_ENV blocks
 * it). See mockEnabled() below — both routes share this one gate.
 */
import type { ResearchResponse, MergeResponse, Verdict } from "./types";

// ─── Tunable knobs (edit these to iterate) ─────────────────────────────────────

// Delay before /api/research responds. ~75s matches a realistic divergence run
// so the staged loader can be watched end-to-end. Drop to 5_000 for fast UI work.
const RESEARCH_DELAY_MS = 75_000;
// Short delay before /api/merge responds.
const MERGE_DELAY_MS = 3_000;
// Which merge path to exercise: "success" lights the glow + "main learned N
// things" + the DAG node; "degraded" tests the honest sponsor-failure path.
const MOCK_MERGE_OUTCOME: "success" | "degraded" = "success";

// ─── Gate ───────────────────────────────────────────────────────────────────--

/**
 * True only in a dev build with the flag explicitly on. NODE_ENV is checked
 * first and independently so a stray MOCK_BACKEND=on in production is inert.
 */
export function mockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.MOCK_BACKEND === "on"
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Short corpus echo, shaped like the seed blob research/main carries. */
const MOCK_CORPUS_BLOB =
  "Corpus: six abstracts on whether small (1B–3B / sub-7B) language models can " +
  "reliably use long-term external memory. Evidence is mixed — bounded-horizon " +
  "recall, retrieval scaffolds, persistent-memory drift, confidence calibration, " +
  "long-horizon agentic recall, and confabulation under adversarial prompting.";

// ─── /api/research mock ─────────────────────────────────────────────────────--

/**
 * Self-contained mock of POST /api/research. Parses + validates the body with the
 * same contract as the real route, waits RESEARCH_DELAY_MS, then returns a valid
 * ResearchResponse with four diverged branches of plausible corpus-domain claims.
 */
export async function mockResearch(request: Request): Promise<Response> {
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

  await sleep(RESEARCH_DELAY_MS);

  const response: ResearchResponse = {
    question,
    runId: `run-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`,
    branches: {
      "hypothesis/pro": [
        "Small models (1B–3B) resolve 84% of single-fact lookups from an external store within 4k-token contexts, rivaling models ten times their size.",
        "A lightweight retrieval scaffold lets a 1.5B model match a 13B model on episodic recall, so raw scale is not the memory bottleneck.",
        "Over a 30-day agentic deployment a 3B model recalled user preferences correctly in 88% of relevant turns, with recall stable across the full horizon.",
        "Confidence becomes well-calibrated after a 200-example pass, raising effective precision on retained facts to 0.93.",
      ],
      "hypothesis/con": [
        "Recall collapses from 84% to 41% once the relevant fact sits beyond 32k tokens of distractors, and multi-hop chains compound the error.",
        "Across multi-session dialogues 19% of stored facts were silently overwritten or contradicted by later sessions — factual drift over long horizons.",
        "Small models query memory spuriously 28% of the time, failing to decide WHEN to retrieve even when lookup accuracy is high.",
        "Under adversarial prompting 2B-class models endorsed never-stored 'memories' 23% of the time, versus 7% for a 34B baseline.",
      ],
      "critique/pro": [
        "The 84% figure holds only within a bounded 4k-token horizon; cited as general reliability it overreaches past the regime where it was measured.",
        "When a 1.5B matches a 13B it is the scaffold's quality doing the work — the result credits the base model for the retriever's competence.",
        "The 88% / 30-day number ignores the 12% that clustered on mid-deployment updates, where the model returned stale values — exactly the hard case.",
        "Calibration was never shown to transfer across memory schemas, so 0.93 precision may not survive a different store.",
      ],
      "critique/con": [
        "Write-verification routines cut drift from 19% to 6% at negligible latency, so persistent-memory drift is addressable, not fundamental.",
        "Provenance-tagging the store dropped confabulation from 23% to 9%, closing most of the gap to the 34B baseline.",
        "Overconfidence is a calibration problem, not a capacity one — a 200-example pass plus abstention fixes the 1-in-5 wrong-but-confident recalls.",
        "The 41% long-context figure tests an unscaffolded worst case; it does not refute reliable use within the bounded horizon the pro case actually claims.",
      ],
    },
  };

  return Response.json(response);
}

// ─── /api/merge mock ────────────────────────────────────────────────────────--

/** Shared canned verdict for both merge paths. */
const MOCK_VERDICT: Verdict = {
  accepted: [
    "Small models reach ~84% single-fact recall within a bounded ~4k-token horizon — survived the rebuttal.",
    "Persistent-memory drift is addressable: write-verification cuts it from 19% to 6% at negligible latency.",
    "Confabulation is mitigable: provenance-tagging drops never-stored 'memory' endorsement from 23% to 9%.",
    "Reliability is largely a calibration problem — a 200-example pass plus abstention raises effective precision to 0.93.",
  ],
  rejected: [
    "Small models are reliable at any context length — the critique showed sharp decay from 84% to 41% past 32k-token distractors.",
    "Scale is irrelevant to memory use — the 1.5B-matches-13B result is driven by scaffold quality, not the base model.",
  ],
  netPosition:
    "Small language models use long-term memory reliably within a bounded context horizon and with verification/calibration scaffolds, but degrade on long-range or multi-hop recall without them.",
};

/**
 * Self-contained mock of POST /api/merge. Parses + validates the body with the
 * same contract as the real route, waits MERGE_DELAY_MS, then returns a valid
 * MergeResponse. MOCK_MERGE_OUTCOME selects the path:
 *   "success"  → committed, mainAfter = mainBefore + verdict facts (≠ mainBefore).
 *   "degraded" → not committed, mainAfter null, real verdict + mainBefore intact.
 */
export async function mockMerge(request: Request): Promise<Response> {
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

  await sleep(MERGE_DELAY_MS);

  const mainBefore = [
    "Research question: Can small language models reliably use long-term memory?",
    MOCK_CORPUS_BLOB,
  ];

  if (MOCK_MERGE_OUTCOME === "degraded") {
    const response: MergeResponse = {
      runId,
      verdict: MOCK_VERDICT,
      mainBefore,
      mainAfter: null,
      committed: false,
      commitError: "mock: sponsor unavailable",
    };
    return Response.json(response);
  }

  // "success": main learns exactly the verdict facts (same line format merge.ts
  // commits), so addedFacts(mainBefore, mainAfter) === verdictFacts.
  const verdictFacts = [
    `VERDICT — net position: ${MOCK_VERDICT.netPosition}`,
    ...MOCK_VERDICT.accepted.map((a) => `ACCEPTED: ${a}`),
    ...MOCK_VERDICT.rejected.map((r) => `REJECTED: ${r}`),
  ];

  const response: MergeResponse = {
    runId,
    verdict: MOCK_VERDICT,
    mainBefore,
    mainAfter: [...mainBefore, ...verdictFacts],
    committed: true,
  };
  return Response.json(response);
}

/**
 * MemForks client wrapper.
 *
 * Singleton MemForksClient built from the MEMFORK_* env vars, plus thin helpers
 * for the two off-chain operations this step needs: commit and recall. Both run
 * through MemWal (Walrus blobs) and issue NO Sui transaction, so nothing here
 * touches branching or any on-chain operation.
 *
 * Signatures verified against the installed @memfork/core type definitions:
 *   MemForksClient.connect({ treeId, signer, network, memwal: { accountId,
 *     delegateKey, serverUrl } })
 *   client.commit(branch, { facts, message }) -> { blobId, contentHash }
 *   client.recall(query, { branch, limit })   -> Array<{ distance, blobId, text }>
 *
 * Pattern adapted from the public reference at
 * apps/memforks-chat/src/lib/memfork.ts in the memforks repo.
 */
import { MemForksClient } from "@memfork/core";

const TESTNET_RELAYER = "https://relayer-staging.memory.walrus.xyz";
const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

function defaultRelayerForNetwork(network: string | undefined): string {
  return network === "mainnet" ? MAINNET_RELAYER : TESTNET_RELAYER;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let clientPromise: Promise<MemForksClient> | null = null;

/**
 * Lazily connect a single shared MemForksClient. The promise is cached; if the
 * connection fails it is reset to null so a transient/config error does not
 * permanently poison the singleton.
 */
export function getMemForksClient(): Promise<MemForksClient> {
  if (!clientPromise) {
    const network = process.env.MEMFORK_NETWORK;
    const serverUrl =
      process.env.MEMFORK_RELAYER_URL ?? defaultRelayerForNetwork(network);

    clientPromise = MemForksClient.connect({
      treeId: requireEnv("MEMFORK_TREE_ID"),
      signer: requireEnv("MEMFORK_PRIVATE_KEY"),
      network: (network ?? "testnet") as
        | "testnet"
        | "mainnet"
        | "devnet"
        | "localnet",
      // Route branch (on-chain) txs through the MemForks sponsor so they are
      // gas-free; without this they self-pay from our signer and fail with a
      // gas error. The CLI keeps this in .memfork/config.json as "sponsorUrl";
      // the connect() config field is the top-level `sponsorUrl` (verified
      // against @memfork/core type defs). Omitting it self-pays.
      sponsorUrl: process.env.MEMFORK_SPONSOR_URL,
      memwal: {
        accountId: requireEnv("MEMFORK_MEMWAL_ACCOUNT"),
        delegateKey: requireEnv("MEMFORK_MEMWAL_KEY"),
        serverUrl,
      },
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * MemWal stores each commit as a full JSON payload shaped like:
 *   { "v":1, "type":"commit", "branch":"...", "delta": { "facts": ["text"] } }
 *
 * Extract the human-readable fact text from delta.facts. If the blob is not a
 * commit payload or fails to parse, fall back to the raw string rather than
 * throwing — never leak raw JSON to the model or UI when we can avoid it.
 */
export function extractFactText(raw: string): string {
  try {
    const payload = JSON.parse(raw) as {
      type?: string;
      delta?: { facts?: unknown[] };
    };
    if (payload.type === "commit" && Array.isArray(payload.delta?.facts)) {
      return payload.delta.facts
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .join("\n\n");
    }
  } catch {
    // Not JSON — fall through to returning the raw string.
  }
  return raw;
}

/**
 * Recall facts for a query on a branch and return CLEAN fact strings (never
 * raw JSON). Each recall result's `text` field holds the stored commit-payload
 * JSON, which we run through extractFactText.
 */
export async function recallFacts(
  query: string,
  branch: string,
  limit = 5,
): Promise<string[]> {
  const client = await getMemForksClient();
  const results = await withRateLimitRetry(`recall ${branch}`, () =>
    client.recall(query, { branch, limit }),
  );

  return results
    .map((r) => extractFactText(String(r.text ?? "")))
    .filter((text) => text.trim().length > 0);
}

/**
 * Substrings that mark a MemForks branch (fork) failure as a transient Sui
 * object-version race rather than a real error. The shared MemoryTree object's
 * version gets bumped by concurrent transactions, so a fork built against
 * version N fails once the chain has advanced to N+1 — a retry rebuilds against
 * the current version and clears it. Matched case-insensitively. Commits are
 * NOT affected (they go through the off-chain relayer), so only branch() needs
 * this wrapper.
 */
const TRANSIENT_BRANCH_ERRORS = [
  "unavailable for consumption",
  "needs to be rebuilt",
];

/**
 * Fork a branch, retrying ONLY the transient Sui object-version race. Every
 * client.branch() call in the divergence engine must go through this helper.
 *
 * On a transient-race error it logs the attempt, waits ~800ms, and retries up
 * to `maxRetries`. Any other error (e.g. a genuine "branch already exists",
 * which should never happen with our per-run unique names) is rethrown
 * immediately rather than masked. Returns the on-chain tx digest from branch().
 */
export async function createBranchWithRetry(
  client: MemForksClient,
  name: string,
  fromBranch: string,
  maxRetries = 5,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.branch(name, { from: fromBranch });
    } catch (err) {
      const message = (
        err instanceof Error ? err.message : String(err)
      ).toLowerCase();
      const isTransient = TRANSIENT_BRANCH_ERRORS.some((s) =>
        message.includes(s),
      );
      if (!isTransient) {
        throw err;
      }
      lastError = err;
      console.warn(
        `createBranchWithRetry: transient Sui race forking "${name}" from ` +
          `"${fromBranch}" (attempt ${attempt}/${maxRetries}): ${message}`,
      );
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }
  throw lastError;
}

// ─── MemWal rate-limit resilience ─────────────────────────────────────────────
//
// MemWal (Walrus) enforces ~30 weighted-requests/min. Across 5 branches plus
// version-race retries a single run blows past that mid-flight and gets HTTP
// 429s, which previously cascaded into unhandled rejections. Two layers of
// defense, both applied to every commit AND recall:
//   1. throttleMemWal — a serial queue that spaces consecutive MemWal requests
//      by a minimum interval, so we stay under the limit proactively.
//   2. withRateLimitRetry — if a 429 slips through anyway (concurrent runs,
//      weighting drift), back off for retry_after_seconds (capped) and retry.
// Because every MemWal call is awaited inside withRateLimitRetry's try/catch,
// a 429 becomes a handled retry, never an unhandled rejection.

// Minimum gap between consecutive MemWal request starts. 30 req/min == 1 every
// 2s; we use 2.2s for headroom against weighted requests. Tunable via env.
const MEMWAL_MIN_INTERVAL_MS = Number(
  process.env.MEMWAL_MIN_INTERVAL_MS ?? 2200,
);

// Serial queue tail + timestamp of the last request start. Each scheduled call
// waits for the previous one to settle and for the min interval to elapse.
let memwalQueue: Promise<unknown> = Promise.resolve();
let lastMemwalStart = 0;

function throttleMemWal<T>(fn: () => Promise<T>): Promise<T> {
  const run = memwalQueue.then(async () => {
    const wait = lastMemwalStart + MEMWAL_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastMemwalStart = Date.now();
    return fn();
  });
  // Chain the next caller after this one settles, but swallow the result/error
  // here so one failed call never breaks the queue (the real result/rejection
  // is delivered to THIS caller via `run`).
  memwalQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const RATE_LIMIT_MARKERS = ["rate limit exceeded", "429"];
const MAX_RATE_LIMIT_RETRIES = 3;
// Cap the backoff so a demo never hangs for a full minute on one 429.
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

/** True when an error is a MemWal 429 / rate-limit response. */
function isRateLimited(err: unknown): boolean {
  const status =
    (err as { status?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (status === 429) {
    return true;
  }
  const message = (
    err instanceof Error ? err.message : String(err)
  ).toLowerCase();
  return RATE_LIMIT_MARKERS.some((marker) => message.includes(marker));
}

/** Read retry_after_seconds from the error message; default 60s, capped. */
function rateLimitWaitMs(message: string): number {
  const match = message.match(/retry_after_seconds["':\s]+(\d+)/i);
  const seconds = match ? Number(match[1]) : 60;
  return Math.min(seconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
}

/**
 * Run a MemWal call through the throttle, then retry on 429 up to
 * MAX_RATE_LIMIT_RETRIES times, backing off by the server's retry_after
 * (capped). Non-429 errors and exhausted retries propagate to the caller.
 */
async function withRateLimitRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await throttleMemWal(fn);
    } catch (err) {
      const canRetry = attempt < MAX_RATE_LIMIT_RETRIES && isRateLimited(err);
      if (!canRetry) {
        throw err;
      }
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const waitMs = rateLimitWaitMs(message);
      console.warn(
        `[memwal] 429 rate-limited on ${label} ` +
          `(retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}); backing off ` +
          `${waitMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

/**
 * Commit facts to a branch as an off-chain MemWal blob (no Sui transaction).
 * Returns the new head's blob id and content hash. Throttled + 429-retried.
 */
export async function commitFacts(
  branch: string,
  facts: string[],
  message: string,
): Promise<{ blobId: string; contentHash: string }> {
  const client = await getMemForksClient();
  return withRateLimitRetry(`commit ${branch}`, () =>
    client.commit(branch, { facts, message }),
  );
}

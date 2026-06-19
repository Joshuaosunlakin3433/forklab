import type { ResearchResponse, MergeResponse } from "./types";

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Surface the rate-limit case explicitly so the UI can speak to it.
    if (res.status === 429) {
      throw new RateLimitError("Rate-limit window still open.");
    }
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export class RateLimitError extends Error {}

export function runResearch(question: string): Promise<ResearchResponse> {
  return postJSON<ResearchResponse>("/api/research", { question });
}

export function runMerge(runId: string): Promise<MergeResponse> {
  return postJSON<MergeResponse>("/api/merge", { runId });
}

/**
 * Computed, not assumed: the lines present in mainAfter but not
 * in mainBefore are exactly what the merge committed — what main *learned*.
 * "main learned N things" = addedFacts(...).length.
 */
export function addedFacts(before: string[], after: string[]): string[] {
  const seen = new Set(before.map((s) => s.trim()));
  return after.filter((s) => !seen.has(s.trim()));
}

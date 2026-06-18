/**
 * Seed corpus for the divergence engine.
 *
 * Six short, fake-but-credible paper abstracts about whether SMALL language
 * models can reliably use long-term memory. The evidence is deliberately MIXED:
 * every abstract contains findings a stance-taking agent could cite for EITHER
 * the YES or the NO case. The corpus is NOT pre-sorted into pro/con — the whole
 * point is that divergence emerges from the readers' stance prompts, not from
 * which abstracts they are handed. Both readers read this same corpus.
 */

export interface Abstract {
  id: string;
  title: string;
  text: string;
}

export const corpus: Abstract[] = [
  {
    id: "halberg-2024",
    title:
      "Bounded Recall: How 1-3B Parameter Models Retrieve From External Memory",
    text:
      "We benchmark seven small language models (1B-3B params) on a long-term memory recall suite with an external vector store. At 4k-token contexts the models resolve 84% of single-fact lookups, rivaling models ten times their size. However, accuracy falls to 41% once the relevant fact sits beyond 32k tokens of distractors, and multi-hop chains compound the error. We conclude that small models can exploit external memory competently within a bounded horizon.",
  },
  {
    id: "okafor-2025",
    title: "Retrieval Scaffolds Close Most of the Small-Model Memory Gap",
    text:
      "Adding a lightweight retrieval scaffold lets a 1.5B model match a 13B model on episodic recall tasks, suggesting raw scale is not the bottleneck for memory use. The gains are largest on factual lookup and smallest on tasks requiring the model to decide WHEN to query memory, where small models query spuriously 28% of the time. Retrieval narrows but does not erase the gap. We caution that the scaffold's quality, not the base model, dominates end-to-end accuracy.",
  },
  {
    id: "venkat-2024",
    title: "Catastrophic Drift in Persistent-Memory Small Models",
    text:
      "Across 50 simulated multi-session dialogues, small models writing to and reading from a persistent memory exhibited factual drift: 19% of stored facts were silently overwritten or contradicted by later sessions. Models with explicit write-verification routines cut drift to 6%, demonstrating that the failure is addressable rather than fundamental. Without such routines, reliability degraded steadily over long horizons. The same verification routines added negligible latency.",
  },
  {
    id: "lindqvist-2025",
    title: "Calibration of Memory Confidence in Sub-7B Models",
    text:
      "Small models are frequently overconfident about remembered facts, assigning >90% confidence to retrieved claims that are wrong 1 in 5 times. Yet we find their confidence becomes well-calibrated after a 200-example calibration pass, after which abstention on low-confidence recalls raises effective precision to 0.93. Reliability therefore appears to be a calibration problem more than a capacity problem. We did not test whether calibration transfers across memory schemas.",
  },
  {
    id: "two-rivers-2024",
    title: "Long-Horizon Agentic Memory: A Stress Test of Compact Models",
    text:
      "In a 30-day agentic deployment, a 3B model maintained a running memory of user preferences and recalled them correctly in 88% of relevant turns, outperforming our naive expectation. The remaining 12% clustered around facts that had been updated mid-deployment, where the model returned stale values. Notably, recall quality was stable across the full 30 days rather than decaying, contradicting the assumption that compact models cannot sustain memory over time.",
  },
  {
    id: "amari-2025",
    title: "When Small Models Confabulate Memories They Never Stored",
    text:
      "We probe whether small models distinguish genuinely retrieved facts from plausible confabulations. Under adversarial prompting, 2B-class models endorsed never-stored 'memories' 23% of the time, versus 7% for a 34B baseline. Provenance-tagging the memory store dropped small-model confabulation to 9%, closing most of the gap to the larger model. The effect was consistent across three unrelated domains, suggesting the mitigation generalizes.",
  },
];

/**
 * Compact joined text of the whole corpus, shared by the seed commit and the
 * reader prompts so both readers provably read the identical material.
 */
export function corpusSummary(): string {
  return corpus
    .map((a) => `[${a.id}] ${a.title}\n${a.text}`)
    .join("\n\n");
}

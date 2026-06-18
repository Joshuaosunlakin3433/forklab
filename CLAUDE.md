@AGENTS.md
- What forklab is: AI Research Lab Notebook on the MemForks SDK, for a bounty. 
  Demonstrates the two-part acceptance gate (divergence + merge that changes 
  research/main).
- Backend is DONE — do not modify src/lib/* or the API routes. Briefly: 
  memfork.ts (throttled client, 30/min MemWal cap, sponsor wired), model.ts 
  (Groq), graph.ts (LangGraph divergence: research/main → hypothesis/pro+con → 
  critique/pro+con, per-run namespace), merge.ts (consensus verdict, line-format 
  not JSON, committed back to research/main). Checkpointer flag-gated OFF.
- The two API routes and their exact response shapes (/api/research and 
  /api/merge).
- Demo flow: research → grab runId → wait ~60s → merge. mainBefore ≠ mainAfter.
- Design direction: dark warm charcoal, warm scholarly accents (amber/sepia/gold, 
  NO blue/green/neon), serif headings + sans body, library theme. Avoid generic 
  AI-template dark UI.
- Workflow conventions: plan-mode-first, run npx tsc --noEmit after changes, 
  user tests manually, MemWal is rate-limited so minimize calls.
Keep it concise and factual — this is orientation, not documentation.
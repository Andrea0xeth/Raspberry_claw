# Skill: Manager / run_subagents (one-shot sub-tasks)

Use **run_subagents** only when splitting a complex request into separate one-shot tasks clearly improves the outcome (e.g. parallel research, one task per vault, one search + one summary). Do not use for simple single-step questions.

## When to use

- User asks something that naturally splits into **independent subtasks** (e.g. "research X and also check our vaults and summarize" → task 1: research X, task 2: check vaults, task 3: summarize).
- You need **multiple angles** in parallel (one subagent focuses on Factor, one on logs, one on a search) and you will combine the answers.
- The main reply benefits from **precomputed results** (e.g. "what’s our TVL and what’s the best yield?" → one task: TVL, one task: yield research).

## When not to use

- Single clear question (just answer or use one tool).
- Tasks that depend on each other (subagents are independent; no chaining).
- More than 5 subtasks (tool limit: max 5).

## Tool: run_subagents

- **Call:** `[TOOL_CALL:run_subagents:{"tasks":[{"id":"1","task":"..."},{"id":"2","task":"..."}],"maxRounds":5}]`
- **Params:**
  - **tasks** (required): array of objects `{ id?: string, task: string }` or array of strings (each string = one task). Max 5 items.
  - **maxRounds** (optional): max tool-call rounds per sub-task (default 5).
- **Result:** `{ results: [ { id, task, response, error?, tokens? } ] }` — one entry per task, in order. You then use these to produce your final answer.

Sub-tasks run with the **same system prompt and tools** as you (Factor, shell, skills). Each runs in an isolated one-shot session; they do not see each other’s output. After all finish, you receive all responses and synthesize the final reply.

## Pattern

1. Decide if the user request is better answered by splitting (research + check + summarize, or multiple parallel checks).
2. If yes: build 2–5 clear, self-contained tasks; call **run_subagents** with those tasks.
3. From the returned **results**, combine and answer in your main reply. If something failed (error in one result), say so and base the answer on the successful results.

Reference: OpenClaw’s official subagents use a similar idea (e.g. `sessions_spawn`); this is a one-shot, blocking version that fits our stack.

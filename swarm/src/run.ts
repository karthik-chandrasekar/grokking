/**
 * Run the swarm on a software brief.
 *
 *   npm run swarm -- "A REST API for a todo app with SQLite and JWT auth"
 *   npm run swarm -- --brief-file brief.md --budget 40 --interactive
 *
 * Creates one session (all five agents share its sandbox), kicks it off with an
 * outcome + rubric so a grader iterates the team until the software meets the bar,
 * streams progress, then downloads the deliverables to ./output/<session-id>/.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { OUTPUTS, WORKSPACE } from "./agents.js";
import { loadState } from "./state.js";

type StreamEvent = Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents;

const client = new Anthropic();

// ---------------------------------------------------------------- CLI args
function parseArgs(argv: string[]) {
  const opts = { brief: "", budgetUsd: 25, maxIterations: 4, interactive: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brief-file") opts.brief = fs.readFileSync(argv[++i], "utf8");
    else if (a === "--budget") opts.budgetUsd = Number(argv[++i]);
    else if (a === "--max-iterations") opts.maxIterations = Number(argv[++i]);
    else if (a === "--interactive") opts.interactive = true;
    else rest.push(a);
  }
  if (!opts.brief) opts.brief = rest.join(" ");
  if (!opts.brief.trim()) {
    console.error('Usage: npm run swarm -- "<what to build>" [--brief-file f] [--budget 25] [--max-iterations 4] [--interactive]');
    process.exit(1);
  }
  if (!(opts.budgetUsd > 0)) throw new Error("--budget must be a positive number of dollars");
  return opts;
}

// ---------------------------------------------------------------- Rubric
// Starter rubric: the grader scores each line independently. Tune it per project.
function rubricFor(brief: string): string {
  return `# Software delivery rubric (starter - tune per project)

Brief: ${brief}

- Every functional requirement stated in the brief is implemented (list any that are not in SUMMARY.md).
- ${WORKSPACE}/SPEC.md exists and describes architecture, layout, and interfaces that match the code.
- The project installs and builds from a clean checkout with the commands in README.md.
- An automated test suite exists, covers the core behaviour and error paths, and passes; SUMMARY.md quotes the final test run.
- Code review findings marked critical or major have been fixed or explicitly justified in SUMMARY.md.
- No hard-coded secrets, no TODO/placeholder stubs in shipped code paths, and inputs are validated.
- README.md documents overview, setup, usage, configuration, testing, and project structure.
- ${OUTPUTS}/project/ holds the full source (without dependency folders), ${OUTPUTS}/project.tar.gz exists, and ${OUTPUTS}/SUMMARY.md describes what was built, how to run it, test results, and known limitations.
`;
}

// ---------------------------------------------------------------- Output helpers
const threadNames = new Map<string, string>(); // session_thread_id -> agent name
const who = (threadId?: string | null) => (threadId ? threadNames.get(threadId) ?? "subagent" : "Tech Lead");
const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s).replace(/\s+/g, " ");
const textOf = (blocks: Array<{ type: string; text?: string }>) =>
  blocks.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const state = loadState();
  if (!state) throw new Error("swarm-state.json not found - run `npm run setup` first.");

  const rl = opts.interactive && process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : undefined;

  const session = await client.beta.sessions.create({
    agent: state.leadId,
    environment_id: state.environmentId,
    title: `Swarm build: ${clip(opts.brief, 60)}`,
    // Hard spend cap in cents, shared by all five agents and any workflow runs.
    budget: { type: "limit", max_list_cost: { amount: String(Math.round(opts.budgetUsd * 100)), currency: "USD" } },
  });
  console.log(`Session ${session.id}  (budget $${opts.budgetUsd})`);
  console.log(`Live trace: https://platform.claude.com/workspaces/default/sessions/${session.id}\n`);

  const seen = new Set<string>();
  const openRuns = new Set<string>();
  const runPhases = new Map<string, string>(); // phase id -> name
  let kickedOff = false;
  let outcome: "done" | "budget" | "failed" = "failed";

  /** Handle one event. Returns true when the session's work is finished. */
  async function handle(event: StreamEvent): Promise<boolean> {
    if ("id" in event && event.id) {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
    }
    switch (event.type) {
      case "agent.message":
        process.stdout.write(`\n[Tech Lead] ${textOf(event.content)}\n`);
        break;
      case "session.thread_created":
        threadNames.set(event.session_thread_id, event.agent_name);
        console.log(`  + ${event.agent_name} thread started${event.workflow_run_id ? " (workflow run)" : ""}`);
        break;
      case "agent.thread_message_sent":
        console.log(`  → Lead → ${event.to_agent_name}: ${clip(textOf(event.content))}`);
        break;
      case "agent.thread_message_received":
        console.log(`  ← ${event.from_agent_name} reported: ${clip(textOf(event.content))}`);
        break;
      case "session.thread_status_terminated":
        console.log(`  - ${event.agent_name} thread finished`);
        break;
      case "agent.tool_use":
      case "agent.mcp_tool_use":
        if (event.evaluated_permission === "ask") {
          // The server could not decide under `auto`. Ask a human, or deny when unattended.
          let allow = false;
          if (rl) {
            const answer = await rl.question(
              `\n[approval] ${who(event.session_thread_id)} wants ${event.name}: ${clip(JSON.stringify(event.input), 300)}\nAllow? [y/N] `,
            );
            allow = answer.trim().toLowerCase().startsWith("y");
          }
          console.log(`  ! ${allow ? "allowed" : "denied"} ${event.name} for ${who(event.session_thread_id)}`);
          await client.beta.sessions.events.send(session.id, {
            events: [{ type: "user.tool_confirmation", tool_use_id: event.id, result: allow ? "allow" : "deny" }],
          });
        }
        break;
      case "workflow_run.created":
        openRuns.add(event.workflow_run_id);
        for (const p of event.phases) runPhases.set(p.id, p.name);
        console.log(`  ⇉ workflow run "${event.name}" started (${event.phases.length} phases)`);
        break;
      case "workflow_run.phase_started":
        console.log(`    phase: ${runPhases.get(event.workflow_run_phase_id) ?? event.workflow_run_phase_id}`);
        break;
      case "workflow_run.error":
        console.log(`  ⇉ workflow run error: ${event.error.type} - ${event.error.message}`);
        break;
      case "workflow_run.status_ended":
        openRuns.delete(event.workflow_run_id);
        console.log(`  ⇉ workflow run ended: ${event.result.type}`);
        break;
      case "span.outcome_evaluation_start":
        console.log(`\n== Grader evaluating iteration ${event.iteration + 1} ==`);
        break;
      case "span.outcome_evaluation_end":
        console.log(`== Grader: ${event.result} ==\n${event.explanation}\n`);
        break;
      case "session.error":
        console.log(`  ✗ session error: ${JSON.stringify(event.error)}`);
        break;
      case "session.status_idle": {
        const reason = event.stop_reason.type;
        if (reason === "requires_action") break; // waiting on a confirmation we handle above
        if (reason === "budget_reached") {
          console.log(`\nBudget of $${opts.budgetUsd} reached. Raise it to resume:\n` +
            `  client.beta.sessions.update("${session.id}", { budget: { ... } })`);
          outcome = "budget";
          return true;
        }
        if (reason === "end_turn" && openRuns.size === 0 && kickedOff) {
          outcome = "done";
          return true;
        }
        if (reason === "retries_exhausted" || reason === "refusal") {
          console.log(`\nSession stopped: ${reason}`);
          return true;
        }
        break;
      }
      case "session.status_terminated":
        console.log("\nSession terminated.");
        return true;
    }
    return false;
  }

  // Stream-first: open the stream, then send the outcome. On a dropped connection,
  // reopen and replay missed events from the event log (deduped by id) so no pending
  // approval is left unanswered.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const stream = await client.beta.sessions.events.stream(session.id);
      if (!kickedOff) {
        await client.beta.sessions.events.send(session.id, {
          events: [{
            type: "user.define_outcome",
            description: `Build this software end to end as a team:\n\n${opts.brief}`,
            rubric: { type: "text", content: rubricFor(opts.brief) },
            max_iterations: opts.maxIterations,
          }],
        });
        kickedOff = true;
      } else {
        for await (const past of client.beta.sessions.events.list(session.id)) {
          if (await handle(past as StreamEvent)) { stream.controller.abort(); return finish(); }
        }
      }
      for await (const event of stream) {
        if (await handle(event)) { stream.controller.abort(); return finish(); }
      }
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status && err.status < 500 && err.status !== 429) throw err;
      console.log(`\n(stream dropped: ${(err as Error).message}; reconnecting)`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("Gave up reconnecting to the session stream.");

  async function finish() {
    rl?.close();
    const s = await client.beta.sessions.retrieve(session.id);
    console.log(`\nResult: ${outcome}. Outcome evaluations: ${s.outcome_evaluations.map((e) => e.result).join(", ") || "none"}`);
    await downloadOutputs(session.id);
  }
}

async function downloadOutputs(sessionId: string) {
  const dir = path.join("output", sessionId);
  // Outputs are indexed a moment after the session goes idle; retry briefly.
  for (let attempt = 0; attempt < 5; attempt++) {
    const files = await client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] });
    if (files.data.length > 0) {
      for (const f of files.data) {
        const dest = path.join(dir, f.filename);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const resp = await client.beta.files.download(f.id);
        fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
        console.log(`  saved ${dest}`);
      }
      console.log(`\nDeliverables in ${dir}/ (start with SUMMARY.md)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("No output files found yet - check the session in the Console.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

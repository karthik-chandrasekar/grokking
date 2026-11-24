# Software Swarm: 5 agents that build software

A five-agent team that turns a plain-English brief into a working, tested, documented
project. It runs on **Claude Managed Agents**: Anthropic hosts the agent loop and a
sandbox container. All five agents share that container's filesystem, and each one
works in its own thread with its own context.

```
                         ┌──────────────────────────┐
     your brief  ──────▶ │  1. Tech Lead (Opus 5.5)  │  plans · SPEC.md · integrates · ships
                         └────────────┬─────────────┘
          delegates self-contained tasks (in parallel) and checks every report
     ┌───────────────────┬────────────┴───────┬──────────────────────┐
     ▼                   ▼                    ▼                      ▼
┌──────────────┐ ┌───────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ 2. Software  │ │ 3. Test       │  │ 4. Code        │  │ 5. DevOps & Docs     │
│    Engineer  │ │    Engineer   │  │    Reviewer    │  │    Engineer          │
│ writes code  │ │ writes + runs │  │ read-only bug/ │  │ scripts, Docker, CI, │
│ (×N parallel)│ │ tests         │  │ security review│  │ README               │
└──────────────┘ └───────────────┘  └────────────────┘  └──────────────────────┘
        Sonnet 5.5 workers · one shared sandbox at /workspace/project
                                      │
               Outcome grader checks the result against a rubric ──▶ iterate until it passes
                                      │
                         /mnt/session/outputs  ──▶  ./output/<session-id>/
```

| # | Agent | Model | Tools | Job |
|---|-------|-------|-------|-----|
| 1 | Tech Lead (coordinator) | `claude-opus-5-5` | bash, files | Plans the work, writes `SPEC.md`, builds the skeleton, delegates, checks findings, runs the final build and tests, packages the deliverables |
| 2 | Software Engineer | `claude-sonnet-5-5` | bash, files | Builds one module per task; several can run in parallel on separate files |
| 3 | Test Engineer | `claude-sonnet-5-5` | bash, files | Writes and runs unit and integration tests; never edits product code |
| 4 | Code Reviewer | `claude-sonnet-5-5` | read, glob, grep | Read-only review for correctness, security and design; reports `file:line` evidence |
| 5 | DevOps & Docs Engineer | `claude-sonnet-5-5` | bash, files | Package scripts, Dockerfile, CI workflow, `.gitignore`, README; checks that each documented command works |

### How a run works
1. **Plan:** the Lead picks a stack, writes `SPEC.md` (architecture, layout, interfaces, commands) and builds the project skeleton.
2. **Build:** Engineers work on separate modules in parallel.
3. **Verify:** the Test Engineer and Reviewers check the code. The Lead checks each finding against the code, sends real problems back for fixes, and has the tests re-run.
4. **Ship:** DevOps adds scripts, CI and docs. The Lead runs the full build and tests.
5. **Grade:** the run starts with a `user.define_outcome` and a rubric. A separate grader scores the result, and the team keeps revising until it passes or hits `--max-iterations`.
6. **Deliver:** `project/`, `project.tar.gz` and `SUMMARY.md` are downloaded to `./output/<session-id>/`.

**Dynamic workflows are on.** For large briefs (for example more than six modules to build or review), the Lead can start a background *workflow run*. It sends each item to the right specialist in parallel, then reviews every item in a second pass. For small projects the Lead delegates directly. Every agent in a run uses tokens, so each session has a hard **budget** (default $25). To turn workflows off, set `workflows: { type: "disabled" }` in `techLead()` in `src/agents.ts` and run `npm run setup` again.

## Setup

Requires Node 20 or later and Anthropic credentials (`ANTHROPIC_API_KEY`, or an `ant auth login` profile).

```bash
cd swarm
npm install
npm run setup        # creates the environment + 5 agents once; saves IDs to swarm-state.json
```

`setup` is safe to re-run. When `swarm-state.json` exists, it **updates** the existing agents
(each update creates a new agent version) instead of creating duplicates. Re-run it after
editing prompts in `src/agents.ts`.

## Build something

```bash
npm run swarm -- "A REST API for a todo app with SQLite persistence, JWT auth, and pagination"
npm run swarm -- --brief-file brief.md --budget 40 --max-iterations 5 --interactive
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--brief-file <path>` | — | Read the brief from a file instead of the command line |
| `--budget <usd>` | `25` | Hard spend cap for the whole session: all agents and workflow runs |
| `--max-iterations <n>` | `4` | Most grader revision rounds (1–20) |
| `--interactive` | off | Asks you about tool calls the server can't approve automatically. Without it, those calls are **denied** |

The terminal shows the Lead's messages, each task handoff and report, workflow phases,
and the grader's verdicts. The command also prints a link to the live session trace in the Claude Console.

## Customizing

- **Rubric:** edit `rubricFor()` in `src/run.ts`. Each line is graded on its own, so keep the criteria concrete.
- **Roles and prompts:** edit `src/agents.ts`, then run `npm run setup`.
- **Web access:** off by default. Package registries (npm, PyPI, …) are reachable. To let agents read docs online, enable `web_fetch` / `web_search` in `toolset([...])`. Then add the hosts to the environment's `allowed_hosts`: delete `environmentId` from `swarm-state.json` and edit `setup.ts`, or update the environment.
- **Existing repo:** to work on a codebase instead of starting from scratch, add a `github_repository` resource with `mount_path: "/workspace/project"` to `sessions.create` in `run.ts`.
- **Cost:** move the Lead to `effort: "medium"`, or switch a worker to `claude-haiku-5-5`.

## Files

```
swarm/
├── src/agents.ts   # the 5 agent definitions (models, prompts, tools, roster)
├── src/setup.ts    # one-time create/update of environment + agents
├── src/run.ts      # session per brief: outcome kickoff, event stream, approvals, download
└── src/state.ts    # swarm-state.json helpers
```

Notes: Managed Agents is in beta. It bills session runtime on top of tokens, and session history is kept until you delete it.

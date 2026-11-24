/**
 * One-time setup (safe to re-run): creates the environment and the five agents, or
 * updates the existing agents in place (which bumps their version) when state exists.
 *
 *   npm run setup
 *
 * IDs are stored in swarm-state.json; run.ts reads them. Never call this per run.
 */
import Anthropic from "@anthropic-ai/sdk";
import { WORKERS, techLead } from "./agents.js";
import { loadState, saveState, type SwarmState } from "./state.js";

const client = new Anthropic();

async function upsertAgent(existingId: string | undefined, params: Anthropic.Beta.AgentCreateParams) {
  if (existingId) {
    const { name, description, model, system, tools, multiagent } = params;
    const agent = await client.beta.agents.update(existingId, { name, description, model, system, tools, multiagent });
    console.log(`  updated  ${agent.name.padEnd(26)} ${agent.id} (v${agent.version})`);
    return agent;
  }
  const agent = await client.beta.agents.create(params);
  console.log(`  created  ${agent.name.padEnd(26)} ${agent.id} (v${agent.version})`);
  return agent;
}

async function main() {
  const prev = loadState();

  let environmentId = prev?.environmentId;
  if (!environmentId) {
    const env = await client.beta.environments.create({
      name: "software-swarm",
      config: {
        type: "cloud",
        // Package registries (npm, PyPI, ...) are reachable; nothing else is.
        networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: false },
      },
    });
    environmentId = env.id;
    console.log(`  created  environment                ${env.id}`);
  }

  const workerIds: string[] = [];
  for (const [i, params] of WORKERS.entries()) {
    const agent = await upsertAgent(prev?.workerIds[i], params);
    workerIds.push(agent.id);
  }
  const lead = await upsertAgent(prev?.leadId, techLead(workerIds));

  const state: SwarmState = { environmentId, leadId: lead.id, workerIds };
  saveState(state);
  console.log("\nSaved swarm-state.json. Next: npm run swarm -- \"<what to build>\"");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

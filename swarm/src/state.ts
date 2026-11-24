import fs from "node:fs";

const STATE_FILE = "swarm-state.json";

export interface SwarmState {
  environmentId: string;
  leadId: string;
  /** Order matches WORKERS in agents.ts. */
  workerIds: string[];
}

export function loadState(): SwarmState | undefined {
  if (!fs.existsSync(STATE_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as SwarmState;
}

export function saveState(state: SwarmState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

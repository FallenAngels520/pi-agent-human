/**
 * Learning tool integration for the pi coding agent.
 *
 * Registers learn_topic, query_knowledge, and check_learning as built-in tools.
 * Injects prompt guidelines so the agent knows WHEN and HOW to use them.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  BackgroundPool,
  createCheckLearningTool,
  createLearnTopicTool,
  createQueryKnowledgeTool,
  CronService,
  HeartbeatRunner,
  KnowledgeGraph,
} from "@earendil-works/pi-domain-agent";

// ── Shared state ──────────────────────────────────────────────────────────────

let sharedKg: KnowledgeGraph | null = null;
let sharedPools: Map<string, BackgroundPool> | null = null;
let heartbeat: HeartbeatRunner | null = null;
let cron: CronService | null = null;

/**
 * Initialize the learning subsystem. Call once at session start.
 * Returns tools, shared state, and prompt guidelines for the system prompt.
 */
let _cachedResult: ReturnType<typeof initLearningTools> | null = null;

export function initLearningTools(onProgress?: (msg: string) => void): {
  tools: AgentTool[];
  kg: KnowledgeGraph;
  pools: Map<string, BackgroundPool>;
  promptGuidelines: string;
} {
  if (_cachedResult) return _cachedResult;

  sharedKg = new KnowledgeGraph();
  try { sharedKg.loadFromFile(".pi/knowledge-graph.json"); } catch {}
  sharedPools = new Map();

  const tools: AgentTool[] = [
    createLearnTopicTool(sharedPools, sharedKg, onProgress ?? console.log),
    createCheckLearningTool(sharedPools),
    createQueryKnowledgeTool(sharedKg, sharedPools),
  ];

  const promptGuidelines = [
    "## Self-Evolving Knowledge System",
    "",
    "You have a persistent knowledge graph that learns and remembers across sessions.",
    "For ANY knowledge question, follow this priority:",
    "",
    "1. **ALWAYS use query_knowledge FIRST** — zero API cost, queries learned knowledge.",
    "   - Status 'found': use the answer, cite the sources.",
    "   - Status 'learning': tell the user it's being learned right now.",
    "   - Status 'unknown': the topic is truly unknown.",
    "",
    "2. **If unknown, use learn_topic** — spawns background learners to acquire knowledge.",
    "   - Returns immediately. Use check_learning to track progress.",
    "   - Learned knowledge persists across sessions in the knowledge graph.",
    "",
    "3. **Use web_search / web_fetch** only for real-time information (current events, live data).",
    "   Do NOT use them as a substitute for query_knowledge.",
    "",
    "4. **NEVER answer from pretraining knowledge alone** when the topic requires",
    "   authoritative sources. Always check the knowledge graph first.",
    "",
    "Example: User asks 'How does Bevy change detection work?'",
    "  → query_knowledge('Bevy change detection')",
    "  → unknown → learn_topic(topic: 'Bevy ECS', concepts: ['Change Detection'])",
    "  → wait for completion → query_knowledge again → answer with sources",
  ].join("\n");

  const result = { tools, kg: sharedKg, pools: sharedPools, promptGuidelines };
  _cachedResult = result;
  return result;
}

/** Start background services (heartbeat + cron). */
export function startLearningBackground(
  kgFile: string,
  pools: Map<string, BackgroundPool>,
): void {
  if (heartbeat || cron) return;
  const pool = new BackgroundPool({
    domain: "heartbeat", provider: "deepseek", modelId: "deepseek-v4-pro", maxConcurrency: 1,
  });
  heartbeat = new HeartbeatRunner({ kgFile, pool, interval: 1800, activeHours: [9, 22], blindSpotThreshold: 0.6 });
  heartbeat.start();
  cron = new CronService({ cronFile: ".pi/cron.json", pool });
  cron.start();
}

export function stopLearningBackground(): void {
  heartbeat?.stop();
  cron?.stop();
  heartbeat = null;
  cron = null;
}

export function getSharedKg(): KnowledgeGraph | null { return sharedKg; }
export function getSharedPools(): Map<string, BackgroundPool> | null { return sharedPools; }

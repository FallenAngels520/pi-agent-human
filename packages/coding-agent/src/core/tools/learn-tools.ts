/**
 * Learning tool integration for the pi coding agent.
 *
 * Registers learn_topic, query_knowledge, and check_learning as built-in tools.
 * Shared state (KnowledgeGraph, BackgroundPool) is created once and lives
 * for the session lifetime.
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

/** Shared knowledge graph — one per session. */
let sharedKg: KnowledgeGraph | null = null;
/** Active learning pools — keyed by domain. */
let sharedPools: Map<string, BackgroundPool> | null = null;
/** Background services. */
let heartbeat: HeartbeatRunner | null = null;
let cron: CronService | null = null;

/**
 * Initialize the learning subsystem. Call once at session start.
 * Returns the three tools to register on the agent.
 */
export function initLearningTools(onProgress?: (msg: string) => void): {
  tools: AgentTool[];
  kg: KnowledgeGraph;
  pools: Map<string, BackgroundPool>;
} {
  sharedKg = new KnowledgeGraph();
  sharedPools = new Map();

  const tools: AgentTool[] = [
    createLearnTopicTool(sharedPools, onProgress ?? console.log),
    createCheckLearningTool(sharedPools),
    createQueryKnowledgeTool(sharedKg, sharedPools),
  ];

  return { tools, kg: sharedKg, pools: sharedPools };
}

/**
 * Start background services (heartbeat + cron).
 * Requires the KG file to exist on disk first.
 */
export function startLearningBackground(
  kgFile: string,
  pools: Map<string, BackgroundPool>,
): void {
  if (heartbeat || cron) return; // Already started

  const pool = new BackgroundPool({
    domain: "heartbeat",
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    maxConcurrency: 1,
  });

  heartbeat = new HeartbeatRunner({
    kgFile,
    pool,
    interval: 1800,   // 30 minutes
    activeHours: [9, 22],
    blindSpotThreshold: 0.6,
  });
  heartbeat.start();

  cron = new CronService({
    cronFile: ".pi/cron.json",
    pool,
  });
  cron.start();
}

/** Stop background services. */
export function stopLearningBackground(): void {
  heartbeat?.stop();
  cron?.stop();
  heartbeat = null;
  cron = null;
}

/** Get the shared knowledge graph. */
export function getSharedKg(): KnowledgeGraph | null {
  return sharedKg;
}

/** Get the shared pool map. */
export function getSharedPools(): Map<string, BackgroundPool> | null {
  return sharedPools;
}

/**
 * Layered prompt assembly — builds system prompts from multiple layers.
 *
 * Based on claw0 s06: 8-layer system prompt construction.
 * Adapted for pi: 6 layers for Main Agent, 4 layers for Learner.
 */

import { readFileSync } from "node:fs";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import type { TaskBoard } from "../task-board.ts";
import type { Task } from "../task-board.ts";

// ── Bootstrap Loader ──────────────────────────────────────────────────────────

export interface BootstrapFiles {
  /** Agent identity — "You are a coding agent with self-evolving knowledge." */
  identity?: string;
  /** Personality — how the agent should behave. */
  soul?: string;
  /** Tool usage guidelines — when to use which tools. */
  tools?: string;
  /** Long-term user preferences and facts. */
  memory?: string;
  /** Heartbeat / cron / autonomous instructions. */
  heartbeat?: string;
  /** Bootstrap instructions — startup context. */
  bootstrap?: string;
}

/**
 * Load bootstrap files from a workspace directory.
 * Each file is optional — missing files are silently skipped.
 */
export function loadBootstrap(workspaceDir: string): BootstrapFiles {
  const read = (name: string): string => {
    try { return readFileSync(`${workspaceDir}/${name}`, "utf-8").trim(); }
    catch { return ""; }
  };
  return {
    identity: read("IDENTITY.md") || undefined,
    soul: read("SOUL.md") || undefined,
    tools: read("TOOLS.md") || undefined,
    memory: read("MEMORY.md") || undefined,
    heartbeat: read("HEARTBEAT.md") || undefined,
    bootstrap: read("BOOTSTRAP.md") || undefined,
  };
}

// ── Layer builders ────────────────────────────────────────────────────────────

function layer(label: string, content: string): string {
  return content ? `## ${label}\n\n${content}` : "";
}

/** Build a capability profile from the knowledge graph. */
function capabilityProfile(kg: KnowledgeGraph): string {
  const concepts = kg.getAllConcepts();
  if (concepts.length === 0) return "";

  const totalConf = concepts.reduce((sum, c) => sum + c.confidence, 0);
  const avgConf = totalConf / concepts.length;
  const mastered = concepts.filter((c) => c.status === "mastered").length;
  const byDomain = new Map<string, number>();
  for (const c of concepts) {
    // Extract domain from description (e.g., "Part of: Bevy ECS")
    const m = c.description.match(/Part of:\s*(.+)/);
    if (m) byDomain.set(m[1], (byDomain.get(m[1]) ?? 0) + 1);
  }

  let level = "novice";
  if (avgConf >= 0.8) level = "expert";
  else if (avgConf >= 0.6) level = "intermediate";
  else if (avgConf >= 0.3) level = "beginner";

  const lines = [
    `Current level: **${level}** (avg confidence: ${avgConf.toFixed(2)}, mastered: ${mastered}/${concepts.length})`,
  ];
  if (byDomain.size > 0) {
    lines.push(
      "Known domains:",
      ...[...byDomain].map(([d, n]) => `  - ${d}: ${n} concepts`),
    );
  }
  return layer("Capability", lines.join("\n"));
}

/** Build learning status summary from TaskBoard. */
function learningStatus(taskBoard?: TaskBoard): string {
  if (!taskBoard) return "";
  // Scan known domains for in-progress tasks
  // For now, return empty if no active tasks
  return "";
}

// ── Main Agent Prompt ─────────────────────────────────────────────────────────

export interface MainPromptContext {
  bootstrap?: BootstrapFiles;
  kg?: KnowledgeGraph;
  taskBoard?: TaskBoard;
  /** Currently learning domains with progress. */
  activeLearning?: Array<{ domain: string; completed: number; total: number }>;
}

/**
 * Build the Main Agent's system prompt — 6 layers.
 *
 * L1: Identity (bootstrap or default)
 * L2: Soul (personality injection)
 * L3: Tool Guidelines (when to use learn_topic / query_knowledge)
 * L4: Capability (dynamic: known domains from KG)
 * L5: Learning Status (dynamic: what's being learned right now)
 * L6: Playbook / Bootstrap context
 */
export function buildMainSystemPrompt(context: MainPromptContext = {}): string {
  const bfs = context.bootstrap;
  const sections: string[] = [];

  // L1: Identity
  const identity = bfs?.identity ||
    "You are a coding agent with a self-evolving knowledge system.";
  sections.push(identity);

  // L2: Soul
  if (bfs?.soul) {
    sections.push(layer("Personality", bfs.soul));
  } else {
    sections.push(layer("Personality",
      "When you don't know something, admit it and trigger learning.\n" +
      "Never pretend to know what you haven't learned.\n" +
      "Use query_knowledge first. If unknown, use learn_topic."
    ));
  }

  // L3: Tool Guidelines
  if (bfs?.tools) {
    sections.push(layer("Tool Usage Guidelines", bfs.tools));
  } else {
    sections.push(layer("Tool Usage Guidelines", [
      "You have three knowledge tools:",
      "",
      "1. **query_knowledge(question)** — search learned knowledge. Zero API cost.",
      "   - Status 'found': use the answer directly.",
      "   - Status 'learning': tell the user it's being learned.",
      "   - Status 'unknown': consider using learn_topic.",
      "",
      "2. **learn_topic(topic, concepts)** — spawn background learners.",
      "   - Returns immediately. Use check_learning to track progress.",
      "   - Concepts you learn persist across sessions in the Knowledge Graph.",
      "",
      "3. **check_learning(domain)** — check background learning progress.",
      "",
      "Strategy: query_knowledge → unknown? → learn_topic → wait → query again → answer.",
    ].join("\n")));
  }

  // L4: Capability (dynamic from KG)
  if (context.kg) {
    const profile = capabilityProfile(context.kg);
    if (profile) sections.push(profile);
  }

  // L5: Learning Status (dynamic)
  if (context.activeLearning && context.activeLearning.length > 0) {
    const lines = context.activeLearning.map(
      (l) => `  - ${l.domain}: ${l.completed}/${l.total} tasks done`,
    );
    sections.push(layer("Currently Learning", lines.join("\n")));
  }

  // L6: Bootstrap context
  if (bfs?.bootstrap) {
    sections.push(layer("Context", bfs.bootstrap));
  }

  return sections.filter(Boolean).join("\n\n");
}

// ── Learner Prompt ────────────────────────────────────────────────────────────

export interface LearnerPromptContext {
  domain: string;
  task?: Task;
  /** Existing concepts the learner should reuse rather than re-learn. */
  existingConcepts?: Array<{ name: string; confidence: number }>;
}

/**
 * Build a Learner sub-agent's system prompt — 4 layers.
 *
 * L1: Focused Identity — "You are a learning specialist. Only job: learn {domain}."
 * L2: Existing Knowledge — concepts already in KG to reuse (not re-learn).
 * L3: Tool Constraints — restricted tool set, no recursion.
 * L4: Output Format — JSON: findings, contradictions, uncertainties, confidence.
 */
export function buildLearnerSystemPrompt(context: LearnerPromptContext): string {
  const sections: string[] = [];

  // L1: Focused Identity
  const taskDesc = context.task
    ? `task #${context.task.id}: "${context.task.subject}"`
    : context.domain;
  sections.push(
    `You are a learning specialist. Your ONLY job: learn about ${taskDesc}.`,
  );

  // L2: Existing Knowledge (KG context)
  if (context.existingConcepts && context.existingConcepts.length > 0) {
    const names = context.existingConcepts
      .map((c) => `  - ${c.name} (confidence: ${c.confidence.toFixed(2)}) — reuse, don't re-learn`)
      .join("\n");
    sections.push(layer("Already Known", [
      "These concepts are already in the Knowledge Graph. Read them, link to them,",
      "but do NOT re-learn them:",
      names,
    ].join("\n")));
  }

  // L3: Tool Constraints
  sections.push(layer("Available Tools", [
    "You have: web_search, web_fetch, add_concept, add_evidence,",
    "           add_relation, query_concepts.",
    "",
    "You do NOT have: bash, write, edit, learn_topic.",
    "You CANNOT modify files or spawn other learners.",
    "",
    "CRITICAL RULES:",
    "1. Search for authoritative sources (web_search).",
    "2. Read full articles (web_fetch).",
    "3. Add learned concepts to KG (add_concept + add_evidence).",
    "4. Link to existing concepts (add_relation + query_concepts).",
    "5. Before learning any concept, check if it already exists in the KG.",
    "   If it does and confidence >= 0.6, reuse it. Don't re-learn.",
  ].join("\n")));

  // L4: Output Format
  sections.push(layer("Output Format", [
    'When you finish learning, respond with JSON:',
    '  {"findings": "...", "contradictions": "...", "uncertainties": "...", "confidence": 0.0-1.0}',
    "",
    "Confidence should reflect how well you understand the concept based on",
    "the sources you found. 0.0 = no understanding, 1.0 = fully mastered.",
  ].join("\n")));

  return sections.filter(Boolean).join("\n\n");
}

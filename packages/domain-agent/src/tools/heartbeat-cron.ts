/**
 * Heartbeat & Cron — proactive continuous learning.
 *
 * Based on claw0 s07 patterns:
 *   HeartbeatRunner: periodic idle scan → find KG gaps → auto-learn
 *   CronService: CRON.json schedule → timed agent turns
 */

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import type { BackgroundPool } from "./learn-tool.ts";

// ── HeartbeatRunner ───────────────────────────────────────────────────────────

export interface HeartbeatConfig {
  /** Path to the shared knowledge graph file. */
  kgFile: string;
  /** Background pool for submitting learning tasks. */
  pool: BackgroundPool;
  /** Interval between scans in seconds (default: 1800 = 30 min). */
  interval?: number;
  /** Active hours range [start, end) 24h format (default: 9-22). */
  activeHours?: [number, number];
  /** Confidence threshold below which concepts are considered "blind spots". */
  blindSpotThreshold?: number;
}

/**
 * HeartbeatRunner periodically scans the knowledge graph for gaps
 * and automatically spawns learners to fill them.
 *
 * Key design decisions from claw0 s07:
 *  - 4 pre-checks before running (file, interval, hours, pool free)
 *  - Non-blocking: skips if pool is busy
 *  - Runs in its own async loop (setInterval)
 */
export class HeartbeatRunner {
  private config: Required<HeartbeatConfig>;
  private lastRunAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: HeartbeatConfig) {
    this.config = {
      interval: 1800,
      activeHours: [9, 22],
      blindSpotThreshold: 0.6,
      ...config,
    };
  }

  /** Start the heartbeat loop. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000); // check every second
  }

  /** Stop the heartbeat loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.shouldRun()) return;

    this.lastRunAt = Date.now();
    const pool = this.config.pool;

    if (pool.isRunning()) return; // don't compete with active learners

    try {
      // Load KG and scan for blind spots
      const raw = readFileSync(this.config.kgFile, "utf-8");
      const kg = JSON.parse(raw);
      const concepts: Array<{ name: string; confidence: number }> = kg.concepts ?? [];

      const blindSpots = concepts.filter(
        (c) => c.confidence < this.config.blindSpotThreshold,
      );

      if (blindSpots.length > 0) {
        const topics = blindSpots.map((c) => c.name);
        pool.submit(
          `heartbeat-${new Date().toISOString().slice(0, 10)}`,
          topics,
        );
      }
    } catch {
      // KG file doesn't exist or is malformed — nothing to do
    }
  }

  private shouldRun(): boolean {
    const kgFile = this.config.kgFile;
    try {
      const stat = readFileSync(kgFile, "utf-8");
      if (!stat.trim()) return false;
    } catch {
      return false; // file doesn't exist
    }

    const elapsed = (Date.now() - this.lastRunAt) / 1000;
    if (elapsed < this.config.interval) return false;

    const hour = new Date().getHours();
    const [start, end] = this.config.activeHours;
    if (hour < start || hour >= end) return false;

    return true;
  }
}

// ── CronJob ────────────────────────────────────────────────────────────────────

interface CronJobDef {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: "at" | "every" | "cron";
    at?: string;           // ISO datetime for "at"
    every_seconds?: number; // interval for "every"
    anchor?: string;       // anchor ISO for "every"
    expr?: string;         // cron expression for "cron"
    tz?: string;
  };
  payload: {
    kind: "agent_turn" | "system_event";
    message?: string;
    text?: string;
  };
  delete_after_run?: boolean;
}

/**
 * Minimal cron expression parser. Supports 5-field format:
 *   minute hour day-of-month month day-of-week
 *
 * Supports: digits, wildcard, step values (every N)
 */
function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];

  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(fields[i], values[i])) return false;
  }
  return true;
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === "*") return true;

  // */N = every N
  const stepMatch = expr.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    return value % Number.parseInt(stepMatch[1], 10) === 0;
  }

  // Single digit or comma-separated list
  const parts = expr.split(",");
  return parts.some((p) => Number.parseInt(p, 10) === value);
}

// ── CronService ────────────────────────────────────────────────────────────────

export interface CronServiceConfig {
  /** Path to CRON.json (claw0 format). */
  cronFile: string;
  /** Background pool for running cron-triggered learning. */
  pool: BackgroundPool;
}

/**
 * CronService loads CRON.json and runs scheduled jobs.
 * Three schedule kinds (from claw0):
 *  - "at": one-shot at a specific ISO datetime
 *  - "every": recurring every N seconds with optional anchor
 *  - "cron": standard 5-field cron expression
 */
export class CronService {
  private config: CronServiceConfig;
  private jobs: CronJobDef[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CronServiceConfig) {
    this.config = config;
    this.loadJobs();
  }

  /** Start the cron tick loop (checks every second). */
  start(): void {
    if (this.timer) return;
    // Ensure cron directory exists
    mkdirSync(dirname(this.config.cronFile), { recursive: true });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  /** Stop the cron tick loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Reload jobs from CRON.json. Call after editing the config. */
  reload(): void {
    this.loadJobs();
  }

  private loadJobs(): void {
    try {
      const raw = readFileSync(this.config.cronFile, "utf-8");
      const data = JSON.parse(raw);
      this.jobs = (data.jobs ?? []).filter((j: CronJobDef) => j.enabled !== false);
    } catch {
      this.jobs = [];
    }
  }

  private tick(): void {
    const now = new Date();
    const nowMs = now.getTime();

    for (const job of this.jobs) {
      const nextTs = this.computeNext(job, now);
      if (nextTs > 0 && nextTs <= nowMs + 500) {
        // due within 500ms → execute
        this.execute(job, now);
        if (job.delete_after_run) {
          // Mark for removal (handled by reload or manual cleanup)
        }
      }
    }
  }

  private computeNext(job: CronJobDef, now: Date): number {
    const sched = job.schedule;

    if (sched.kind === "at" && sched.at) {
      const ts = new Date(sched.at).getTime();
      return ts < now.getTime() ? 0 : ts;
    }

    if (sched.kind === "every") {
      const every = sched.every_seconds ?? 3600;
      // Simple: compute based on last execution or anchor
      // For now: return the next interval boundary
      return now.getTime() + every * 1000 - (now.getTime() % (every * 1000));
    }

    if (sched.kind === "cron" && sched.expr) {
      if (cronMatches(sched.expr, now)) {
        return now.getTime();
      }
      return 0; // not due
    }

    return 0;
  }

  private execute(job: CronJobDef, now: Date): void {
    const payload = job.payload;

    if (payload.kind === "agent_turn" && payload.message) {
      const concepts = payload.message
        .split(/[,、，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (concepts.length > 0) {
        this.config.pool.submit(
          `cron-${job.id}`,
          concepts,
        );
      }
    }
    // system_event payloads are logged but don't trigger learning
  }
}

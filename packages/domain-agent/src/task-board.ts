import { readFileSync, writeFileSync } from "node:fs";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: number;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  owner: string;
  blockedBy: number[];
  created_at: number;
  updated_at: number;
}

export interface TaskProgress {
  completed: number;
  in_progress: number;
  total: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function tasksDir(domain: string): string {
  const dir = join(".tasks", domain);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function taskPath(domain: string, taskId: number): string {
  return join(tasksDir(domain), `task_${taskId}.json`);
}

function lockPath(domain: string, taskId: number): string {
  return join(tasksDir(domain), `task_${taskId}.lock`);
}

function readTask(domain: string, taskId: number): Task | null {
  try {
    const raw = readFileSync(taskPath(domain, taskId), "utf-8");
    return JSON.parse(raw) as Task;
  } catch {
    return null;
  }
}

function writeTask(domain: string, task: Task): void {
  writeFileSync(taskPath(domain, task.id), JSON.stringify(task, null, 2), "utf-8");
}

/** Acquire exclusive file lock. Returns true if acquired. */
function acquireLock(domain: string, taskId: number): boolean {
  try {
    writeFileSync(lockPath(domain, taskId), "", { flag: "wx" });
    // wx = write exclusive: fails if file exists → atomic O_EXCL
    return true;
  } catch {
    return false;
  }
}

/** Release file lock. */
function releaseLock(domain: string, taskId: number): void {
  try {
    rmSync(lockPath(domain, taskId));
  } catch {
    // Lock file may already be gone, ignore.
  }
}

// ── TaskBoard ─────────────────────────────────────────────────────────────────

export class TaskBoard {
  /**
   * Max ID scan — finds the highest existing task ID for a domain.
   */
  private maxId(domain: string): number {
    try {
      const files = readdirSync(tasksDir(domain));
      let max = 0;
      for (const f of files) {
        const m = f.match(/^task_(\d+)\.json$/);
        if (m) {
          const id = Number.parseInt(m[1], 10);
          if (id > max) max = id;
        }
      }
      return max;
    } catch {
      return 0;
    }
  }

  /** Create a new task. Returns the created Task. */
  create(domain: string, subject: string, blockedBy: number[] = [], description = ""): Task {
    const now = Date.now();
    const task: Task = {
      id: this.maxId(domain) + 1,
      subject,
      description,
      status: "pending",
      owner: "",
      blockedBy,
      created_at: now,
      updated_at: now,
    };
    writeTask(domain, task);
    return task;
  }

  /** Get a single task by ID. Returns null if not found. */
  get(domain: string, taskId: number): Task | null {
    return readTask(domain, taskId);
  }

  /** List all tasks for a domain. */
  listAll(domain: string): Task[] {
    try {
      const files = readdirSync(tasksDir(domain));
      const tasks: Task[] = [];
      for (const f of files.sort()) {
        const m = f.match(/^task_(\d+)\.json$/);
        if (m) {
          const task = readTask(domain, Number.parseInt(m[1], 10));
          if (task) tasks.push(task);
        }
      }
      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * Scan for unclaimed tasks that are ready to be worked on.
   *
   * Conditions:
   *  - status == "pending"
   *  - owner == "" (unclaimed)
   *  - all tasks in blockedBy have status "completed"
   */
  scanUnclaimed(domain: string): Task[] {
    const all = this.listAll(domain);
    const completed = new Set(
      all.filter((t) => t.status === "completed").map((t) => t.id),
    );
    return all.filter(
      (t) =>
        t.status === "pending" &&
        t.owner === "" &&
        t.blockedBy.every((bid) => completed.has(bid)),
    );
  }

  /**
   * Atomically claim a task. Uses file lock to prevent race conditions.
   *
   * Returns { ok: true, task } on success, or { ok: false, error } on failure.
   */
  claim(
    domain: string,
    taskId: number,
    learnerName: string,
  ): { ok: true; task: Task } | { ok: false; error: string } {
    if (!acquireLock(domain, taskId)) {
      return { ok: false, error: "Lock contention: another learner is claiming this task" };
    }

    try {
      const task = readTask(domain, taskId);
      if (!task) {
        return { ok: false, error: `Task ${taskId} not found` };
      }
      if (task.owner !== "") {
        return {
          ok: false,
          error: `Already claimed by ${task.owner}`,
        };
      }
      if (task.status !== "pending") {
        return {
          ok: false,
          error: `Cannot claim: status is '${task.status}'`,
        };
      }
      if (task.blockedBy.length > 0) {
        const all = this.listAll(domain);
        const incomplete = task.blockedBy.filter(
          (bid) => !all.find((t) => t.id === bid && t.status === "completed"),
        );
        if (incomplete.length > 0) {
          return {
            ok: false,
            error: `Blocked by incomplete tasks: ${incomplete.join(", ")}`,
          };
        }
      }

      task.owner = learnerName;
      task.status = "in_progress";
      task.updated_at = Date.now();
      writeTask(domain, task);
      return { ok: true, task };
    } finally {
      releaseLock(domain, taskId);
    }
  }

  /** Update task status. */
  update(domain: string, taskId: number, status: Task["status"]): Task | null {
    const task = readTask(domain, taskId);
    if (!task) return null;
    task.status = status;
    task.updated_at = Date.now();
    writeTask(domain, task);
    return task;
  }

  /** Get aggregated progress for a domain. */
  getProgress(domain: string): TaskProgress {
    const all = this.listAll(domain);
    return {
      completed: all.filter((t) => t.status === "completed").length,
      in_progress: all.filter((t) => t.status === "in_progress").length,
      total: all.length,
    };
  }

  /** Check if all tasks in a domain are completed. */
  isAllDone(domain: string): boolean {
    const p = this.getProgress(domain);
    return p.total > 0 && p.completed === p.total;
  }
}

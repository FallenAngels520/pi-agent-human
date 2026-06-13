# Multi-Agent Learning Architecture Design

**Status**: Draft | **Date**: 2026-06-13

## Overview

Add a multi-agent learning system to pi: one Main Agent handles user conversations, and multiple Learner sub-agents run asynchronously to acquire domain knowledge. Learners share a Knowledge Graph via filesystem, coordinate through a Task Board, and are driven by Heartbeat/Cron for continuous self-improvement.

**References**: learn-claude-code (subagent, task board, autonomous agents), claw0 (heartbeat, cron, prompt assembly), Claude Code Agent tool, OpenAI Agents SDK `Agent.as_tool()`.

---

## Section 1: File Structure

```
pi/
├── packages/coding-agent/src/core/tools/
│   └── learn-tool.ts           ← NEW: learn_topic, query_knowledge, check_learning tools
│
├── packages/domain-agent/src/
│   ├── autonomous-learner.ts   ← EXISTING: KG + multi-round learning + Dreaming
│   ├── task-board.ts           ← NEW: Task Board system
│   └── tools/
│       └── learn-tool.ts       ← NEW: AgentTool wrappers for Learner tools
│
├── .tasks/{domain}/            ← NEW: Task Board persistence
│   └── task_N.json
│
├── .pi/                        ← SHARED STATE (Main + Learner both access)
│   ├── knowledge-graph.json
│   ├── long-term-memory.json
│   ├── playbook.json
│   └── cron.json               ← NEW: Cron configuration
│
├── learn-claude-code/          ← REFERENCE ONLY (do not copy)
└── claw0/                      ← REFERENCE ONLY (do not copy)
```

**Principles**:
- `coding-agent` adds exactly 1 file (3 tool registrations), no core changes
- `domain-agent` adds exactly 2 files (Task Board + tool wrapper), no core changes
- All shared state is filesystem-based (`.pi/`, `.tasks/`)
- Reference projects are read-only, no code is copied

---

## Section 2: Main Agent Tool Interfaces

### learn_topic

```typescript
learn_topic({
  topic: string,                              // Learning domain
  concepts: Array<string | {                  // Concepts to learn
    name: string,
    prerequisites: string[]
  }>,
  sub_tasks?: Array<{                         // Fine-grained tasks
    id: number,
    subject: string,
    blockedBy: number[]
  }>,
  learner_count?: number,                     // Parallel learners (default: 2)
  run_in_background?: boolean,                // Async mode (default: true)
})

// Returns immediately when run_in_background=true:
→ {
    status: "learning",
    topic: "Bevy ECS",
    task_count: 4,
    learner_count: 2,
    started_at: "2026-06-13T15:00:00Z"
  }
```

### check_learning

```typescript
check_learning(topic: string)

→ {
    topic: string,
    progress: { completed: number, in_progress: number, total: number },
    tasks: Array<{
      id: number,
      subject: string,
      status: "pending" | "in_progress" | "completed" | "failed",
      owner: string
    }>,
    kg_size: number
  }
```

### query_knowledge

```typescript
query_knowledge(question: string)

→ Status "found": {
    status: "found",
    answer: string,
    confidence: number,
    source_concepts: string[],
    source_urls: string[],
    learned: false
  }

→ Status "learning": {
    status: "learning",
    message: string,
    eta: number
  }

→ Status "unknown": {
    status: "unknown",
    message: string,
    suggestion: string
  }
```

---

## Section 3: Task Board System

### Data Structure

```typescript
interface Task {
  id: number;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  owner: string;          // Empty = unclaimed
  blockedBy: number[];     // Prerequisite task IDs
  created_at: number;
  updated_at: number;
}
```

### Key Operations

| Method | Behavior |
|--------|---------|
| `create(domain, subject, blockedBy)` | Create a task JSON file |
| `scanUnclaimed(domain)` | Find tasks: status=pending, owner="", all blockedBy completed |
| `claim(taskId, learnerName)` | Atomic: lockfile + status check + owner set |
| `update(taskId, status)` | Update task status |
| `getProgress(domain)` | Aggregated progress summary |

### Atomic Claim (from learn-claude-code s07)

```
claim_task(id, "learner-a"):
  1. Acquire file lock (lockfile.task_{id}.lock)
  2. Read task JSON
  3. Check: owner == "" && status == "pending" && blockedBy all done
  4. If pass → write owner="learner-a", status="in_progress"
  5. Release lock
  6. Return result

  Lock implementation: fs.writeFileSync(lockfile, "", { flag: "wx" })
  // "wx" = write exclusive, fails if file exists → natural atomic lock
```

---

## Section 4: Multi-Learner Coordination

### Mechanism 1: Pre-learning KG Check

Every Learner, before learning any concept, queries the KG:

```
learnConcept("System Scheduling"):
  1. Parse prerequisite knowledge: "Entity", "Component"
  2. Query KG: { "Entity" → found (conf=0.75), "System Scheduling" → not found }
  3. Found concepts → read description + evidence, create relations (no API calls)
  4. Missing concepts → web_search + web_fetch + multi-round learning
  5. Result: 2 API calls instead of 5
```

### Mechanism 2: Write-time Dedup

```
addConcept("ECS Entity System", description):
  1. Check existing concepts by name similarity
  2. Similarity >= 0.5 → merge: append evidence, return existing concept ID
  3. Similarity < 0.5 → create new concept
  
  Threshold from claw0 MEMORY.md: "Don't over-remember"
```

### Mechanism 3: KG Write Safety

```
saveToFile(): read latest → merge changes → atomic write (write + rename)
  Single-process (Node.js), no race condition between learner threads.
```

**No MessageBus needed.** Coordination happens entirely through the filesystem.

---

## Section 5: Async Execution Model

```
Main Agent Thread              Background Pool
─────────────────────────────────────────────────
User: "Learn Bevy ECS"
  → learn_topic(...)
  → Build Task Board
  → Submit to pool ──────────→ Learner A (Thread) ─→ claim → learn → save KG
  → Return immediately               Learner B (Thread) ─→ claim → learn → save KG
       "2 learners started"          ...all complete → notify Main Agent

User: "Write a function"     💬 "Bevy ECS learning complete. 4 concepts ready."
  → Normal coding service               ↓
       (not blocked)              Injected into next conversation turn
```

### BackgroundPool

```typescript
class BackgroundPool {
  maxConcurrency: number = 2;
  
  submit(learner: LearnerConfig): string;     // Submit or queue
  getStatus(topic: string): LearningProgress; // Check progress
  onComplete(callback): void;                 // Notification hook
}
```

**References**: Claude Code `run_in_background`, learn-claude-code `background_run`, claw0 `lane_lock`.

---

## Section 6: Heartbeat & Cron (from claw0 s07)

### Heartbeat: Idle-triggered Learning

Runs every 30 minutes (configurable), executes only when:
1. KG file exists and is non-empty
2. Interval since last run has elapsed
3. Within active hours (9:00-22:00)
4. BackgroundPool has a free learner slot

On trigger: scan KG for blind spots → auto-submit `learn_topic` to fill gaps.

### Cron: Scheduled Tasks

```json
// .pi/cron.json — identical format to claw0
{
  "jobs": [
    {
      "id": "daily-prune",
      "schedule": { "kind": "cron", "expr": "0 3 * * *" },
      "payload": { "kind": "agent_turn", "message": "Run Dreaming on all domains." }
    },
    {
      "id": "morning-scan",
      "schedule": { "kind": "cron", "expr": "0 8 * * *" },
      "payload": { "kind": "agent_turn", "message": "Scan frontiers. Start learning top 3." }
    }
  ]
}
```

Three schedule kinds: `cron` (expression), `at` (one-shot), `every` (interval in seconds).

---

## Section 7: Prompt Assembly (from claw0 s06)

### Main Agent (6 layers)

| Layer | Content |
|-------|---------|
| L1 Identity | "Coding agent with self-evolving knowledge capabilities" |
| L2 Soul | "When you don't know, admit it and trigger learning" |
| L3 Tools | learn_topic / query_knowledge / check_learning usage guide |
| L4 Capability | Dynamic: known domains + avg confidence from KG |
| L5 Learning Status | Dynamic: currently learning topics and progress |
| L6 Playbook | Cross-session lessons from previous Dreaming passes |

### Learner (4 layers)

| Layer | Content |
|-------|---------|
| L1 Identity | "Learning specialist. Only job: learn {domain} task #{id}" |
| L2 KG Context | Dynamic: existing concepts to reuse (don't re-learn) |
| L3 Tool Constraints | web_search, web_fetch, KG tools only. No learn_topic/ bash/write |
| L4 Output Format | JSON: {findings, contradictions, uncertainties, confidence} |

---

## Verification Criteria

- [ ] `learn_topic` returns immediately, does not block Main Agent
- [ ] `query_knowledge` returns cached results from KG without API calls
- [ ] Multiple Learners can run concurrently without conflicting
- [ ] Task Board atomic claim prevents duplicate work
- [ ] KG dedup prevents duplicate concepts from different Learners
- [ ] Heartbeat automatically fills knowledge gaps
- [ ] All existing tests (122) continue to pass
- [ ] TypeScript compiles with zero errors

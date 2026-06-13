/**
 * LearningRegistry — lightweight coordination between concurrent Learners.
 *
 * Replaces the need for a full MessageBus (learn-claude-code s15) with two
 * shared maps that solve the two real coordination needs:
 *
 * Scenario 1: Duplicate prevention — Learner B checks if Learner A is already
 *             working on the same concept, and skips it if so.
 *
 * Scenario 2: Stuck handoff — When a Learner plateaus, it leaves hints about
 *             what it tried and what blocked it. The next Learner that picks
 *             up the task reads those hints and adjusts its approach.
 */

export interface StuckRecord {
	learner: string;
	concept: string;
	confidence: number;
	findings: string;
	uncertainties: string;
	timestamp: number;
}

/**
 * Shared state for coordinating concurrent Learners.
 * All methods are synchronous — callers are single-threaded (Node.js event loop).
 */
export class LearningRegistry {
	/** Who is currently working on which concept. */
	private active = new Map<string, { learner: string; startedAt: number }>();

	/** Records from Learners that plateaued — hints for the next attempt. */
	private stuck = new Map<string, StuckRecord[]>();

	// ── Scenario 1: Duplicate prevention ──────────────────────────────────────

	/** Register that a learner is working on a concept. */
	register(learner: string, concept: string): void {
		this.active.set(this.normalize(concept), { learner, startedAt: Date.now() });
	}

	/**
	 * Check if any other learner is already working on this concept.
	 * Returns the learner name if so, null otherwise.
	 */
	isBeingLearned(concept: string): string | null {
		const entry = this.active.get(this.normalize(concept));
		if (!entry) return null;
		// Stale entries (>10 min) are ignored — learner probably crashed
		if (Date.now() - entry.startedAt > 10 * 60 * 1000) {
			this.active.delete(this.normalize(concept));
			return null;
		}
		return entry.learner;
	}

	/** Mark a concept as no longer being learned. */
	complete(concept: string): void {
		this.active.delete(this.normalize(concept));
	}

	// ── Scenario 2: Stuck handoff ──────────────────────────────────────────────

	/**
	 * Record what a learner tried before plateauing.
	 * The next learner to attempt this concept can use these hints.
	 */
	markStuck(learner: string, concept: string, record: Omit<StuckRecord, "learner" | "concept" | "timestamp">): void {
		const key = this.normalize(concept);
		const existing = this.stuck.get(key) ?? [];
		existing.push({ learner, concept: key, timestamp: Date.now(), ...record });
		// Keep only the 3 most recent records per concept
		if (existing.length > 3) existing.shift();
		this.stuck.set(key, existing);
	}

	/**
	 * Get hints from previous stuck attempts on this concept.
	 * Returns a human-readable summary, or null if no hints exist.
	 */
	getStuckHints(concept: string): string | null {
		const records = this.stuck.get(this.normalize(concept));
		if (!records || records.length === 0) return null;

		const lines = ["## Previous Attempts"];
		for (const r of records) {
			lines.push(
				`- ${r.learner} (confidence ${r.confidence.toFixed(2)}): ${r.findings.slice(0, 200)}`,
				`  Stuck on: ${r.uncertainties.slice(0, 200)}`,
			);
		}
		return lines.join("\n");
	}

	/** Clear all state (for testing). */
	clear(): void {
		this.active.clear();
		this.stuck.clear();
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private normalize(name: string): string {
		return name.toLowerCase().trim();
	}
}

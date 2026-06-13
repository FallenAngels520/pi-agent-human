import { describe, expect, it } from "vitest";
import { LearningRegistry } from "../../src/tools/learning-registry.ts";

describe("LearningRegistry", () => {
	describe("Scenario 1: Duplicate prevention", () => {
		it("reports when a concept is being learned", () => {
			const r = new LearningRegistry();
			r.register("learner-a", "Rust Ownership");
			expect(r.isBeingLearned("Rust Ownership")).toBe("learner-a");
			expect(r.isBeingLearned("RUST OWNERSHIP")).toBe("learner-a"); // case insensitive
		});

		it("returns null when no one is learning the concept", () => {
			const r = new LearningRegistry();
			expect(r.isBeingLearned("Rust Ownership")).toBeNull();
		});

		it("returns null after completion", () => {
			const r = new LearningRegistry();
			r.register("learner-a", "Rust Ownership");
			r.complete("Rust Ownership");
			expect(r.isBeingLearned("Rust Ownership")).toBeNull();
		});

		it("different learners can learn different concepts without conflict", () => {
			const r = new LearningRegistry();
			r.register("learner-a", "Entities");
			r.register("learner-b", "Systems");
			expect(r.isBeingLearned("Entities")).toBe("learner-a");
			expect(r.isBeingLearned("Systems")).toBe("learner-b");
		});
	});

	describe("Scenario 2: Stuck handoff", () => {
		it("stores and retrieves stuck hints", () => {
			const r = new LearningRegistry();
			r.markStuck("learner-a", "Systems Scheduling", {
				confidence: 0.45,
				findings: "Schedules concept is key",
				uncertainties: "Ordering vs scheduling distinction unclear",
			});

			const hints = r.getStuckHints("Systems Scheduling");
			expect(hints).toContain("learner-a");
			expect(hints).toContain("Schedules concept is key");
			expect(hints).toContain("Ordering vs scheduling");
		});

		it("keeps only the 3 most recent records", () => {
			const r = new LearningRegistry();
			for (let i = 0; i < 5; i++) {
				r.markStuck(`learner-${i}`, "Hard Problem", {
					confidence: 0.3 + i * 0.05,
					findings: `Attempt ${i}`,
					uncertainties: `Unknown ${i}`,
				});
			}

			const hints = r.getStuckHints("Hard Problem");
			// Should only show the 3 most recent (attempts 2, 3, 4)
			expect(hints).toContain("Attempt 2");
			expect(hints).toContain("Attempt 4");
			expect(hints).not.toContain("Attempt 0");
			expect(hints).not.toContain("Attempt 1");
		});

		it("returns null when no stuck records exist", () => {
			const r = new LearningRegistry();
			expect(r.getStuckHints("Unknown Concept")).toBeNull();
		});
	});
});

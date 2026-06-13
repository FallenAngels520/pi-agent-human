import { describe, expect, it } from "vitest";
import { DreamingEngine, formatPlaybookForPrompt } from "../src/dreaming.ts";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import type { RoundResult, SelfTestResult } from "../src/types.ts";
import { createConcept } from "../src/types.ts";

function makeRound(round: number, perspective: string, confidence: number): RoundResult {
	return {
		round,
		perspective,
		findings: `Findings for round ${round}`,
		contradictions: "",
		uncertainties: round === 1 ? "Some uncertainty" : "",
		confidence,
	};
}

function makeTestResult(
	conceptId: string,
	conceptName: string,
	type: "recall" | "application" | "boundary",
	correct: boolean,
): SelfTestResult {
	return {
		conceptId,
		question: {
			conceptId,
			conceptName,
			question: `Test question about ${conceptName} (${type})`,
			type,
		},
		userAnswer: correct ? `I understand ${conceptName} well` : "I'm not sure",
		expectedAnswer: `Should demonstrate ${type} understanding of ${conceptName}`,
		correct,
		explanation: correct ? "Answer was correct" : "Answer was incomplete",
	};
}

describe("DreamingEngine", async () => {
	it("produces a playbook from a learning session", async () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "Rust memory management", confidence: 0.9 });
		kg.addConcept(c1);
		kg.updateConfidence(c1.id, 0.9);

		const roundHistory: RoundResult[] = [
			makeRound(1, "analytical", 0.5),
			makeRound(2, "critical", 0.75),
			makeRound(3, "synthetic", 0.85),
		];

		const selfTestResults: SelfTestResult[] = [
			makeTestResult(c1.id, "Ownership", "recall", true),
			makeTestResult(c1.id, "Ownership", "application", true),
			makeTestResult(c1.id, "Ownership", "boundary", false),
		];

		const engine = new DreamingEngine();
		const result = await engine.dream(kg, roundHistory, selfTestResults, "Rust");

		expect(result.playbook).toBeDefined();
		expect(result.playbook.domain).toBe("Rust");
		expect(result.playbook.version).toBe(1);

		// Should have principles (mastered concept + perspective effectiveness)
		expect(result.principlesExtracted).toBeGreaterThan(0);

		// Should have a pitfall from the boundary test failure
		expect(result.pitfallsCataloged).toBeGreaterThan(0);

		// Stats should be populated
		expect(result.playbook.stats.totalConcepts).toBe(1);
		expect(result.playbook.stats.totalRounds).toBe(3);
		expect(result.playbook.stats.totalSelfTests).toBe(3);
		expect(result.playbook.stats.perspectiveEffectiveness).toBeDefined();

		// Duration should be non-negative
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("merges duplicate similar concepts", async () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Rust Ownership", description: "Memory ownership in Rust", confidence: 0.9 });
		const c2 = createConcept({
			name: "Ownership in Rust",
			description: "Rust memory ownership rules",
			confidence: 0.7,
		});
		kg.addConcept(c1);
		kg.addConcept(c2);

		const engine = new DreamingEngine({ mergeSimilarityThreshold: 0.5 });
		const result = await engine.dream(kg, [], [], "Rust");

		expect(result.conceptsMerged).toBeGreaterThan(0);
	});

	it("does not merge unrelated concepts", async () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "Rust Ownership", description: "Memory management in Rust" }));
		kg.addConcept(createConcept({ name: "HTTP Protocol", description: "Web communication protocol" }));
		kg.addConcept(createConcept({ name: "CSS Grid", description: "Layout system for web design" }));

		const engine = new DreamingEngine({ mergeSimilarityThreshold: 0.5 });
		const result = await engine.dream(kg, [], [], "Mixed");

		expect(result.conceptsMerged).toBe(0);
	});

	it("extracts perspective effectiveness principles", async () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "...", confidence: 0.9 });
		kg.addConcept(c1);
		kg.updateConfidence(c1.id, 0.9);

		// critical perspective shows highest average gain
		const roundHistory: RoundResult[] = [
			makeRound(1, "analytical", 0.2),
			makeRound(2, "critical", 0.65), // +0.45 gain, avg 0.45
			makeRound(3, "synthetic", 0.7), // +0.05 gain, avg 0.05
			makeRound(4, "critical", 0.9), // +0.20 gain, critical avg now (0.45+0.20)/2 = 0.325
		];

		const selfTestResults: SelfTestResult[] = [makeTestResult(c1.id, "Ownership", "recall", true)];

		const engine = new DreamingEngine();
		const result = await engine.dream(kg, roundHistory, selfTestResults, "Rust");

		// Should identify critical as best perspective
		const bestPerspective = result.playbook.principles.find((p) => p.title.toLowerCase().includes("perspective"));
		expect(bestPerspective).toBeDefined();
		expect(bestPerspective!.statement.toLowerCase()).toContain("critical");
	});

	it("extracts strategies from round dynamics", async () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "...", confidence: 0.9 });
		kg.addConcept(c1);
		kg.updateConfidence(c1.id, 0.9);

		// Big first-round jump
		const roundHistory: RoundResult[] = [
			makeRound(1, "analytical", 0.3),
			makeRound(2, "critical", 0.65), // +0.35 jump
		];

		const selfTestResults: SelfTestResult[] = [];

		const engine = new DreamingEngine();
		const result = await engine.dream(kg, roundHistory, selfTestResults, "Rust");

		// Should have a strategy for the big confidence jump
		expect(result.strategiesIdentified).toBeGreaterThan(0);
		const jumpStrategy = result.playbook.strategies.find((s) => s.trigger.toLowerCase().includes("low initial"));
		expect(jumpStrategy).toBeDefined();
	});

	it("respects maxPrinciples and maxStrategies limits", async () => {
		const kg = new KnowledgeGraph();
		// Add many mastered concepts
		for (let i = 0; i < 10; i++) {
			const c = createConcept({ name: `Concept${i}`, description: `Test concept ${i}`, confidence: 0.9 });
			kg.addConcept(c);
			kg.updateConfidence(c.id, 0.9);
		}

		const roundHistory: RoundResult[] = Array.from({ length: 20 }, (_, i) =>
			makeRound(i + 1, ["analytical", "critical", "synthetic"][i % 3], 0.5 + i * 0.02),
		);

		const selfTestResults: SelfTestResult[] = [
			makeTestResult("concept-1", "Concept0", "recall", true),
			makeTestResult("concept-1", "Concept0", "application", true),
			makeTestResult("concept-2", "Concept1", "boundary", false),
			makeTestResult("concept-2", "Concept1", "recall", false),
		];

		const engine = new DreamingEngine({ maxPrinciples: 3, maxStrategies: 2 });
		const result = await engine.dream(kg, roundHistory, selfTestResults, "Test");

		expect(result.playbook.principles.length).toBeLessThanOrEqual(3);
		expect(result.playbook.strategies.length).toBeLessThanOrEqual(2);
	});

	it("version chains with previous playbook", async () => {
		const kg = new KnowledgeGraph();

		const engine = new DreamingEngine();
		const result1 = await engine.dream(kg, [], [], "Domain");
		expect(result1.playbook.version).toBe(1);

		// Second pass with previous playbook
		const result2 = await engine.dream(kg, [], [], "Domain", result1.playbook);
		expect(result2.playbook.version).toBe(2);
	});

	it("disabling dreaming operations works", async () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "A", description: "..." }));
		kg.addConcept(createConcept({ name: "A Similar", description: "..." }));

		// Disable merge
		const engine = new DreamingEngine({ enableMerge: false });
		const result = await engine.dream(kg, [], [], "Test");

		expect(result.conceptsMerged).toBe(0);
	});
});

describe("formatPlaybookForPrompt", async () => {
	it("formats a playbook as injectable prompt text", async () => {
		const engine = new DreamingEngine();
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "...", confidence: 0.9 });
		kg.addConcept(c1);
		kg.updateConfidence(c1.id, 0.9);

		const result = await engine.dream(
			kg,
			[makeRound(1, "analytical", 0.5), makeRound(2, "critical", 0.85)],
			[makeTestResult(c1.id, "Ownership", "recall", true)],
			"Rust",
		);

		const text = formatPlaybookForPrompt(result.playbook);

		expect(text).toContain("Learning Playbook");
		expect(text).toContain("Rust");
		expect(text).toContain("Version: 1");
		expect(text).toContain("Principles");
		expect(text).toContain("Session Statistics");
	});

	it("returns empty sections when playbook has no content", async () => {
		const engine = new DreamingEngine({
			enableDistillation: false,
			enableMerge: false,
			enablePrune: false,
		});
		const kg = new KnowledgeGraph();
		const result = await engine.dream(kg, [], [], "Empty");

		const text = formatPlaybookForPrompt(result.playbook);

		expect(text).toContain("Learning Playbook");
		expect(text).not.toContain("### Principles");
	});
});

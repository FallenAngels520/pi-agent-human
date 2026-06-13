import { describe, expect, it } from "vitest";
import { Curriculum } from "../src/curriculum.ts";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { LearningLoop } from "../src/learning-loop.ts";
import { SelfTest } from "../src/self-test.ts";
import { createConcept, type Perspective, type RoundResult } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "analytical", instruction: "Analyze systematically." },
	{ name: "critical", instruction: "Question and find weaknesses." },
	{ name: "synthetic", instruction: "Synthesize into understanding." },
];

describe("LearningLoop", () => {
	it("initializes with knowledge graph, curriculum, self-test, and recurrent block config", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		expect(loop).toBeDefined();
	});

	it("seeds initial concepts for a learning goal", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust Ownership", ["Ownership", "Borrowing", "Lifetimes"]);

		expect(kg.size).toBe(3);
		expect(kg.getReadyToLearn().length).toBe(3);
	});

	it("seeds concepts with prerequisites", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust", [
			{ name: "Ownership", prerequisites: [] },
			{ name: "Borrowing", prerequisites: ["Ownership"] },
			{ name: "Lifetimes", prerequisites: ["Borrowing"] },
		]);

		expect(kg.size).toBe(3);
		const readyToLearn = kg.getReadyToLearn();
		expect(readyToLearn).toHaveLength(1);
		expect(readyToLearn[0].name).toBe("Ownership");
	});

	it("gets learning path after seeding", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust", [
			{ name: "Ownership", prerequisites: [] },
			{ name: "Borrowing", prerequisites: ["Ownership"] },
		]);

		const path = loop.getLearningPath();
		expect(path).toHaveLength(2);
		expect(path[0].conceptName).toBe("Ownership");
		expect(path[1].conceptName).toBe("Borrowing");
	});

	it("generates round prompts for the next concept to learn", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust", [{ name: "Ownership", prerequisites: [] }]);

		const prompt = loop.getNextRoundPrompt();
		expect(prompt).not.toBeNull();
		expect(prompt?.problem).toBe("Ownership");
		expect(prompt?.round).toBe(1);
	});

	it("returns null when all concepts are mastered", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		const concept = createConcept({ name: "Done", description: "...", confidence: 0.9, status: "mastered" });
		kg.addConcept(concept);

		const prompt = loop.getNextRoundPrompt();
		expect(prompt).toBeNull();
	});

	it("records round results", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust", [{ name: "Ownership", prerequisites: [] }]);

		const result: RoundResult = {
			round: 1,
			perspective: "analytical",
			findings: "Ownership is a core concept",
			contradictions: "",
			uncertainties: "How does it relate to borrowing?",
			confidence: 0.6,
		};

		loop.recordRoundResult(result);

		const history = loop.getRoundHistory();
		expect(history).toHaveLength(1);
		expect(history[0].confidence).toBe(0.6);
	});

	it("detects when learning is complete for current concept", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);
		const selfTest = new SelfTest(kg);

		const loop = new LearningLoop({
			knowledgeGraph: kg,
			curriculum,
			selfTest,
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		loop.seedConcepts("Rust", [{ name: "Ownership", prerequisites: [] }]);

		expect(loop.isCurrentConceptComplete()).toBe(false);

		loop.recordRoundResult({
			round: 1,
			perspective: "analytical",
			findings: "Done",
			contradictions: "",
			uncertainties: "",
			confidence: 0.85,
		});

		expect(loop.isCurrentConceptComplete()).toBe(true);
	});
});

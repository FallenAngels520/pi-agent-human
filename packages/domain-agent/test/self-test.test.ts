import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { SelfTest } from "../src/self-test.ts";
import { createConcept } from "../src/types.ts";

describe("SelfTest", () => {
	it("generates questions for a concept", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({
			name: "Rust Ownership",
			description: "Each value in Rust has exactly one owner at a time",
			confidence: 0.5,
		});
		kg.addConcept(concept);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateQuestions(concept.id);

		expect(questions.length).toBeGreaterThan(0);
		expect(questions[0].conceptId).toBe(concept.id);
		expect(questions[0].conceptName).toBe("Rust Ownership");
		expect(questions[0].question.length).toBeGreaterThan(0);
	});

	it("generates recall, application, and boundary question types", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({
			name: "Borrowing",
			description: "Temporary access without transferring ownership",
		});
		kg.addConcept(concept);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateQuestions(concept.id);

		const types = questions.map((q) => q.type);
		expect(types).toContain("recall");
		expect(types).toContain("application");
		expect(types).toContain("boundary");
	});

	it("returns empty array for unknown concept", () => {
		const kg = new KnowledgeGraph();
		const selfTest = new SelfTest(kg);

		expect(selfTest.generateQuestions("nonexistent")).toEqual([]);
	});

	it("analyzes test results and returns blind spots for wrong answers", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Ownership", description: "..." });
		kg.addConcept(concept);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateQuestions(concept.id);
		const results = questions.map((q) => ({
			conceptId: q.conceptId,
			question: q,
			userAnswer: "wrong answer",
			expectedAnswer: "correct answer",
			correct: false,
			explanation: "The answer was incorrect because it missed the key concept",
		}));

		const blindSpots = selfTest.analyzeResults(results);

		expect(blindSpots.length).toBeGreaterThan(0);
		expect(blindSpots[0].conceptId).toBe(concept.id);
		expect(blindSpots[0].conceptName).toBe("Ownership");
	});

	it("returns no blind spots when all answers are correct", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Ownership", description: "..." });
		kg.addConcept(concept);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateQuestions(concept.id);
		const results = questions.map((q) => ({
			conceptId: q.conceptId,
			question: q,
			userAnswer: "correct answer",
			expectedAnswer: "correct answer",
			correct: true,
			explanation: "Good",
		}));

		const blindSpots = selfTest.analyzeResults(results);

		expect(blindSpots).toEqual([]);
	});

	it("updates knowledge graph confidence based on results", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Ownership", description: "...", confidence: 0.5 });
		kg.addConcept(concept);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateQuestions(concept.id);
		const results = questions.map((q) => ({
			conceptId: q.conceptId,
			question: q,
			userAnswer: "correct",
			expectedAnswer: "correct",
			correct: true,
			explanation: "Good",
		}));

		selfTest.updateConfidenceFromResults(results);

		const updated = kg.getConcept(concept.id);
		expect(updated?.confidence).toBeGreaterThan(0.5);
	});

	it("generates cross-concept questions for multiple concepts", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "Value ownership system" });
		const c2 = createConcept({ name: "Borrowing", description: "Reference system" });
		kg.addConcept(c1);
		kg.addConcept(c2);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateCrossConceptQuestions([c1.id, c2.id]);

		expect(questions.length).toBeGreaterThan(0);
		expect(questions[0].question).toContain("Ownership");
		expect(questions[0].question).toContain("Borrowing");
		const types = questions.map((q) => q.type);
		expect(types).toContain("recall");
		expect(types).toContain("application");
		expect(types).toContain("boundary");
	});

	it("falls back to single-concept questions when given only one concept ID", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "..." });
		kg.addConcept(c1);

		const selfTest = new SelfTest(kg);
		const questions = selfTest.generateCrossConceptQuestions([c1.id]);

		expect(questions.length).toBe(3);
	});

	it("returns empty for no concepts", () => {
		const kg = new KnowledgeGraph();
		const selfTest = new SelfTest(kg);

		expect(selfTest.generateCrossConceptQuestions([])).toEqual([]);
	});
});

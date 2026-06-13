import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { KnowledgeSynthesis } from "../src/synthesis.ts";
import { createConcept, createRelation } from "../src/types.ts";

describe("KnowledgeSynthesis", () => {
	it("builds a synthesis prompt for multiple concepts", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "Each value has one owner" });
		const c2 = createConcept({ name: "Borrowing", description: "Temporary access via references" });
		kg.addConcept(c1);
		kg.addConcept(c2);

		const synthesis = new KnowledgeSynthesis(kg);
		const prompt = synthesis.buildSynthesisPrompt([c1.id, c2.id]);

		expect(prompt).toContain("Ownership");
		expect(prompt).toContain("Borrowing");
		expect(prompt).toContain("Synthesize");
		expect(prompt).toContain("novel");
	});

	it("builds cross-domain grafting prompt", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({
			name: "Rust Ownership",
			description: "Memory managed by ownership rules at compile time",
		});
		const c2 = createConcept({ name: "Borrow Checker", description: "Static analysis preventing data races" });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c2.id, type: "supports" }));

		const targetDomain = "Database transaction isolation";
		const synthesis = new KnowledgeSynthesis(kg);
		const prompt = synthesis.buildGraftingPrompt([c1.id, c2.id], targetDomain);

		expect(prompt).toContain("Rust Ownership");
		expect(prompt).toContain("Database transaction isolation");
		expect(prompt).toContain("graft");
		expect(prompt).toContain("analogy");
	});

	it("returns empty prompt for unknown concepts", () => {
		const kg = new KnowledgeGraph();
		const synthesis = new KnowledgeSynthesis(kg);
		const prompt = synthesis.buildSynthesisPrompt(["nonexistent"]);

		expect(prompt).toBe("");
	});

	it("generates creative questions based on knowledge gaps", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Lifetimes", description: "Compile-time reference validity tracking" });
		kg.addConcept(c1);

		const synthesis = new KnowledgeSynthesis(kg);
		const questions = synthesis.generateCreativeQuestions([c1.id]);

		expect(questions.length).toBeGreaterThan(0);
		expect(questions[0]).toContain("Lifetimes");
	});
});

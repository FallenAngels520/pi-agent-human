import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../../src/knowledge-graph.ts";
import {
	createGenerateSelfTestTool,
	createRecordSelfTestResultsTool,
	createSelfTestTools,
} from "../../src/tools/test-tools.ts";
import { createConcept } from "../../src/types.ts";

describe("test-tools", () => {
	it("generate_self_test produces questions for a concept", async () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({
			name: "Rust Ownership",
			description: "Each value has exactly one owner at a time",
		});
		kg.addConcept(concept);

		const tool = createGenerateSelfTestTool(kg);
		const result = await tool.execute("call-1", { conceptId: concept.id });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("recall");
		expect(text).toContain("application");
		expect(text).toContain("boundary");

		const details = result.details as { questions: Array<{ conceptId: string; type: string }> };
		expect(details.questions).toHaveLength(3);
	});

	it("generate_self_test returns error for unknown concept", async () => {
		const kg = new KnowledgeGraph();
		const tool = createGenerateSelfTestTool(kg);
		const result = await tool.execute("call-2", { conceptId: "nonexistent" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("not found");
	});

	it("record_self_test_results updates confidence", async () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({
			name: "Ownership",
			description: "...",
			confidence: 0.4,
		});
		kg.addConcept(concept);

		const tool = createRecordSelfTestResultsTool(kg);
		await tool.execute("call-3", {
			conceptId: concept.id,
			results: [
				{ questionType: "recall", userAnswer: "good", expectedAnswer: "good", correct: true },
				{ questionType: "application", userAnswer: "good", expectedAnswer: "good", correct: true },
				{ questionType: "boundary", userAnswer: "bad", expectedAnswer: "correct", correct: false },
			],
		});

		const updated = kg.getConcept(concept.id);
		expect(updated?.confidence).toBeGreaterThan(0.4);
	});

	it("createSelfTestTools returns all three tools", () => {
		const kg = new KnowledgeGraph();
		const tools = createSelfTestTools(kg);
		expect(tools).toHaveLength(3);
		const names = tools.map((t) => t.name);
		expect(names).toContain("generate_self_test");
		expect(names).toContain("generate_cross_test");
		expect(names).toContain("record_self_test_results");
	});
});

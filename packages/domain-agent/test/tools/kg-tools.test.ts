import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../../src/knowledge-graph.ts";
import {
	createAddConceptTool,
	createAddRelationTool,
	createGetBlindSpotsTool,
	createQueryConceptsTool,
} from "../../src/tools/kg-tools.ts";
import { createConcept } from "../../src/types.ts";

describe("kg-tools", () => {
	const kg = new KnowledgeGraph();

	it("add_concept tool creates a concept in the knowledge graph", async () => {
		const tool = createAddConceptTool(kg);
		const result = await tool.execute("call-1", {
			name: "Rust Ownership",
			description: "Each value has exactly one owner",
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Rust Ownership"),
		});
		expect(kg.size).toBe(1);
	});

	it("add_relation tool creates a relation between concepts", async () => {
		const kg2 = new KnowledgeGraph();
		const c1 = createConcept({ name: "A", description: "..." });
		const c2 = createConcept({ name: "B", description: "..." });
		kg2.addConcept(c1);
		kg2.addConcept(c2);

		const tool = createAddRelationTool(kg2);
		const result = await tool.execute("call-2", {
			fromId: c1.id,
			toId: c2.id,
			type: "prerequisite_of",
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("prerequisite_of"),
		});
	});

	it("query_concepts tool returns concepts matching a filter", async () => {
		const kg2 = new KnowledgeGraph();
		kg2.addConcept(createConcept({ name: "Rust", description: "..." }));
		kg2.addConcept(createConcept({ name: "Python", description: "..." }));
		kg2.addConcept(createConcept({ name: "Rust Borrowing", description: "..." }));

		const tool = createQueryConceptsTool(kg2);
		const result = await tool.execute("call-3", { query: "Rust" });

		expect(result.details).toBeDefined();
		const details = result.details as { results: Array<{ name: string }> };
		expect(details.results).toHaveLength(2);
	});

	it("get_blind_spots tool returns concepts below threshold", async () => {
		const kg2 = new KnowledgeGraph();
		kg2.addConcept(createConcept({ name: "A", description: "...", confidence: 0.9 }));
		kg2.addConcept(createConcept({ name: "B", description: "...", confidence: 0.2 }));

		const tool = createGetBlindSpotsTool(kg2);
		const result = await tool.execute("call-4", { threshold: 0.6 });

		const details = result.details as { blindSpots: Array<{ conceptName: string }> };
		expect(details.blindSpots).toHaveLength(1);
		expect(details.blindSpots[0].conceptName).toBe("B");
	});
});

import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { createConcept, createRelation, type Evidence } from "../src/types.ts";

describe("KnowledgeGraph", () => {
	it("adds and retrieves a concept", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Rust Ownership", description: "Each value has one owner" });

		kg.addConcept(concept);
		const retrieved = kg.getConcept(concept.id);

		expect(retrieved).toBeDefined();
		expect(retrieved?.name).toBe("Rust Ownership");
	});

	it("adds a relation between concepts", () => {
		const kg = new KnowledgeGraph();
		const ownership = createConcept({ name: "Ownership", description: "..." });
		const borrowing = createConcept({ name: "Borrowing", description: "..." });

		kg.addConcept(ownership);
		kg.addConcept(borrowing);
		const rel = createRelation({ fromId: ownership.id, toId: borrowing.id, type: "prerequisite_of" });
		kg.addRelation(rel);

		const retrieved = kg.getConcept(ownership.id);
		expect(retrieved?.relations).toHaveLength(1);
		expect(retrieved?.relations[0].type).toBe("prerequisite_of");
	});

	it("updates concept confidence", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "X", description: "..." });
		kg.addConcept(concept);
		const beforeUpdate = kg.getConcept(concept.id)?.lastReviewedAt ?? 0;

		kg.updateConfidence(concept.id, 0.9);

		const updated = kg.getConcept(concept.id);
		expect(updated?.confidence).toBe(0.9);
		expect(updated?.lastReviewedAt).toBeGreaterThanOrEqual(beforeUpdate);
	});

	it("gets blind spots (concepts below confidence threshold)", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "A", description: "...", confidence: 0.9 });
		const c2 = createConcept({ name: "B", description: "...", confidence: 0.3 });
		const c3 = createConcept({ name: "C", description: "...", confidence: 0.5 });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addConcept(c3);

		const blindSpots = kg.getBlindSpots(0.6);

		expect(blindSpots).toHaveLength(2);
		expect(blindSpots.map((bs) => bs.conceptName)).toContain("B");
		expect(blindSpots.map((bs) => bs.conceptName)).toContain("C");
	});

	it("returns all concepts", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "A", description: "..." }));
		kg.addConcept(createConcept({ name: "B", description: "..." }));

		expect(kg.getAllConcepts()).toHaveLength(2);
	});

	it("returns concepts with no unmet prerequisites", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Base", description: "...", confidence: 0.9, status: "mastered" });
		const c2 = createConcept({ name: "Advanced", description: "..." });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c2.id, type: "prerequisite_of" }));

		const available = kg.getReadyToLearn();

		expect(available).toHaveLength(1);
		expect(available[0].name).toBe("Advanced");
	});

	it("returns empty for already mastered concepts in getReadyToLearn", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Base", description: "...", confidence: 0.9, status: "mastered" });
		kg.addConcept(c1);

		expect(kg.getReadyToLearn()).toHaveLength(0);
	});

	it("adds evidence to a concept", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Rust", description: "..." });
		kg.addConcept(concept);

		const evidence: Evidence = {
			source: "https://doc.rust-lang.org/book/",
			type: "documentation",
			excerpt: "Rust is a systems programming language...",
		};

		kg.addEvidence(concept.id, evidence);

		const updated = kg.getConcept(concept.id);
		expect(updated?.evidence).toHaveLength(1);
		expect(updated?.evidence[0].source).toBe("https://doc.rust-lang.org/book/");
	});

	it("does not add duplicate evidence (same source)", () => {
		const kg = new KnowledgeGraph();
		const concept = createConcept({ name: "Rust", description: "..." });
		kg.addConcept(concept);

		const evidence: Evidence = { source: "https://example.com", type: "web_search" };
		kg.addEvidence(concept.id, evidence);
		kg.addEvidence(concept.id, evidence);

		expect(kg.getConcept(concept.id)?.evidence).toHaveLength(1);
	});
});

describe("KnowledgeGraph persistence", () => {
	const tmpFile = "/tmp/test-kg-persistence.json";

	afterEach(async () => {
		try {
			await rm(tmpFile);
		} catch {
			/* ignore */
		}
	});

	it("saves and loads an empty graph", async () => {
		const kg = new KnowledgeGraph();
		await kg.saveToFile(tmpFile);

		const kg2 = new KnowledgeGraph();
		await kg2.loadFromFile(tmpFile);
		expect(kg2.size).toBe(0);
	});

	it("saves and loads concepts with evidence and relations", async () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({
			name: "Ownership",
			description: "Each value has one owner",
			confidence: 0.8,
			evidence: [{ source: "https://rust-book.com/ch4", type: "documentation" }],
		});
		const c2 = createConcept({ name: "Borrowing", description: "Temporary access" });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c2.id, type: "prerequisite_of" }));

		await kg.saveToFile(tmpFile);

		const kg2 = new KnowledgeGraph();
		await kg2.loadFromFile(tmpFile);

		expect(kg2.size).toBe(2);
		const loaded = kg2.getConcept(c1.id);
		expect(loaded?.name).toBe("Ownership");
		expect(loaded?.confidence).toBe(0.8);
		expect(loaded?.evidence).toHaveLength(1);
		expect(loaded?.relations).toHaveLength(1);
		expect(loaded?.relations[0].type).toBe("prerequisite_of");
	});

	it("loadFromFile returns false for missing file", async () => {
		const kg = new KnowledgeGraph();
		const result = await kg.loadFromFile("/tmp/nonexistent-kg-test.json");
		expect(result).toBe(false);
	});
});

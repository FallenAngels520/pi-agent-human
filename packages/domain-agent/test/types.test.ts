import { describe, expect, it } from "vitest";
import { createConcept, createRelation } from "../src/types.ts";

describe("createConcept", () => {
	it("creates a concept with required fields", () => {
		const concept = createConcept({
			name: "Rust Ownership",
			description: "A system where each value has exactly one owner",
		});

		expect(concept.name).toBe("Rust Ownership");
		expect(concept.description).toBe("A system where each value has exactly one owner");
		expect(concept.confidence).toBe(0);
		expect(concept.evidence).toEqual([]);
		expect(concept.relations).toEqual([]);
		expect(concept.status).toBe("not_started");
		expect(concept.id).toBeTypeOf("string");
		expect(concept.createdAt).toBeGreaterThan(0);
	});

	it("creates a concept with optional fields", () => {
		const concept = createConcept({
			name: "Borrowing",
			description: "Temporary access to a value",
			confidence: 0.8,
			evidence: [{ source: "https://doc.rust-lang.org/book/ch04-02.html", type: "documentation" }],
			status: "in_progress",
		});

		expect(concept.confidence).toBe(0.8);
		expect(concept.evidence).toHaveLength(1);
		expect(concept.status).toBe("in_progress");
	});
});

describe("createRelation", () => {
	it("creates a relation between two concepts", () => {
		const rel = createRelation({
			fromId: "concept-1",
			toId: "concept-2",
			type: "prerequisite_of",
		});

		expect(rel.fromId).toBe("concept-1");
		expect(rel.toId).toBe("concept-2");
		expect(rel.type).toBe("prerequisite_of");
		expect(rel.confidence).toBe(1);
	});
});

import { describe, expect, it } from "vitest";
import { Curriculum } from "../src/curriculum.ts";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { createConcept, createRelation } from "../src/types.ts";

describe("Curriculum", () => {
	it("returns an empty path for an empty knowledge graph", () => {
		const kg = new KnowledgeGraph();
		const curriculum = new Curriculum(kg);

		const path = curriculum.planPath("Rust");

		expect(path).toEqual([]);
	});

	it("plans a linear prerequisite chain", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Variables", description: "..." });
		const c2 = createConcept({ name: "Ownership", description: "..." });
		const c3 = createConcept({ name: "Lifetimes", description: "..." });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addConcept(c3);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c2.id, type: "prerequisite_of" }));
		kg.addRelation(createRelation({ fromId: c2.id, toId: c3.id, type: "prerequisite_of" }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("Rust");

		expect(path).toHaveLength(3);
		expect(path[0].conceptName).toBe("Variables");
		expect(path[1].conceptName).toBe("Ownership");
		expect(path[2].conceptName).toBe("Lifetimes");
		expect(path[0].order).toBe(0);
		expect(path[1].order).toBe(1);
		expect(path[2].order).toBe(2);
	});

	it("skips already mastered concepts in the path", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Variables", description: "...", confidence: 0.9, status: "mastered" });
		const c2 = createConcept({ name: "Ownership", description: "..." });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c2.id, type: "prerequisite_of" }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("Rust");

		expect(path).toHaveLength(1);
		expect(path[0].conceptName).toBe("Ownership");
	});

	it("handles concepts with multiple prerequisites", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Syntax", description: "..." });
		const c2 = createConcept({ name: "Types", description: "..." });
		const c3 = createConcept({ name: "Generics", description: "..." });
		kg.addConcept(c1);
		kg.addConcept(c2);
		kg.addConcept(c3);
		kg.addRelation(createRelation({ fromId: c1.id, toId: c3.id, type: "prerequisite_of" }));
		kg.addRelation(createRelation({ fromId: c2.id, toId: c3.id, type: "prerequisite_of" }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("Rust");

		expect(path).toHaveLength(3);
		const genericsIdx = path.findIndex((s) => s.conceptName === "Generics");
		const syntaxIdx = path.findIndex((s) => s.conceptName === "Syntax");
		const typesIdx = path.findIndex((s) => s.conceptName === "Types");
		expect(genericsIdx).toBeGreaterThan(syntaxIdx);
		expect(genericsIdx).toBeGreaterThan(typesIdx);
	});

	it("handles independent concepts (no prerequisites)", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "A", description: "..." }));
		kg.addConcept(createConcept({ name: "B", description: "..." }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("Topic");

		expect(path).toHaveLength(2);
		const orders = path.map((s) => s.order).sort();
		expect(orders).toEqual([0, 1]);
	});

	it("filters concepts by goal keywords when goal is provided", () => {
		const kg = new KnowledgeGraph();
		const ownership = createConcept({ name: "Ownership", description: "Rust memory management" });
		const borrowing = createConcept({ name: "Borrowing", description: "Rust references" });
		const http = createConcept({ name: "HTTP", description: "Web protocol" });
		kg.addConcept(ownership);
		kg.addConcept(borrowing);
		kg.addConcept(http);
		kg.addRelation(createRelation({ fromId: ownership.id, toId: borrowing.id, type: "prerequisite_of" }));

		const curriculum = new Curriculum(kg);
		// Goal "Rust memory" should match Ownership and Borrowing but not HTTP
		const path = curriculum.planPath("Rust memory");

		expect(path).toHaveLength(2);
		const names = path.map((s) => s.conceptName);
		expect(names).toContain("Ownership");
		expect(names).toContain("Borrowing");
		expect(names).not.toContain("HTTP");
		// Ownership (prereq) must come before Borrowing
		expect(names.indexOf("Ownership")).toBeLessThan(names.indexOf("Borrowing"));
	});

	it("matches concepts by name with goal keywords", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "Rust Ownership", description: "Core Rust concept" }));
		kg.addConcept(createConcept({ name: "Python Classes", description: "OOP in Python" }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("Rust");

		expect(path).toHaveLength(1);
		expect(path[0].conceptName).toBe("Rust Ownership");
	});

	it("falls back to all concepts when no keywords match", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "Ownership", description: "Rust concept" }));
		kg.addConcept(createConcept({ name: "Borrowing", description: "Rust concept" }));

		const curriculum = new Curriculum(kg);
		const path = curriculum.planPath("JavaScript Promises");

		// No match — falls back to all concepts
		expect(path).toHaveLength(2);
	});

	it("includes backward prerequisites for matched seed concepts", () => {
		const kg = new KnowledgeGraph();
		const basics = createConcept({ name: "Basics", description: "Fundamentals of programming" });
		const ownership = createConcept({ name: "Ownership", description: "Rust memory ownership" });
		kg.addConcept(basics);
		kg.addConcept(ownership);
		kg.addRelation(createRelation({ fromId: basics.id, toId: ownership.id, type: "prerequisite_of" }));

		const curriculum = new Curriculum(kg);
		// "Ownership" matches the seed, Basics is pulled in as prerequisite
		const path = curriculum.planPath("Ownership");

		expect(path).toHaveLength(2);
		expect(path[0].conceptName).toBe("Basics");
		expect(path[1].conceptName).toBe("Ownership");
	});
});

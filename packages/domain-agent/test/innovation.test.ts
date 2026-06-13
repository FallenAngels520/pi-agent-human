import { describe, expect, it } from "vitest";
import { Innovation } from "../src/innovation.ts";
import { KnowledgeGraph } from "../src/knowledge-graph.ts";
import { createConcept } from "../src/types.ts";

describe("Innovation", () => {
	it("detects frontiers as blind spots below threshold", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "A", description: "...", confidence: 0.9 }));
		kg.addConcept(createConcept({ name: "B", description: "...", confidence: 0.2 }));

		const innovation = new Innovation(kg);
		const frontiers = innovation.detectFrontiers(0.6);

		expect(frontiers).toHaveLength(1);
		expect(frontiers[0].conceptName).toBe("B");
	});

	it("builds hypothesis prompt from a blind spot", () => {
		const kg = new KnowledgeGraph();
		kg.addConcept(createConcept({ name: "Quantum Error Correction", description: "...", confidence: 0.2 }));

		const innovation = new Innovation(kg);
		const blindSpot = {
			conceptId: "1",
			conceptName: "Quantum Error Correction",
			gap: "Unclear scalability",
			severity: "high" as const,
		};
		const prompt = innovation.buildHypothesisPrompt(blindSpot);

		expect(prompt).toContain("Quantum Error Correction");
		expect(prompt).toContain("Falsifiable");
		expect(prompt).toContain("hypotheses");
	});

	it("builds experiment design prompt", () => {
		const kg = new KnowledgeGraph();
		const innovation = new Innovation(kg);
		const prompt = innovation.buildExperimentPrompt("Increasing ownership tracking reduces memory bugs");

		expect(prompt).toContain("Increasing ownership tracking reduces memory bugs");
		expect(prompt).toContain("Independent Variable");
		expect(prompt).toContain("Dependent Variable");
		expect(prompt).toContain("Control Group");
	});

	it("builds paradigm challenge prompt", () => {
		const kg = new KnowledgeGraph();
		const c1 = createConcept({ name: "Ownership", description: "Each value has one owner" });
		const c2 = createConcept({ name: "Borrowing", description: "Temporary references" });
		kg.addConcept(c1);
		kg.addConcept(c2);

		const innovation = new Innovation(kg);
		const prompt = innovation.buildParadigmChallengePrompt([c1.id, c2.id]);

		expect(prompt).toContain("Ownership");
		expect(prompt).toContain("Borrowing");
		expect(prompt).toContain("assumptions");
		expect(prompt).toContain("paradigm");
	});

	it("returns empty prompt for empty concepts", () => {
		const kg = new KnowledgeGraph();
		const innovation = new Innovation(kg);
		expect(innovation.buildParadigmChallengePrompt([])).toBe("");
	});
});

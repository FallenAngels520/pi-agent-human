import type { KnowledgeGraph } from "./knowledge-graph.ts";
import type { BlindSpot } from "./types.ts";

export class Innovation {
	private kg: KnowledgeGraph;

	constructor(kg: KnowledgeGraph) {
		this.kg = kg;
	}

	detectFrontiers(confidenceThreshold: number): BlindSpot[] {
		return this.kg.getBlindSpots(confidenceThreshold);
	}

	buildHypothesisPrompt(blindSpot: BlindSpot): string {
		return [
			"## Hypothesis Generation",
			"",
			`### Knowledge Gap: ${blindSpot.conceptName}`,
			`**Gap**: ${blindSpot.gap}`,
			`**Severity**: ${blindSpot.severity}`,
			"",
			"### Task",
			"Generate 2-3 **testable hypotheses** that could fill this knowledge gap.",
			"Each hypothesis must be:",
			"1. Falsifiable (there must be a way to prove it wrong)",
			"2. Specific (not vague or hand-wavy)",
			"3. Novel (goes beyond what is already known)",
			"",
			"### Output Format",
			"Respond with JSON:",
			"{",
			'  "hypotheses": [',
			'    { "statement": "...", "rationale": "...", "testability": "how to test", "confidence": 0.0 }',
			"  ]",
			"}",
		].join("\n");
	}

	buildExperimentPrompt(hypothesis: string): string {
		return [
			"## Experiment Design",
			"",
			`### Hypothesis: ${hypothesis}`,
			"",
			"### Task",
			"Design an experiment to test this hypothesis.",
			"Structure your response:",
			"1. **Independent Variable**: What you will manipulate",
			"2. **Dependent Variable**: What you will measure",
			"3. **Control Group**: Baseline for comparison",
			"4. **Procedure**: Step-by-step experimental protocol",
			"5. **Success Criteria**: What result confirms vs. refutes the hypothesis",
			"",
			"### Output Format",
			"Respond with JSON:",
			"{",
			'  "independentVariable": "...",',
			'  "dependentVariable": "...",',
			'  "controlGroup": "...",',
			'  "procedure": "...",',
			'  "successCriteria": "..."',
			"}",
		].join("\n");
	}

	buildParadigmChallengePrompt(domainConcepts: string[]): string {
		const concepts = domainConcepts.map((id) => this.kg.getConcept(id)).filter(Boolean);
		if (concepts.length === 0) return "";

		const desc = concepts.map((c) => `- ${c!.name}: ${c!.description}`).join("\n");

		return [
			"## Paradigm Challenge",
			"",
			"### Current Understanding",
			desc,
			"",
			"### Task",
			"Question the **foundational assumptions** of this domain.",
			"Ask: What if the core premise is wrong? What alternative paradigms could exist?",
			"",
			"1. Identify 2-3 hidden assumptions in the current understanding",
			"2. For each assumption, propose an alternative paradigm",
			"3. Describe what the world would look like under each alternative",
			"",
			"### Output Format",
			"Respond with JSON:",
			"{",
			'  "assumptions": [',
			'    { "assumption": "...", "alternativeParadigm": "...", "implications": "..." }',
			"  ],",
			'  "mostPromising": "which alternative paradigm has the most potential",',
			'  "confidence": 0.0',
			"}",
		].join("\n");
	}
}

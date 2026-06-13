import type { KnowledgeGraph } from "./knowledge-graph.ts";
import type { BlindSpot, SelfTestQuestion, SelfTestResult } from "./types.ts";

const QUESTION_TEMPLATES = {
	recall: [
		"What is {concept}? Explain in your own words.",
		"Define {concept} and list its key properties.",
		"In one sentence, what does {concept} mean?",
	],
	application: [
		"Given a practical scenario, how would you apply {concept}? Provide a concrete example.",
		"Write a code snippet that demonstrates {concept} in action.",
		"How would you use {concept} to solve a real problem?",
	],
	boundary: [
		"What are the limitations or edge cases of {concept}?",
		"When does {concept} NOT apply? Give specific counter-examples.",
		"What common mistakes do people make when applying {concept}?",
	],
} as const;

export class SelfTest {
	private kg: KnowledgeGraph;

	constructor(kg: KnowledgeGraph) {
		this.kg = kg;
	}

	generateQuestions(conceptId: string): SelfTestQuestion[] {
		const concept = this.kg.getConcept(conceptId);
		if (!concept) return [];

		const questions: SelfTestQuestion[] = [];
		const types = ["recall", "application", "boundary"] as const;

		for (const type of types) {
			const templates = QUESTION_TEMPLATES[type];
			const template = templates[questions.length % templates.length];
			questions.push({
				conceptId: concept.id,
				conceptName: concept.name,
				question: template.replace("{concept}", concept.name),
				type,
			});
		}

		return questions;
	}

	analyzeResults(results: SelfTestResult[]): BlindSpot[] {
		const blindSpots: BlindSpot[] = [];

		for (const result of results) {
			if (!result.correct) {
				blindSpots.push({
					conceptId: result.conceptId,
					conceptName: result.question.conceptName,
					gap: `Failed ${result.question.type} question: ${result.explanation}`,
					severity: result.question.type === "boundary" ? "medium" : "high",
				});
			}
		}

		return blindSpots;
	}

	updateConfidenceFromResults(results: SelfTestResult[]): void {
		const conceptResults = new Map<string, { correct: number; total: number }>();

		for (const result of results) {
			const entry = conceptResults.get(result.conceptId) ?? { correct: 0, total: 0 };
			entry.total++;
			if (result.correct) entry.correct++;
			conceptResults.set(result.conceptId, entry);
		}

		for (const [conceptId, scores] of conceptResults) {
			const ratio = scores.correct / scores.total;
			const concept = this.kg.getConcept(conceptId);
			if (concept) {
				const newConfidence = Math.max(0, Math.min(1, concept.confidence * 0.3 + ratio * 0.7));
				this.kg.updateConfidence(conceptId, newConfidence);
			}
		}
	}

	generateCrossConceptQuestions(conceptIds: string[]): SelfTestQuestion[] {
		if (conceptIds.length < 2) return this.generateQuestions(conceptIds[0] ?? "");

		const concepts = conceptIds.map((id) => this.kg.getConcept(id)).filter(Boolean);
		if (concepts.length < 2) return [];

		const names = concepts.map((c) => c!.name).join(" and ");
		const questions: SelfTestQuestion[] = [];

		questions.push({
			conceptId: conceptIds.join(","),
			conceptName: names,
			question: `Compare and contrast ${names}. How do they relate to each other?`,
			type: "recall",
		});

		questions.push({
			conceptId: conceptIds.join(","),
			conceptName: names,
			question: `Given a scenario that involves both ${concepts[0]!.name} and ${concepts[1]!.name}, describe how you would apply both correctly.`,
			type: "application",
		});

		questions.push({
			conceptId: conceptIds.join(","),
			conceptName: names,
			question: `What happens when the rules of ${concepts[0]!.name} conflict with those of ${concepts[1]!.name}? How would you resolve this?`,
			type: "boundary",
		});

		return questions;
	}
}

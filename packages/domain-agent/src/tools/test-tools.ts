import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import { SelfTest } from "../self-test.ts";
import type { SelfTestResult } from "../types.ts";

const generateSelfTestSchema = Type.Object({
	conceptId: Type.String({ description: "ID of the concept to generate questions for" }),
});

const answerResultSchema = Type.Object({
	questionType: Type.String({ description: "Type: recall, application, or boundary" }),
	userAnswer: Type.String({ description: "The user's answer" }),
	expectedAnswer: Type.String({ description: "The expected correct answer" }),
	correct: Type.Boolean({ description: "Whether the answer was correct" }),
});

const recordSelfTestResultsSchema = Type.Object({
	conceptId: Type.String({ description: "ID of the concept being tested" }),
	results: Type.Array(answerResultSchema, { description: "Array of test results" }),
});

export function createGenerateSelfTestTool(kg: KnowledgeGraph): AgentTool<typeof generateSelfTestSchema> {
	const selfTest = new SelfTest(kg);

	return {
		name: "generate_self_test",
		label: "Generate Self Test",
		description: "Generate self-test questions (recall, application, boundary) for a concept in the knowledge graph.",
		parameters: generateSelfTestSchema,
		execute: async (_toolCallId, params: Static<typeof generateSelfTestSchema>): Promise<AgentToolResult<any>> => {
			const questions = selfTest.generateQuestions(params.conceptId);
			if (questions.length === 0) {
				return {
					content: [{ type: "text", text: `Concept not found: ${params.conceptId}` }],
					details: { questions: [] },
				};
			}

			const text = questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question}`).join("\n\n");

			return {
				content: [{ type: "text", text }],
				details: { questions },
			};
		},
	};
}

export function createRecordSelfTestResultsTool(kg: KnowledgeGraph): AgentTool<typeof recordSelfTestResultsSchema> {
	const selfTest = new SelfTest(kg);

	return {
		name: "record_self_test_results",
		label: "Record Self Test Results",
		description: "Record self-test results for a concept. Updates confidence based on performance.",
		parameters: recordSelfTestResultsSchema,
		execute: async (
			_toolCallId,
			params: Static<typeof recordSelfTestResultsSchema>,
		): Promise<AgentToolResult<any>> => {
			const concept = kg.getConcept(params.conceptId);
			if (!concept) {
				return {
					content: [{ type: "text", text: `Concept not found: ${params.conceptId}` }],
					details: { results: [] },
				};
			}

			const results: SelfTestResult[] = params.results.map((r) => ({
				conceptId: params.conceptId,
				question: {
					conceptId: params.conceptId,
					conceptName: concept.name,
					question: `[${r.questionType}] ${r.userAnswer}`,
					type: r.questionType as "recall" | "application" | "boundary",
				},
				userAnswer: r.userAnswer,
				expectedAnswer: r.expectedAnswer,
				correct: r.correct,
				explanation: r.correct ? "Correct" : `Expected: ${r.expectedAnswer}`,
			}));

			selfTest.updateConfidenceFromResults(results);
			const blindSpots = selfTest.analyzeResults(results);

			const correctCount = results.filter((r) => r.correct).length;
			const updated = kg.getConcept(params.conceptId);

			return {
				content: [
					{
						type: "text",
						text: `Results: ${correctCount}/${results.length} correct. Confidence: ${updated?.confidence.toFixed(2) ?? "?"}. Blind spots: ${blindSpots.length}`,
					},
				],
				details: { results, blindSpots, updatedConfidence: updated?.confidence },
			};
		},
	};
}

export function createCrossTestTool(kg: KnowledgeGraph): AgentTool<typeof crossTestSchema> {
	const selfTest = new SelfTest(kg);

	return {
		name: "generate_cross_test",
		label: "Generate Cross-Concept Test",
		description: "Generate test questions that span multiple concepts, testing understanding of their relationships.",
		parameters: crossTestSchema,
		execute: async (_toolCallId, params: Static<typeof crossTestSchema>): Promise<AgentToolResult<any>> => {
			const questions = selfTest.generateCrossConceptQuestions(params.conceptIds);
			if (questions.length === 0) {
				return {
					content: [{ type: "text", text: "Need at least one concept to generate cross-concept questions." }],
					details: { questions: [] },
				};
			}

			const text = questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question}`).join("\n\n");

			return {
				content: [{ type: "text", text }],
				details: { questions },
			};
		},
	};
}

const crossTestSchema = Type.Object({
	conceptIds: Type.Array(Type.String(), { description: "Array of concept IDs to test together" }),
});

export function createSelfTestTools(kg: KnowledgeGraph): AgentTool[] {
	return [createGenerateSelfTestTool(kg), createCrossTestTool(kg), createRecordSelfTestResultsTool(kg)];
}

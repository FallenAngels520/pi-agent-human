import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, registerFauxProvider, stream } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { CognitiveAgent, parseRoundResult } from "../src/cognitive-agent.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "analytical", instruction: "Analyze systematically." },
	{ name: "critical", instruction: "Question and find weaknesses." },
	{ name: "synthetic", instruction: "Synthesize into understanding." },
];

function jsonResponse(obj: Record<string, unknown>) {
	return fauxAssistantMessage([fauxText(JSON.stringify(obj))], {
		stopReason: "stop",
	});
}

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const reg of registrations.splice(0)) {
		reg.unregister();
	}
});

describe("parseRoundResult", () => {
	it("parses plain JSON", () => {
		const result = parseRoundResult(
			'{"findings": "Ownership is a core concept", "contradictions": "", "uncertainties": "How does borrowing work?", "confidence": 0.7}',
			1,
			"analytical",
		);
		expect(result).not.toBeNull();
		expect(result?.findings).toBe("Ownership is a core concept");
		expect(result?.confidence).toBe(0.7);
		expect(result?.round).toBe(1);
	});

	it("parses markdown-wrapped JSON", () => {
		const result = parseRoundResult(
			'Here is my analysis:\n\n```json\n{"findings": "Test", "contradictions": "None", "uncertainties": "Edge cases", "confidence": 0.5}\n```\n\nDone.',
			2,
			"critical",
		);
		expect(result).not.toBeNull();
		expect(result?.findings).toBe("Test");
		expect(result?.confidence).toBe(0.5);
	});

	it("parses JSON with surrounding text", () => {
		const result = parseRoundResult(
			'I found that {"findings": "Key insight", "confidence": 0.85, "contradictions": "", "uncertainties": ""} is the result.',
			3,
			"synthetic",
		);
		expect(result).not.toBeNull();
		expect(result?.findings).toBe("Key insight");
	});

	it("returns null for non-JSON text", () => {
		const result = parseRoundResult("Just some thoughts, no JSON here.", 1, "analytical");
		expect(result).toBeNull();
	});

	it("clamps confidence to [0, 1]", () => {
		const result = parseRoundResult(
			'{"findings": "x", "confidence": 1.5, "contradictions": "", "uncertainties": ""}',
			1,
			"analytical",
		);
		expect(result?.confidence).toBe(1);

		const result2 = parseRoundResult(
			'{"findings": "x", "confidence": -0.5, "contradictions": "", "uncertainties": ""}',
			1,
			"analytical",
		);
		expect(result2?.confidence).toBe(0);
	});
});

describe("CognitiveAgent", () => {
	it("learns a topic and runs self-test verification", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Phase 1: Learning rounds
		// Round 1: analytical, low confidence
		// Round 2: critical, high confidence (mastered)
		// Phase 2: Self-test response (mentions "Ownership" to pass)
		reg.setResponses([
			jsonResponse({
				findings: "Ownership means each value has exactly one owner.",
				contradictions: "",
				uncertainties: "How does borrowing work without transferring ownership?",
				confidence: 0.5,
			}),
			jsonResponse({
				findings: "Borrowing allows temporary access via references.",
				contradictions: "None",
				uncertainties: "",
				confidence: 0.85,
			}),
			// Self-test response
			fauxAssistantMessage(
				[
					fauxText(
						"Ownership is a fundamental concept in Rust. It means each value has exactly one owner. For application: when you pass a value to a function, ownership transfers. Edge cases: Copy types are exceptions.",
					),
				],
				{
					stopReason: "stop",
				},
			),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: {
				model: reg.getModel(),
				systemPrompt: "You are a learning agent. Respond with JSON only.",
			},
		});

		const cognitive = new CognitiveAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
		});

		const result = await cognitive.learn("Rust Ownership", [{ name: "Ownership", prerequisites: [] }]);

		expect(result.conceptsLearned).toBe(1);
		expect(result.totalRounds).toBe(2);

		// Self-test should have run
		expect(result.selfTestResults.length).toBeGreaterThan(0);

		// Round details should be populated
		expect(result.roundDetails.length).toBe(2);

		// Knowledge graph was populated
		const concepts = cognitive.knowledgeGraph.getAllConcepts();
		expect(concepts).toHaveLength(1);
		expect(concepts[0].name).toBe("Ownership");
		expect(concepts[0].confidence).toBeGreaterThan(0.5);
	});

	it("handles non-JSON responses gracefully", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Non-parseable response + self-test will also fail gracefully
		reg.setResponses([
			fauxAssistantMessage([fauxText("I'm not sure what JSON format you want.")], {
				stopReason: "stop",
			}),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: {
				model: reg.getModel(),
				systemPrompt: "You are a learning agent.",
			},
		});

		const cognitive = new CognitiveAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
		});

		const result = await cognitive.learn("Rust", [{ name: "Ownership", prerequisites: [] }]);

		// Should not crash — just 0 totalRounds since nothing was parseable
		expect(result.totalRounds).toBe(0);
		expect(result.selfTestResults).toHaveLength(0);
	});

	it("runs dreaming after learning and produces a playbook", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		reg.setResponses([
			jsonResponse({
				findings: "Ownership means each value has exactly one owner.",
				contradictions: "",
				uncertainties: "How does borrowing work?",
				confidence: 0.5,
			}),
			jsonResponse({
				findings: "Borrowing allows temporary access via references.",
				contradictions: "None",
				uncertainties: "",
				confidence: 0.85,
			}),
			fauxAssistantMessage(
				[
					fauxText(
						"Ownership is a fundamental concept. Ownership means each value has one owner. For application: passing values transfers ownership. Edge cases: Copy types.",
					),
				],
				{
					stopReason: "stop",
				},
			),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: {
				model: reg.getModel(),
				systemPrompt: "You are a learning agent. Respond with JSON only.",
			},
		});

		const cognitive = new CognitiveAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			dreamingEnabled: true,
		});

		const result = await cognitive.learn("Rust Ownership", [{ name: "Ownership", prerequisites: [] }]);

		// Dreaming should have produced a result
		expect(result.dreaming).toBeDefined();
		expect(result.dreaming!.playbook).toBeDefined();
		expect(result.dreaming!.playbook.domain).toBe("Rust Ownership");
		expect(result.dreaming!.playbook.version).toBe(1);

		// Playbook should have principles
		expect(result.dreaming!.principlesExtracted).toBeGreaterThan(0);

		// Playbook should be stored on the agent
		expect(cognitive.currentPlaybook).toBeDefined();
		expect(cognitive.currentPlaybook!.version).toBe(1);

		// Playbook context should be injectable
		const ctx = cognitive.getPlaybookContext();
		expect(ctx).toContain("Learning Playbook");
		expect(ctx).toContain("Rust Ownership");
	});

	it("dreaming can be disabled", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		reg.setResponses([
			jsonResponse({
				findings: "Test",
				contradictions: "",
				uncertainties: "",
				confidence: 0.85,
			}),
			fauxAssistantMessage([fauxText("Test concept is about testing. Test helps verify correctness.")], {
				stopReason: "stop",
			}),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: {
				model: reg.getModel(),
				systemPrompt: "You are a learning agent. Respond with JSON only.",
			},
		});

		const cognitive = new CognitiveAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			dreamingEnabled: false,
		});

		const result = await cognitive.learn("Test", [{ name: "TestConcept", prerequisites: [] }]);

		expect(result.dreaming).toBeUndefined();
		expect(cognitive.currentPlaybook).toBeUndefined();
	});

	it("playbook chains across multiple learn() calls", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Session 1 responses
		reg.setResponses([
			jsonResponse({ findings: "Session 1 findings", contradictions: "", uncertainties: "", confidence: 0.85 }),
			fauxAssistantMessage([fauxText("Concept A is about memory management. Concept A ownership rules.")], {
				stopReason: "stop",
			}),
			// Session 2 responses (run in same cognitive agent)
			jsonResponse({ findings: "Session 2 findings", contradictions: "", uncertainties: "", confidence: 0.9 }),
			fauxAssistantMessage([fauxText("Concept B extends Concept A. Concept B borrowing rules.")], {
				stopReason: "stop",
			}),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: {
				model: reg.getModel(),
				systemPrompt: "You are a learning agent. Respond with JSON only.",
			},
		});

		const cognitive = new CognitiveAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			dreamingEnabled: true,
		});

		// First learning session
		const result1 = await cognitive.learn("Session1", [{ name: "ConceptA", prerequisites: [] }]);
		expect(result1.dreaming!.playbook.version).toBe(1);

		// Second learning session — playbook should chain
		const result2 = await cognitive.learn("Session2", [{ name: "ConceptB", prerequisites: [] }]);
		expect(result2.dreaming!.playbook.version).toBe(2);

		// Playbook context should contain version 2
		expect(cognitive.currentPlaybook!.version).toBe(2);
	});
});

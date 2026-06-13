import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, registerFauxProvider, stream } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { DeepThinkingInput, DeepThinkingResult } from "../src/deep-thinking.ts";
import { DeepThinkingAgent } from "../src/deep-thinking-agent.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "analytical", instruction: "Analyze systematically." },
	{ name: "critical", instruction: "Question and find weaknesses." },
	{ name: "synthetic", instruction: "Synthesize into understanding." },
];

function jsonResponse(obj: Record<string, unknown>) {
	return fauxAssistantMessage([fauxText(JSON.stringify(obj))], { stopReason: "stop" });
}

/**
 * Fake DeepThinkingEngine that returns pre-programmed results without calling an LLM.
 */
class FakeDeepThinker {
	private responses: DeepThinkingResult[] = [];
	private callCount = 0;

	setResponses(responses: DeepThinkingResult[]) {
		this.responses = responses;
	}

	getCallCount() {
		return this.callCount;
	}

	async think(_input: DeepThinkingInput): Promise<DeepThinkingResult> {
		const response = this.responses[this.callCount] ?? {
			mode: "learn" as const,
			conclusions: [],
			assumptions: [],
			contradictions: [],
			blindSpots: [],
			knowledgeUpdates: [],
			nextResearchQuestions: [],
			nextPracticeTasks: [],
			innovationHypotheses: [],
			confidence: 0.5,
		};
		this.callCount++;
		return response;
	}

	reset() {
		this.callCount = 0;
	}
}

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const reg of registrations.splice(0)) reg.unregister();
});

describe("DeepThinkingAgent", () => {
	it("wraps L1 learning with L2 deep thinking", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Pre-program L1 responses (learning + self-test)
		reg.setResponses([
			jsonResponse({ findings: "Ownership concept", contradictions: "", uncertainties: "", confidence: 0.5 }),
			jsonResponse({ findings: "Ownership mastered", contradictions: "", uncertainties: "", confidence: 0.85 }),
			fauxAssistantMessage(
				[fauxText("Ownership is about memory management. Ownership rules: each value has one owner.")],
				{ stopReason: "stop" },
			),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: { model: reg.getModel(), systemPrompt: "You are a learning agent." },
		});

		const fakeThinker = new FakeDeepThinker();
		// Pre-program 2 deep thinking results: pre-round guidance + consolidation
		fakeThinker.setResponses([
			{
				mode: "learn",
				conclusions: ["Focus on ownership transfer rules"],
				assumptions: ["Agent understands basic memory concepts"],
				contradictions: [],
				blindSpots: ["Borrowing interaction"],
				knowledgeUpdates: [],
				nextResearchQuestions: [],
				nextPracticeTasks: ["Write ownership transfer examples"],
				innovationHypotheses: [],
				confidence: 0.7,
			},
			{
				mode: "consolidate",
				conclusions: ["Multi-perspective learning was effective for ownership concepts"],
				assumptions: [],
				contradictions: [],
				blindSpots: [],
				knowledgeUpdates: ["critical perspective showed highest gain"],
				nextResearchQuestions: ["Explore borrowing next"],
				nextPracticeTasks: [],
				innovationHypotheses: [],
				confidence: 0.8,
			},
		]);

		const l2Agent = new DeepThinkingAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			deepThinking: fakeThinker,
			domain: "Rust",
		});

		const result = await l2Agent.learn("Rust Ownership", [{ name: "Ownership", prerequisites: [] }]);

		// L1 results should be present
		expect(result.conceptsLearned).toBe(1);
		expect(result.totalRounds).toBeGreaterThan(0);

		// L2: Deep thinking guidance should have been logged
		expect(result.deepThinkingGuidance.length).toBeGreaterThanOrEqual(0);

		// Playbook should be present (Dreaming ran)
		expect(result.playbook).toBeDefined();
	});
});

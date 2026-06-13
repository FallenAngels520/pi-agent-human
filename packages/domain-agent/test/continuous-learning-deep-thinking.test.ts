import { Agent } from "@earendil-works/pi-agent-core";
import {
	fauxAssistantMessage,
	fauxText,
	type ProviderStreamOptions,
	registerFauxProvider,
	stream,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { ContinuousLearningAgent } from "../src/continuous-learning-agent.ts";
import type { DeepThinkingInput, DeepThinkingResult } from "../src/deep-thinking.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [{ name: "analysis", instruction: "Analyze the concept carefully." }];

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

function jsonResponse(value: Record<string, unknown>) {
	return fauxAssistantMessage([fauxText(JSON.stringify(value))], { stopReason: "stop" });
}

function createAgent(registration: ReturnType<typeof registerFauxProvider>): Agent {
	return new Agent({
		streamFn: (model, context, options) => stream(model, context, options as ProviderStreamOptions | undefined),
		initialState: {
			model: registration.getModel(),
			systemPrompt: "You are a learning agent. Respond with JSON when asked.",
		},
	});
}

class RecordingDeepThinking {
	readonly calls: DeepThinkingInput[] = [];

	async think(input: DeepThinkingInput): Promise<DeepThinkingResult> {
		this.calls.push(input);
		return {
			mode: input.mode,
			conclusions: [`${input.mode} conclusion`],
			assumptions: [`${input.mode} assumption`],
			contradictions: [],
			blindSpots: input.mode === "reflect" ? ["Borrowing examples are missing"] : [],
			knowledgeUpdates: [`${input.mode} knowledge update`],
			nextResearchQuestions: [`${input.mode} research question`],
			nextPracticeTasks: [`${input.mode} practice task`],
			innovationHypotheses: input.mode === "innovate" ? ["Try a new analogy"] : [],
			confidence: 0.7,
		};
	}
}

describe("ContinuousLearningAgent deep thinking integration", () => {
	it("uses deep thinking during learn, apply, and reflect phases", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			jsonResponse({
				findings: "Ownership means each value has one owner.",
				contradictions: "",
				uncertainties: "",
				confidence: 0.85,
			}),
			jsonResponse({
				passed: true,
				confidence: 0.9,
				summary: "The concept is clear.",
				criteria: [{ name: "clarity", passed: true, reasoning: "Clear explanation." }],
			}),
			fauxAssistantMessage([fauxText("Ownership recall. Ownership application. Ownership boundary.")], {
				stopReason: "stop",
			}),
			jsonResponse({
				exercise: "Use ownership in a small program.",
				solution: "Move a value into a function.",
				reflection: "Need more borrowing examples.",
				gapsIdentified: ["Borrowing examples"],
			}),
		]);

		const agent = createAgent(registration);
		const deepThinking = new RecordingDeepThinking();
		const continuous = new ContinuousLearningAgent({
			agent,
			perspectives: PERSPECTIVES,
			verifierModel: registration.getModel(),
			maxRounds: 2,
			confidenceThreshold: 0.8,
			plateauThreshold: 2,
			maxConceptsPerSession: 1,
			practicalApplicationEnabled: true,
			frontierExpansionEnabled: false,
			domain: "Rust ownership",
			deepThinking,
		});
		continuous.seedConcepts("Rust ownership", ["Ownership"]);

		await continuous.run();

		expect(deepThinking.calls.map((call) => call.mode)).toEqual(["learn", "apply", "reflect"]);
		expect(deepThinking.calls[0]).toMatchObject({
			domain: "Rust ownership",
			objective: "Deeply understand and master the concept: Ownership",
			mode: "learn",
		});
		expect(deepThinking.calls[1].knowledgeSummary).toContain("Ownership");
		expect(deepThinking.calls[2].failures).toContain("Borrowing examples");
	});

	it("uses evolve deep thinking before periodic synthesis", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			jsonResponse({ findings: "A mastered.", contradictions: "", uncertainties: "", confidence: 0.85 }),
			jsonResponse({ passed: true, confidence: 0.9, summary: "A clear.", criteria: [] }),
			fauxAssistantMessage([fauxText("A recall. A application. A boundary.")], { stopReason: "stop" }),
			jsonResponse({ findings: "B mastered.", contradictions: "", uncertainties: "", confidence: 0.85 }),
			jsonResponse({ passed: true, confidence: 0.9, summary: "B clear.", criteria: [] }),
			fauxAssistantMessage([fauxText("B recall. B application. B boundary.")], { stopReason: "stop" }),
			jsonResponse({ findings: "C mastered.", contradictions: "", uncertainties: "", confidence: 0.85 }),
			jsonResponse({ passed: true, confidence: 0.9, summary: "C clear.", criteria: [] }),
			fauxAssistantMessage([fauxText("C recall. C application. C boundary.")], { stopReason: "stop" }),
			fauxAssistantMessage([fauxText("Synthesis ".repeat(40))], { stopReason: "stop" }),
		]);

		const deepThinking = new RecordingDeepThinking();
		const continuous = new ContinuousLearningAgent({
			agent: createAgent(registration),
			perspectives: PERSPECTIVES,
			verifierModel: registration.getModel(),
			maxRounds: 1,
			confidenceThreshold: 0.8,
			plateauThreshold: 1,
			maxConceptsPerSession: 3,
			practicalApplicationEnabled: false,
			frontierExpansionEnabled: false,
			domain: "Domain evolution",
			deepThinking,
		});
		continuous.seedConcepts("Domain evolution", ["A", "B", "C"]);

		await continuous.run();

		expect(deepThinking.calls.map((call) => call.mode)).toContain("evolve");
		const evolveCall = deepThinking.calls.find((call) => call.mode === "evolve");
		expect(evolveCall?.objective).toContain("Synthesize mastered concepts");
		expect(evolveCall?.knowledgeSummary).toContain("A");
		expect(evolveCall?.knowledgeSummary).toContain("B");
		expect(evolveCall?.knowledgeSummary).toContain("C");
	});

	it("uses innovate deep thinking before frontier expansion", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			jsonResponse({
				hypotheses: [{ statement: "Frontier idea", rationale: "Novel connection", confidence: 0.3 }],
			}),
			jsonResponse({ findings: "Frontier idea learned.", contradictions: "", uncertainties: "", confidence: 0.85 }),
			jsonResponse({ passed: true, confidence: 0.9, summary: "Frontier clear.", criteria: [] }),
			fauxAssistantMessage([fauxText("Frontier idea recall. Frontier idea application. Frontier idea boundary.")], {
				stopReason: "stop",
			}),
		]);

		const deepThinking = new RecordingDeepThinking();
		const continuous = new ContinuousLearningAgent({
			agent: createAgent(registration),
			perspectives: PERSPECTIVES,
			verifierModel: registration.getModel(),
			maxRounds: 1,
			confidenceThreshold: 0.8,
			plateauThreshold: 1,
			maxConceptsPerSession: 1,
			practicalApplicationEnabled: false,
			frontierExpansionEnabled: true,
			domain: "Frontier domain",
			deepThinking,
		});
		const graph = continuous.getKnowledgeGraph();
		graph.addConcept({
			id: "blocked-frontier",
			name: "Blocked Frontier",
			description: "A blocked low-confidence frontier",
			confidence: 0.2,
			evidence: [],
			relations: [{ fromId: "missing-prereq", toId: "blocked-frontier", type: "prerequisite_of", confidence: 1 }],
			status: "not_started",
			createdAt: Date.now(),
			lastReviewedAt: Date.now(),
		});
		graph.addRelation({
			fromId: "missing-prereq",
			toId: "blocked-frontier",
			type: "prerequisite_of",
			confidence: 1,
		});

		await continuous.run();

		expect(deepThinking.calls.map((call) => call.mode)).toContain("innovate");
		const innovateCall = deepThinking.calls.find((call) => call.mode === "innovate");
		expect(innovateCall?.objective).toContain("Blocked Frontier");
		expect(innovateCall?.observations).toContain("Confidence 0.2 below threshold 0.4");
	});
});

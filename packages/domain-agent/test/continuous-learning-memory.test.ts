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
import type {
	DistilledKnowledge,
	DistilledKnowledgeInput,
	DistilledKnowledgeQuery,
	LongTermMemoryContext,
	LongTermMemoryEvent,
	LongTermMemoryEventInput,
	LongTermMemoryLike,
	LongTermMemoryQuery,
} from "../src/long-term-memory.ts";
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
			assumptions: [],
			contradictions: [],
			blindSpots: [],
			knowledgeUpdates: [`${input.mode} update`],
			nextResearchQuestions: [],
			nextPracticeTasks: [],
			innovationHypotheses: [],
			confidence: 0.7,
		};
	}
}

class RecordingMemory implements LongTermMemoryLike {
	readonly events: LongTermMemoryEventInput[] = [];
	readonly contextQueries: LongTermMemoryQuery[] = [];

	async recordEvent(input: LongTermMemoryEventInput): Promise<LongTermMemoryEvent> {
		this.events.push(input);
		return { id: `event-${this.events.length}`, createdAt: new Date(this.events.length).toISOString(), ...input };
	}

	async buildContext(query: LongTermMemoryQuery): Promise<LongTermMemoryContext> {
		this.contextQueries.push(query);
		return {
			summary: "Memory context: prior application failed because borrowing examples were missing.",
			searchResults: [
				{
					id: "event-previous",
					type: "failure_event",
					title: "Borrowing example gap",
					score: 2,
					createdAt: "2026-06-10T00:00:00.000Z",
				},
			],
			timeline: [],
			events: [],
			drawers: [],
			summaries: [],
			temporalFacts: [],
			distilledKnowledge: [],
		};
	}
	async recordDistilledKnowledge(input: DistilledKnowledgeInput): Promise<DistilledKnowledge> {
		return {
			id: "dk-1",
			createdAt: new Date().toISOString(),
			utilityScore: 0,
			lastRecalledAt: new Date().toISOString(),
			consolidationCount: 1,
			...input,
		};
	}
	async retrieveDistilledKnowledge(_query: DistilledKnowledgeQuery): Promise<DistilledKnowledge[]> {
		return [];
	}
	async recordDistilledRecall(_ids: string[]): Promise<void> {}
	async pruneStaleKnowledge(_domain?: string): Promise<number> {
		return 0;
	}
}

describe("ContinuousLearningAgent long-term memory integration", () => {
	it("loads memory into deep thinking and records each learning phase", async () => {
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

		const deepThinking = new RecordingDeepThinking();
		const memory = new RecordingMemory();
		const continuous = new ContinuousLearningAgent({
			agent: createAgent(registration),
			perspectives: PERSPECTIVES,
			verifierModel: registration.getModel(),
			maxRounds: 1,
			confidenceThreshold: 0.8,
			plateauThreshold: 1,
			maxConceptsPerSession: 1,
			practicalApplicationEnabled: true,
			frontierExpansionEnabled: false,
			domain: "Rust ownership",
			deepThinking,
			longTermMemory: memory,
		});
		continuous.seedConcepts("Rust ownership", ["Ownership"]);

		await continuous.run();

		// v2: failurePrevention (undefined) + learn + apply + reflect + consolidate
		expect(memory.contextQueries.map((query) => query.mode)).toEqual([
			undefined,
			"learn",
			"apply",
			"reflect",
			"consolidate",
		]);
		expect(memory.contextQueries[1].path).toMatchObject({
			domain: "Rust ownership",
			capability: "learning",
			concept: "Ownership",
			situation: "Deeply understand and master the concept: Ownership",
		});
		expect(memory.contextQueries[2].path).toMatchObject({
			capability: "application",
			concept: "Ownership",
		});
		expect(memory.contextQueries[3].path).toMatchObject({
			capability: "reflection",
			concept: "Ownership",
		});
		expect(deepThinking.calls[1].knowledgeSummary).toContain("Memory context: prior application failed");
		// v2: 7 events total (extra consolidate deep_thinking at end)
		expect(memory.events.map((event) => event.type)).toEqual([
			"deep_thinking",
			"learning_event",
			"verification_event",
			"deep_thinking",
			"deep_thinking",
			"application_event",
			"deep_thinking",
		]);
		expect(memory.events[1]).toMatchObject({
			domain: "Rust ownership",
			conceptName: "Ownership",
			type: "learning_event",
		});
		expect(memory.events[5].text).toContain("Need more borrowing examples");
	});
});

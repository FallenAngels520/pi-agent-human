import { fauxAssistantMessage, fauxText, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildDeepThinkingPrompt,
	DeepThinkingEngine,
	type DeepThinkingInput,
	parseDeepThinkingResult,
} from "../src/deep-thinking.ts";

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

describe("buildDeepThinkingPrompt", () => {
	it("includes mode-specific guidance and supplied context", () => {
		const input: DeepThinkingInput = {
			domain: "AI Agent Engineering",
			objective: "Understand long-running agent verification",
			mode: "reflect",
			knowledgeSummary: "Agent loops interleave model calls and tools.",
			evidence: ["GoalLoop verifies after each iteration."],
			observations: ["The worker stopped early."],
			failures: ["The agent claimed success without tests."],
			constraints: ["Do not mutate the knowledge graph directly."],
			maxOutputItems: 3,
		};

		const prompt = buildDeepThinkingPrompt(input);

		expect(prompt).toContain("Domain: AI Agent Engineering");
		expect(prompt).toContain("Mode: reflect");
		expect(prompt).toContain("root causes");
		expect(prompt).toContain("Agent loops interleave model calls and tools.");
		expect(prompt).toContain("GoalLoop verifies after each iteration.");
		expect(prompt).toContain("The worker stopped early.");
		expect(prompt).toContain("The agent claimed success without tests.");
		expect(prompt).toContain("Do not mutate the knowledge graph directly.");
		expect(prompt).toContain("Return JSON only");
		expect(prompt).toContain("At most 3 items");
	});
});

describe("parseDeepThinkingResult", () => {
	it("parses plain JSON results", () => {
		const parsed = parseDeepThinkingResult(
			JSON.stringify({
				mode: "learn",
				conclusions: ["Concept A matters"],
				assumptions: ["Source is reliable"],
				contradictions: [],
				blindSpots: ["Need examples"],
				knowledgeUpdates: ["Add Concept A"],
				nextResearchQuestions: ["What evidence supports A?"],
				nextPracticeTasks: ["Apply A to a toy task"],
				innovationHypotheses: [],
				confidence: 0.75,
			}),
		);

		expect(parsed).toEqual({
			mode: "learn",
			conclusions: ["Concept A matters"],
			assumptions: ["Source is reliable"],
			contradictions: [],
			blindSpots: ["Need examples"],
			knowledgeUpdates: ["Add Concept A"],
			nextResearchQuestions: ["What evidence supports A?"],
			nextPracticeTasks: ["Apply A to a toy task"],
			innovationHypotheses: [],
			confidence: 0.75,
		});
	});

	it("parses fenced JSON and clamps confidence while defaulting missing arrays", () => {
		const parsed = parseDeepThinkingResult(`Here is the result:

\`\`\`json
{
  "mode": "innovate",
  "conclusions": ["Combine two methods"],
  "confidence": 1.8
}
\`\`\``);

		expect(parsed).toEqual({
			mode: "innovate",
			conclusions: ["Combine two methods"],
			assumptions: [],
			contradictions: [],
			blindSpots: [],
			knowledgeUpdates: [],
			nextResearchQuestions: [],
			nextPracticeTasks: [],
			innovationHypotheses: [],
			confidence: 1,
		});
	});

	it("rejects unsupported modes", () => {
		const parsed = parseDeepThinkingResult(
			JSON.stringify({
				mode: "unsupported",
				conclusions: ["No"],
				confidence: 0.5,
			}),
		);

		expect(parsed).toBeNull();
	});
});

describe("DeepThinkingEngine", () => {
	it("returns a low-confidence fallback when the model response is not structured JSON", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			fauxAssistantMessage([fauxText("I need more time to think about this.")], {
				stopReason: "stop",
			}),
		]);

		const engine = new DeepThinkingEngine({ model: registration.getModel() });
		const result = await engine.think({
			domain: "AI Agent Engineering",
			objective: "Reflect on a failed autonomous learning attempt",
			mode: "reflect",
		});

		expect(result.mode).toBe("reflect");
		expect(result.confidence).toBe(0);
		expect(result.blindSpots[0]).toContain("could not be parsed");
		expect(result.blindSpots[0]).toContain("I need more time");
	});
});

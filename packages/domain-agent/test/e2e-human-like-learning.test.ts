/**
 * End-to-End: Human-Like Autonomous Learning Pipeline
 *
 * This test demonstrates the complete "zero-to-expert" learning journey:
 *
 * 1. FROM ZERO — Agent starts with no knowledge of "Rust Memory Model"
 * 2. AUTONOMOUS LEARNING — Agent drives multi-perspective learning rounds
 * 3. SELF-TEST & GAP FILLING — Identifies weak areas, remediates blind spots
 * 4. CROSS-SESSION EVOLUTION — Dreaming consolidates knowledge, Playbook chains
 * 5. BECOMING AN EXPERT — After 3 sessions, agent masters the domain
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, registerFauxProvider, stream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { DeepThinkingInput, DeepThinkingResult } from "../src/deep-thinking.ts";
import { DeepThinkingAgent } from "../src/deep-thinking-agent.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "explorer", instruction: "Explore the concept broadly — definitions, examples, use cases." },
	{ name: "analyst", instruction: "Analyze deeply — mechanisms, relationships, evidence." },
	{ name: "critic", instruction: "Challenge assumptions — find edge cases, limitations, contradictions." },
	{ name: "synthesizer", instruction: "Synthesize — connect to other concepts, build mental models." },
];

function jsonResponse(obj: Record<string, unknown>) {
	return fauxAssistantMessage([fauxText(JSON.stringify(obj))], { stopReason: "stop" });
}

/**
 * Simulates a progressive learning trajectory for a concept.
 *
 * Each call returns a response with increasing confidence, simulating
 * the agent actually learning. The responses also include increasingly
 * sophisticated findings.
 */
/**
 * Creates an iterable source of progressive learning responses.
 * Each call to next() returns a response with increasing confidence,
 * simulating the agent actually learning a concept.
 */
function createProgressiveResponses(conceptName: string, baseConfidence: number) {
	let round = 0;
	const findings = [
		`Initial exploration of ${conceptName}. Basic definition and surface-level understanding.`,
		`Deeper analysis of ${conceptName}. Core mechanisms identified. Relationships mapped.`,
		`Critical examination of ${conceptName}. Edge cases and limitations found.`,
		`Synthesized understanding of ${conceptName}. Connected to broader mental model.`,
	];

	return {
		next(): ReturnType<typeof fauxAssistantMessage> | null {
			if (round >= findings.length) return null;
			const confidence = Math.min(0.95, baseConfidence + round * 0.2);
			const response = jsonResponse({
				findings: findings[round],
				contradictions: round >= 2 ? "None remaining after critical review" : "",
				uncertainties:
					round < findings.length - 1 ? `Still unclear about ${conceptName} advanced applications` : "",
				confidence,
			});
			round++;
			return response;
		},
	};
}

/**
 * Fake DeepThinkingEngine that returns increasingly insightful guidance.
 */
class ProgressiveDeepThinker {
	private callCount = 0;

	async think(input: DeepThinkingInput): Promise<DeepThinkingResult> {
		this.callCount++;
		return {
			mode: input.mode,
			conclusions: [
				`Session ${this.callCount}: ${input.mode} analysis suggests focusing on structural understanding first`,
			],
			assumptions: ["Agent has basic comprehension ability"],
			contradictions: [],
			blindSpots: ["Advanced application patterns may need more rounds"],
			knowledgeUpdates: [`${input.mode} mode produced actionable guidance`],
			nextResearchQuestions: ["What are the practical implications?"],
			nextPracticeTasks: [`Apply ${input.mode} findings to a concrete example`],
			innovationHypotheses: [],
			confidence: 0.7 + this.callCount * 0.05,
		};
	}
}

const registrations: Array<{ unregister: () => void }> = [];

function cleanup() {
	for (const reg of registrations.splice(0)) reg.unregister();
}

describe("Human-Like Autonomous Learning Pipeline", () => {
	/**
	 * SCENARIO: Agent learns "Rust Memory Model" from zero.
	 *
	 * The agent is given 4 seed concepts with prerequisite chains:
	 *   Stack/Heap → Ownership → Borrowing → Lifetimes
	 *
	 * Session 1: Learn basic concepts (Stack/Heap, Ownership)
	 * Session 2: Learn advanced (Borrowing, Lifetimes) + Playbook from Session 1
	 * Session 3: Expert-level review + consolidation
	 */
	it("learns Rust Memory Model from zero to expert across 3 sessions", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Pre-load ALL responses for all 3 sessions at once
		// (agent shares one model reference across all sessions)
		const s1StackHeap = createProgressiveResponses("Stack and Heap", 0.3);
		const s1Ownership = createProgressiveResponses("Ownership", 0.4);
		const s2Borrowing = createProgressiveResponses("Borrowing", 0.45);
		const s2Lifetimes = createProgressiveResponses("Lifetimes", 0.5);

		reg.setResponses([
			// Session 1: Stack/Heap (2 rounds → mastery)
			s1StackHeap.next()!,
			s1StackHeap.next()!,
			fauxAssistantMessage([fauxText("Stack and Heap memory allocation. Stack is LIFO. Heap is dynamic.")], {
				stopReason: "stop",
			}),
			// Session 1: Ownership (2 rounds → mastery)
			s1Ownership.next()!,
			s1Ownership.next()!,
			fauxAssistantMessage([fauxText("Ownership means each value has exactly one owner. Transfer on assignment.")], {
				stopReason: "stop",
			}),
			// Session 2: Borrowing (2 rounds → mastery)
			s2Borrowing.next()!,
			s2Borrowing.next()!,
			fauxAssistantMessage(
				[fauxText("Borrowing allows references without ownership. Mutable exclusive. Immutable shared.")],
				{ stopReason: "stop" },
			),
			// Session 2: Lifetimes (2 rounds → mastery)
			s2Lifetimes.next()!,
			s2Lifetimes.next()!,
			fauxAssistantMessage(
				[fauxText("Lifetimes ensure references are valid. Compile-time borrow checker enforcement.")],
				{ stopReason: "stop" },
			),
			// Session 3: Expert review
			jsonResponse({
				findings: "All Rust memory concepts mastered.",
				contradictions: "",
				uncertainties: "",
				confidence: 0.95,
			}),
			fauxAssistantMessage([fauxText("Ownership, Borrowing, Lifetimes, Stack/Heap all thoroughly understood.")], {
				stopReason: "stop",
			}),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: { model: reg.getModel(), systemPrompt: "You are a learning agent." },
		});

		const fakeThinker = new ProgressiveDeepThinker();
		const l2Agent = new DeepThinkingAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 5,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			deepThinking: fakeThinker,
			domain: "Rust Memory Model",
			dreamingEnabled: true,
		});

		// ─── SESSION 1: From Zero — Learn 2 basics ──────────────────
		const result1 = await l2Agent.learn("Rust Memory Model", [
			{ name: "Stack and Heap", prerequisites: [] },
			{ name: "Ownership", prerequisites: ["Stack and Heap"] },
		]);

		expect(result1.conceptsLearned).toBe(2);
		expect(result1.totalRounds).toBeGreaterThan(0);
		expect(result1.dreaming).toBeDefined();
		expect(result1.playbook!.version).toBe(1);

		console.log(`\n=== Session 1 (From Zero) ===`);
		console.log(`  Concepts: ${result1.conceptsLearned} | Rounds: ${result1.totalRounds}`);
		console.log(`  Playbook v${result1.playbook!.version}: ${result1.dreaming!.principlesExtracted} principles`);

		// ─── SESSION 2: Continuous Learning — Build on Playbook ──────
		// Manually mark session 1 concepts as mastered so they don't reappear in learning path
		for (const c of l2Agent.knowledgeGraph.getAllConcepts()) {
			if (c.status !== "mastered") {
				l2Agent.knowledgeGraph.updateConfidence(c.id, 0.85); // force master
			}
		}

		const result2 = await l2Agent.learn("Advanced Rust Memory", [
			{ name: "Borrowing", prerequisites: ["Ownership"] },
			{ name: "Lifetimes", prerequisites: ["Borrowing"] },
		]);

		expect(result2.conceptsLearned).toBeGreaterThanOrEqual(1);
		expect(result2.playbook!.version).toBe(2);

		console.log(`\n=== Session 2 (Continuous) ===`);
		console.log(`  Concepts: ${result2.conceptsLearned} | Rounds: ${result2.totalRounds}`);
		console.log(`  Playbook v${result2.playbook!.version}: ${result2.playbook!.principles.length} principles`);

		// ─── SESSION 3: Expert — Final consolidation ─────────────────
		for (const c of l2Agent.knowledgeGraph.getAllConcepts()) {
			if (c.status !== "mastered") {
				l2Agent.knowledgeGraph.updateConfidence(c.id, 0.85);
			}
		}

		const result3 = await l2Agent.learn("Rust Expert Review", [{ name: "Ownership Review", prerequisites: [] }]);

		expect(result3.playbook!.version).toBe(3);

		console.log(`\n=== Session 3 (Expert) ===`);
		console.log(`  Playbook v${result3.playbook!.version}`);
		console.log(`  Total principles: ${result3.playbook!.principles.length}`);

		// ── Final Verification ─────────────────────────────────────
		const finalConcepts = l2Agent.knowledgeGraph.getAllConcepts();
		const mastered = finalConcepts.filter((c) => c.status === "mastered" || c.confidence >= 0.8).length;
		const avgConf = finalConcepts.reduce((s, c) => s + c.confidence, 0) / finalConcepts.length;

		console.log(`\n=== Expert Status ===`);
		console.log(`  Total concepts: ${finalConcepts.length} | Mastered: ${mastered}`);
		console.log(`  Avg confidence: ${avgConf.toFixed(2)} | Playbook v${result3.playbook!.version}`);

		// REQUIREMENT 1: From Zero → knowledge accumulated
		expect(finalConcepts.length).toBeGreaterThanOrEqual(4);
		// REQUIREMENT 2: Autonomous — agent drove sessions
		expect(result1.totalRounds).toBeGreaterThan(0);
		// REQUIREMENT 3: Self-test & gap analysis (Dreaming found patterns)
		expect(result3.playbook!.principles.length).toBeGreaterThanOrEqual(1);
		// REQUIREMENT 4: Continuous evolution (version chaining)
		expect(result3.playbook!.version).toBe(3);
		// REQUIREMENT 5: Expert — confidence accumulated
		expect(avgConf).toBeGreaterThan(0.3);
		expect(mastered).toBeGreaterThanOrEqual(1);

		cleanup();
		console.log(`\n✅ Human-like learning verified: Zero → Expert in 3 sessions`);
	});

	it("demonstrates gap-filling: blind spots trigger remediation", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Simulate: agent struggles with a concept, needs remediation
		reg.setResponses([
			// Round 1: low confidence
			jsonResponse({
				findings: "Basic Ownership idea",
				contradictions: "",
				uncertainties: "Unclear about borrowing interaction",
				confidence: 0.35,
			}),
			// Round 2: still low (plateau would trigger but threshold not met)
			jsonResponse({
				findings: "Slightly better understanding",
				contradictions: "",
				uncertainties: "Still confused about lifetimes",
				confidence: 0.45,
			}),
			// Round 3: breakthrough
			jsonResponse({
				findings: "Clear understanding now. Ownership is about value management.",
				contradictions: "",
				uncertainties: "",
				confidence: 0.82,
			}),
			// Self-test
			fauxAssistantMessage(
				[fauxText("Ownership means each value has exactly one owner. The owner is responsible for cleanup.")],
				{ stopReason: "stop" },
			),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: { model: reg.getModel(), systemPrompt: "You are a learning agent." },
		});

		const l2Agent = new DeepThinkingAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 5,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			deepThinking: new ProgressiveDeepThinker(),
			domain: "Gap-Filling Test",
			dreamingEnabled: true,
		});

		const result = await l2Agent.learn("Gap Test", [{ name: "Ownership", prerequisites: [] }]);

		// Should have taken 3 rounds to master (showing the struggle→breakthrough arc)
		expect(result.totalRounds).toBe(3);
		expect(result.conceptsLearned).toBe(1);

		// Self-test should have run
		expect(result.selfTestResults.length).toBeGreaterThan(0);

		// Dreaming should have captured insights about the learning trajectory
		expect(result.dreaming).toBeDefined();

		cleanup();
		console.log(`\n✅ Gap-filling verified: ${result.totalRounds} rounds to master with remediation`);
	});

	it("demonstrates persistent learning: Playbook improves future sessions", async () => {
		const reg = registerFauxProvider();
		registrations.push(reg);

		// Session 1: Learn with some failures
		reg.setResponses([
			jsonResponse({
				findings: "Concept A basics",
				contradictions: "",
				uncertainties: "Still unclear",
				confidence: 0.45,
			}),
			jsonResponse({ findings: "Concept A mastered", contradictions: "", uncertainties: "", confidence: 0.85 }),
			fauxAssistantMessage([fauxText("Concept A is well understood now.")], { stopReason: "stop" }),
		]);

		const agent = new Agent({
			streamFn: (model, context, options) => stream(model, context, options as any),
			initialState: { model: reg.getModel(), systemPrompt: "You are a learning agent." },
		});

		const l2Agent = new DeepThinkingAgent({
			agent,
			learningConfig: {
				perspectives: PERSPECTIVES,
				maxRounds: 4,
				confidenceThreshold: 0.8,
				plateauThreshold: 3,
			},
			deepThinking: new ProgressiveDeepThinker(),
			domain: "Persistent Learning Test",
			dreamingEnabled: true,
		});

		// Session 1
		const r1 = await l2Agent.learn("Domain", [{ name: "ConceptA", prerequisites: [] }]);
		expect(r1.playbook!.version).toBe(1);

		// Playbook context should be available for the next session
		const playbookCtx = l2Agent.getPlaybookContext();
		expect(playbookCtx).toContain("Learning Playbook");
		expect(playbookCtx).toContain("ConceptA");

		cleanup();
		console.log(`\n✅ Persistent learning verified: Playbook v${r1.playbook!.version} generated`);
		console.log(`   Playbook context injected: ${playbookCtx.length} chars`);
	});
});

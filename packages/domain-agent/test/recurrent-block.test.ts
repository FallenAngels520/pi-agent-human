import { describe, expect, it } from "vitest";
import { RecurrentBlock, shouldStop } from "../src/recurrent-block.ts";
import type { Perspective, RoundResult } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "analytical", instruction: "Analyze the problem logically and systematically." },
	{ name: "critical", instruction: "Question assumptions and find weaknesses." },
	{ name: "synthetic", instruction: "Synthesize findings into a coherent understanding." },
];

describe("shouldStop", () => {
	it("returns true when latest confidence >= threshold", () => {
		const results: RoundResult[] = [
			{
				round: 1,
				perspective: "analytical",
				findings: "...",
				contradictions: "",
				uncertainties: "",
				confidence: 0.9,
			},
		];
		expect(shouldStop(results, 0.8, 3)).toBe(true);
	});

	it("returns true on plateau (3 rounds no gain)", () => {
		const results: RoundResult[] = [
			{
				round: 1,
				perspective: "analytical",
				findings: "...",
				contradictions: "",
				uncertainties: "",
				confidence: 0.5,
			},
			{ round: 2, perspective: "critical", findings: "...", contradictions: "", uncertainties: "", confidence: 0.5 },
			{
				round: 3,
				perspective: "synthetic",
				findings: "...",
				contradictions: "",
				uncertainties: "",
				confidence: 0.5,
			},
			{
				round: 4,
				perspective: "analytical",
				findings: "...",
				contradictions: "",
				uncertainties: "",
				confidence: 0.5,
			},
		];
		expect(shouldStop(results, 0.8, 3)).toBe(true);
	});

	it("returns false when still gaining confidence", () => {
		const results: RoundResult[] = [
			{
				round: 1,
				perspective: "analytical",
				findings: "...",
				contradictions: "",
				uncertainties: "",
				confidence: 0.4,
			},
			{ round: 2, perspective: "critical", findings: "...", contradictions: "", uncertainties: "", confidence: 0.6 },
		];
		expect(shouldStop(results, 0.8, 3)).toBe(false);
	});
});

describe("RecurrentBlock", () => {
	it("builds a round prompt with internal state", () => {
		const block = new RecurrentBlock({
			problem: "Learn Rust ownership",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		const prompt = block.buildRoundPrompt([]);

		expect(prompt.problem).toBe("Learn Rust ownership");
		expect(prompt.round).toBe(1);
		expect(prompt.maxRounds).toBe(4);
		expect(prompt.perspective.name).toBe("analytical");
		expect(prompt.previousFindings).toBe("");
		expect(prompt.previousBlindSpots).toBe("");
	});

	it("includes previous findings from internal state after recordResult", () => {
		const block = new RecurrentBlock({
			problem: "Learn Rust ownership",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		// Record round 1 result
		block.recordResult({
			round: 1,
			perspective: "analytical",
			findings: "Ownership is about value management",
			contradictions: "None",
			uncertainties: "How does borrowing interact?",
			confidence: 0.5,
		});

		const prompt = block.buildRoundPrompt([
			{ conceptId: "1", conceptName: "Borrowing", gap: "Unclear interaction with ownership", severity: "high" },
		]);

		expect(prompt.round).toBe(2);
		expect(prompt.previousFindings).toContain("Ownership is about value management");
		expect(prompt.previousBlindSpots).toContain("Borrowing");
	});

	it("uses adaptive perspective selection: first round first perspective", () => {
		const block = new RecurrentBlock({
			problem: "X",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		expect(block.buildRoundPrompt([]).perspective.name).toBe("analytical");
	});

	it("repeats best-performing perspective when given feedback", () => {
		const block = new RecurrentBlock({
			problem: "X",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		// Round 1: analytical gains 0.5
		block.recordResult({
			round: 1,
			perspective: "analytical",
			findings: "...",
			contradictions: "",
			uncertainties: "",
			confidence: 0.5,
		});

		// Round 2: critical gains 0.3
		block.recordResult({
			round: 2,
			perspective: "critical",
			findings: "...",
			contradictions: "",
			uncertainties: "",
			confidence: 0.8,
		});

		// Round 3 should prefer critical (avg gain 0.3) over analytical (avg gain 0.5)
		// Wait — analytical gain = 0.5, critical gain = 0.3. analytical had 0.5 avg, critical 0.3 avg.
		// So analytical should be preferred.
		const prompt = block.buildRoundPrompt([]);
		expect(prompt.perspective.name).toBe("analytical");
	});

	it("formats the prompt text for LLM consumption", () => {
		const block = new RecurrentBlock({
			problem: "Learn Rust ownership",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		const prompt = block.buildRoundPrompt([]);
		const text = block.formatPromptText(prompt);

		expect(text).toContain("Learn Rust ownership");
		expect(text).toContain("Round 1/4");
		expect(text).toContain("analytical");
		expect(text).toContain("Analyze the problem logically");
	});

	it("tracks whether max rounds reached", () => {
		const block = new RecurrentBlock({
			problem: "X",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		expect(block.isMaxRoundsReached(3)).toBe(false);
		expect(block.isMaxRoundsReached(4)).toBe(true);
		expect(block.isMaxRoundsReached(5)).toBe(true);
	});

	it("reset clears internal state", () => {
		const block = new RecurrentBlock({
			problem: "X",
			perspectives: PERSPECTIVES,
			maxRounds: 4,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
		});

		block.recordResult({
			round: 1,
			perspective: "analytical",
			findings: "...",
			contradictions: "",
			uncertainties: "",
			confidence: 0.5,
		});

		expect(block.getRoundHistory()).toHaveLength(1);
		expect(block.currentRound).toBe(1);

		block.reset();

		expect(block.getRoundHistory()).toHaveLength(0);
		expect(block.currentRound).toBe(0);
	});
});

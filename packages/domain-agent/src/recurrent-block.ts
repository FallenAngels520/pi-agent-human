import type { BlindSpot, Perspective, RecurrentBlockConfig, RoundPrompt, RoundResult } from "./types.ts";

/**
 * Check whether the learning loop should stop for the current concept.
 *
 * Stopping conditions:
 * 1. Latest confidence >= threshold → concept mastered
 * 2. Consecutive plateau (no confidence gain for plateauThreshold rounds)
 * 3. Empty results → haven't started yet
 */
export function shouldStop(results: RoundResult[], confidenceThreshold: number, plateauThreshold: number): boolean {
	if (results.length === 0) return false;

	const latest = results[results.length - 1];
	if (latest.confidence >= confidenceThreshold) return true;

	if (results.length > plateauThreshold) {
		const recent = results.slice(-plateauThreshold);
		const allSameConfidence = recent.every((r) => r.confidence === recent[0].confidence);
		if (allSameConfidence) return true;
	}

	return false;
}

interface PerspectiveContribution {
	rounds: number;
	totalConfidenceGain: number;
}

/**
 * Agent-level recurrent depth block.
 *
 * Maintains internal state across rounds for a single concept:
 * - Round history with findings, contradictions, uncertainties, and confidence
 * - Per-perspective contribution tracking for adaptive perspective selection
 *
 * After each round, call {@link recordResult} to update state.
 * Call {@link reset} when moving to a new concept.
 */
export class RecurrentBlock {
	private config: RecurrentBlockConfig;
	private roundResults: RoundResult[] = [];
	private perspectiveStats: Map<string, PerspectiveContribution> = new Map();
	private lastConfidence = 0;

	constructor(config: RecurrentBlockConfig) {
		this.config = config;
	}

	/**
	 * Update the problem domain for the current concept.
	 * Call this when switching to a new concept without recreating the block.
	 */
	setProblem(problem: string): void {
		this.config = { ...this.config, problem };
	}

	/**
	 * Build the prompt for the next round using internal state.
	 *
	 * Perspective selection is adaptive: round 1 uses the first perspective;
	 * subsequent rounds pick the one with the highest average confidence gain.
	 */
	buildRoundPrompt(blindSpots: BlindSpot[]): RoundPrompt {
		const round = this.roundResults.length + 1;
		const perspective = this.selectPerspective(round);

		const previousFindings = this.roundResults
			.map(
				(r) => `[Round ${r.round} - ${r.perspective}]\nFindings: ${r.findings}\nUncertainties: ${r.uncertainties}`,
			)
			.join("\n\n");

		const previousBlindSpots = blindSpots
			.map((bs) => `- ${bs.conceptName}: ${bs.gap} (severity: ${bs.severity})`)
			.join("\n");

		return {
			problem: this.config.problem,
			round,
			maxRounds: this.config.maxRounds,
			perspective,
			previousFindings,
			previousBlindSpots,
		};
	}

	/**
	 * Record a round result and update perspective contribution stats.
	 */
	recordResult(result: RoundResult): void {
		const confidenceGain = result.confidence - this.lastConfidence;
		this.lastConfidence = result.confidence;
		this.roundResults.push(result);

		const prev = this.perspectiveStats.get(result.perspective) ?? { rounds: 0, totalConfidenceGain: 0 };
		this.perspectiveStats.set(result.perspective, {
			rounds: prev.rounds + 1,
			totalConfidenceGain: prev.totalConfidenceGain + confidenceGain,
		});
	}

	/**
	 * Format a RoundPrompt into the full text sent to the LLM.
	 */
	formatPromptText(prompt: RoundPrompt): string {
		const lines: string[] = [
			"## Problem",
			prompt.problem,
			"",
			"## Status",
			`Round ${prompt.round}/${prompt.maxRounds}`,
			`Perspective: ${prompt.perspective.name}`,
			`Instruction: ${prompt.perspective.instruction}`,
		];

		if (prompt.previousFindings) {
			lines.push("", "## Previous Findings", prompt.previousFindings);
		}

		if (prompt.previousBlindSpots) {
			lines.push("", "## Known Blind Spots", prompt.previousBlindSpots);
		}

		lines.push(
			"",
			"## Output Format",
			"Respond with JSON:",
			'{"findings": "...", "contradictions": "...", "uncertainties": "...", "confidence": 0.0}',
		);

		return lines.join("\n");
	}

	/**
	 * Whether the given round number has reached the max.
	 */
	isMaxRoundsReached(round: number): boolean {
		return round >= this.config.maxRounds;
	}

	/**
	 * Reset internal state for a new concept.
	 */
	reset(): void {
		this.roundResults = [];
		this.perspectiveStats.clear();
		this.lastConfidence = 0;
	}

	/**
	 * Get a copy of the round history.
	 */
	getRoundHistory(): RoundResult[] {
		return [...this.roundResults];
	}

	/**
	 * Get the current round count for this concept.
	 */
	get currentRound(): number {
		return this.roundResults.length;
	}

	/**
	 * Select a perspective for the given round.
	 *
	 * Round 1: always use the first perspective (bootstrapping — no data yet).
	 * Round 2+: adaptive — pick the perspective with the highest average
	 * confidence gain per round. Untried perspectives get a small exploration bonus.
	 */
	private selectPerspective(round: number): Perspective {
		const perspectives = this.config.perspectives;

		// First round: no history, use the first perspective
		if (round === 1 || this.perspectiveStats.size === 0) {
			return perspectives[0];
		}

		// Compute average gain per perspective, prefer highest
		let bestPerspective = perspectives[0];
		let bestAvgGain = -Infinity;

		for (const p of perspectives) {
			const stats = this.perspectiveStats.get(p.name);
			if (!stats || stats.rounds === 0) {
				// Untried perspectives get a small bonus to encourage exploration
				if (0.01 > bestAvgGain) {
					bestAvgGain = 0.01;
					bestPerspective = p;
				}
				continue;
			}
			const avgGain = stats.totalConfidenceGain / stats.rounds;
			if (avgGain > bestAvgGain) {
				bestAvgGain = avgGain;
				bestPerspective = p;
			}
		}

		return bestPerspective;
	}
}

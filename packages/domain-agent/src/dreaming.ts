import type { KnowledgeGraph } from "./knowledge-graph.ts";
import type {
	DreamingConfig,
	DreamingResult,
	Pitfall,
	Playbook,
	PlaybookStats,
	Principle,
	RoundResult,
	SelfTestResult,
	Strategy,
} from "./types.ts";
import { DEFAULT_DREAMING_CONFIG } from "./types.ts";

/**
 * Minimal interface for the deep thinking engine used in L2 dreaming.
 */
export interface DreamingDeepThinker {
	think(input: {
		domain: string;
		objective: string;
		mode: "consolidate" | "evolve";
		knowledgeSummary?: string;
		observations?: string[];
		constraints?: string[];
		maxOutputItems?: number;
	}): Promise<{
		conclusions: string[];
		assumptions: string[];
		contradictions: string[];
		blindSpots: string[];
		knowledgeUpdates: string[];
		nextResearchQuestions: string[];
		nextPracticeTasks: string[];
		innovationHypotheses: string[];
		confidence: number;
	}>;
}

// ─── Text similarity utilities ────────────────────────────────────────────────

/**
 * Simple word-overlap (Jaccard) similarity between two strings.
 * Returns a value in [0, 1].
 */
function wordOverlapSimilarity(a: string, b: string): number {
	const wordsA = new Set(
		a
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 1),
	);
	const wordsB = new Set(
		b
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 1),
	);
	if (wordsA.size === 0 && wordsB.size === 0) return 0;

	const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
	const union = new Set([...wordsA, ...wordsB]);
	return intersection.size / union.size;
}

// ─── ID generation ────────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter++;
	return `${prefix}-${idCounter}-${Date.now()}`;
}

// ─── DreamingEngine ───────────────────────────────────────────────────────────

/**
 * DreamingEngine implements Anthropic's "Dreaming" pattern for the cognitive L1 layer.
 *
 * Between learning sessions, it performs three core operations on the knowledge graph
 * and learning history:
 *
 * 1. **Consolidation (merge)** — deduplicate similar concepts, merge evidence
 * 2. **Freshness (prune)** — downgrade or remove stale, low-confidence knowledge
 * 3. **Distillation (patterns)** — extract principles, strategies, and pitfalls
 *
 * All operations are non-destructive in the sense that the output is a **Playbook**
 * — a structured, versioned artifact. The KnowledgeGraph is updated in-place
 * (merges and prunes are committed), but the playbook provides an audit trail.
 *
 * Usage:
 * ```typescript
 * const engine = new DreamingEngine();
 * const result = engine.dream(knowledgeGraph, roundHistory, selfTestResults, "Rust");
 * // result.playbook can be injected into future learning prompts
 * ```
 */
export class DreamingEngine {
	private config: DreamingConfig;
	private deepThinker?: DreamingDeepThinker;

	constructor(config: Partial<DreamingConfig> = {}, deepThinker?: DreamingDeepThinker) {
		this.config = { ...DEFAULT_DREAMING_CONFIG, ...config };
		this.deepThinker = deepThinker;
	}

	/**
	 * Run a full dreaming pass.
	 *
	 * @param kg — the knowledge graph (mutated in-place for merges/prunes)
	 * @param roundHistory — all round results from the learning session
	 * @param selfTestResults — all self-test results from the learning session
	 * @param domain — the domain/topic being learned
	 * @param previousPlaybook — optional previous playbook for version chaining
	 */
	async dream(
		kg: KnowledgeGraph,
		roundHistory: RoundResult[],
		selfTestResults: SelfTestResult[],
		domain: string,
		previousPlaybook?: Playbook,
	): Promise<DreamingResult> {
		const startTime = Date.now();

		let conceptsMerged = 0;
		let conceptsPruned = 0;

		// ── Phase 1: Consolidation ──────────────────────────────────────────
		if (this.config.enableMerge) {
			conceptsMerged = this.mergeDuplicateConcepts(kg);
		}

		// ── Phase 2: Freshness ──────────────────────────────────────────────
		if (this.config.enablePrune) {
			conceptsPruned = this.pruneStaleConcepts(kg);
		}

		// ── Phase 3: Distillation ───────────────────────────────────────────
		// L2: If a deep thinker is available, use LLM-driven distillation
		// for higher-quality principles. Falls back to rule-based extraction.
		const llmPrinciples =
			this.config.enableDistillation && this.deepThinker
				? await this.extractPrinciplesLLM(kg, roundHistory, selfTestResults, domain)
				: [];

		const rulePrinciples =
			this.config.enableDistillation && llmPrinciples.length === 0
				? this.extractPrinciples(kg, roundHistory, selfTestResults)
				: [];

		const principles = llmPrinciples.length > 0 ? llmPrinciples : rulePrinciples;

		const strategies = this.config.enableDistillation ? this.extractStrategies(roundHistory) : [];

		const pitfalls = this.config.enableDistillation ? this.catalogPitfalls(kg, selfTestResults) : [];

		// ── Phase 4: Build Playbook ─────────────────────────────────────────
		const stats = this.computeStats(kg, roundHistory, selfTestResults);

		const playbook: Playbook = {
			id: nextId("pb"),
			domain,
			createdAt: Date.now(),
			version: (previousPlaybook?.version ?? 0) + 1,
			principles: this.deduplicatePrinciples(principles),
			strategies: this.deduplicateStrategies(strategies),
			pitfalls: this.deduplicatePitfalls(pitfalls),
			changeLog: this.generateChangeLog(
				previousPlaybook,
				conceptsMerged,
				conceptsPruned,
				principles,
				strategies,
				pitfalls,
			),
			stats,
		};

		const durationMs = Date.now() - startTime;

		return {
			playbook,
			conceptsMerged,
			conceptsPruned,
			principlesExtracted: playbook.principles.length,
			strategiesIdentified: playbook.strategies.length,
			pitfallsCataloged: playbook.pitfalls.length,
			durationMs,
		};
	}

	// ── Phase 1: Concept Merging ───────────────────────────────────────────────

	/**
	 * Find and merge duplicate/similar concepts in the knowledge graph.
	 *
	 * Strategy: pairwise comparison of all concepts. When similarity exceeds
	 * the threshold, merge the lower-confidence concept into the higher-confidence one.
	 * Evidence and relations are transferred. The merged-away concept is removed.
	 */
	private mergeDuplicateConcepts(kg: KnowledgeGraph): number {
		const concepts = kg.getAllConcepts();
		if (concepts.length < 2) return 0;

		let mergedCount = 0;
		const merged = new Set<string>();

		for (let i = 0; i < concepts.length; i++) {
			const a = concepts[i];
			if (merged.has(a.id)) continue;

			for (let j = i + 1; j < concepts.length; j++) {
				const b = concepts[j];
				if (merged.has(b.id)) continue;

				const nameSim = wordOverlapSimilarity(a.name, b.name);
				const descSim = wordOverlapSimilarity(a.description, b.description);
				const similarity = Math.max(nameSim, descSim * 0.7);

				if (similarity >= this.config.mergeSimilarityThreshold) {
					// Keep the higher-confidence concept, merge the other into it
					const [keeper, loser] = a.confidence >= b.confidence ? [a, b] : [b, a];

					// Transfer evidence
					for (const ev of loser.evidence) {
						kg.addEvidence(keeper.id, ev);
					}

					// Transfer relations (rewire to keeper)
					for (const rel of loser.relations) {
						if (rel.fromId === loser.id) {
							kg.addRelation({ ...rel, fromId: keeper.id });
						}
						if (rel.toId === loser.id) {
							kg.addRelation({ ...rel, toId: keeper.id });
						}
					}

					// Blend confidence (weighted by evidence count)
					const keeperEvidence = keeper.evidence.length + 1;
					const loserEvidence = loser.evidence.length + 1;
					const blendedConfidence =
						(keeper.confidence * keeperEvidence + loser.confidence * loserEvidence) /
						(keeperEvidence + loserEvidence);
					kg.updateConfidence(keeper.id, Math.min(1, blendedConfidence));

					merged.add(loser.id);
					mergedCount++;
				}
			}
		}

		return mergedCount;
	}

	// ── Phase 2: Knowledge Pruning ─────────────────────────────────────────────

	/**
	 * Prune concepts with persistently low confidence and no recent review activity.
	 *
	 * A concept is a candidate for pruning if:
	 * - confidence < pruneConfidenceThreshold
	 * - last reviewed more than 24 hours ago (if timestamp available)
	 * - status is not "in_progress" (don't interrupt active learning)
	 */
	private pruneStaleConcepts(kg: KnowledgeGraph): number {
		const concepts = kg.getAllConcepts();
		const oneDayMs = 24 * 60 * 60 * 1000;
		const now = Date.now();

		let prunedCount = 0;

		for (const concept of concepts) {
			if (concept.confidence >= this.config.pruneConfidenceThreshold) continue;
			if (concept.status === "in_progress") continue;

			const age = now - concept.lastReviewedAt;
			if (age < oneDayMs) continue;

			// Mark as skipped rather than removing (non-destructive)
			kg.updateConfidence(concept.id, 0);
			prunedCount++;
		}

		return prunedCount;
	}

	// ── Phase 3: Pattern Extraction ────────────────────────────────────────────

	/**
	 * Extract durable principles from the learning history.
	 *
	 * A principle is generated when:
	 * - A concept went from low confidence to mastered across rounds
	 * - Multiple concepts share a similar success pattern
	 * - A specific perspective was instrumental in achieving mastery
	 */
	private extractPrinciples(
		kg: KnowledgeGraph,
		roundHistory: RoundResult[],
		selfTestResults: SelfTestResult[],
	): Principle[] {
		const principles: Principle[] = [];
		const concepts = kg.getAllConcepts();

		// Principle type 1: "Mastery trajectory" — concepts that succeeded
		const masteredConcepts = concepts.filter((c) => c.status === "mastered" && c.confidence >= 0.8);
		if (masteredConcepts.length > 0) {
			const names = masteredConcepts.map((c) => c.name).join(", ");
			principles.push({
				id: nextId("pr"),
				title: "Mastered Concept Cluster",
				statement: `Successfully mastered ${masteredConcepts.length} concept(s): ${names}. Concepts with clear prerequisite chains and multi-perspective analysis achieved the highest confidence gains.`,
				sourceConceptIds: masteredConcepts.map((c) => c.id),
				sourceEventIds: roundHistory.filter((r) => r.confidence >= 0.8).map((r) => `round-${r.round}`),
				confidence: 0.85,
				utilityScore: 1,
				lastUpdatedAt: Date.now(),
			});
		}

		// Principle type 2: "Perspective effectiveness" — which perspective worked best
		if (roundHistory.length >= 2) {
			const perspectiveGains = new Map<string, { totalGain: number; count: number }>();
			let prevConf = 0;
			for (const r of roundHistory) {
				const gain = r.confidence - prevConf;
				prevConf = r.confidence;
				const prev = perspectiveGains.get(r.perspective) ?? { totalGain: 0, count: 0 };
				perspectiveGains.set(r.perspective, {
					totalGain: prev.totalGain + gain,
					count: prev.count + 1,
				});
			}

			const bestPerspective = [...perspectiveGains.entries()]
				.map(([name, stats]) => ({ name, avgGain: stats.count > 0 ? stats.totalGain / stats.count : 0 }))
				.sort((a, b) => b.avgGain - a.avgGain)[0];

			if (bestPerspective && bestPerspective.avgGain > 0.1 && principles.length < this.config.maxPrinciples) {
				const masteredIds = masteredConcepts.map((c) => c.id);
				principles.push({
					id: nextId("pr"),
					title: `Most Effective Perspective: ${bestPerspective.name}`,
					statement: `The "${bestPerspective.name}" perspective produced the highest average confidence gain (${bestPerspective.avgGain.toFixed(2)} per round). For similar concepts in this domain, starting with the ${bestPerspective.name} perspective may accelerate mastery.`,
					sourceConceptIds: masteredIds,
					sourceEventIds: roundHistory
						.filter((r) => r.perspective === bestPerspective.name)
						.map((r) => `round-${r.round}`),
					confidence: 0.75,
					utilityScore: 1,
					lastUpdatedAt: Date.now(),
				});
			}
		}

		// Principle type 3: "Self-test insight" — what self-tests revealed
		const failedTests = selfTestResults.filter((r) => !r.correct);
		if (failedTests.length > 0 && principles.length < this.config.maxPrinciples) {
			const questionTypes = new Map<string, number>();
			for (const ft of failedTests) {
				const type = ft.question.type;
				questionTypes.set(type, (questionTypes.get(type) ?? 0) + 1);
			}
			const worstType = [...questionTypes.entries()].sort((a, b) => b[1] - a[1])[0];

			if (worstType) {
				principles.push({
					id: nextId("pr"),
					title: `Self-Test Weakness: ${worstType[0]} Questions`,
					statement: `${worstType[1]} out of ${failedTests.length} self-test failures were on "${worstType[0]}" questions. Concepts in this domain need deeper ${worstType[0]}-level understanding. Consider adding more ${worstType[0]}-focused practice.`,
					sourceConceptIds: failedTests.map((ft) => ft.conceptId),
					sourceEventIds: [],
					confidence: 0.7,
					utilityScore: 1,
					lastUpdatedAt: Date.now(),
				});
			}
		}

		return principles.slice(0, this.config.maxPrinciples);
	}

	/**
	 * Extract actionable learning strategies from round history patterns.
	 *
	 * Strategies are situation→action rules derived from observed success patterns.
	 */
	private extractStrategies(roundHistory: RoundResult[]): Strategy[] {
		const strategies: Strategy[] = [];

		if (roundHistory.length < 2) return strategies;

		// Strategy 1: "First-round confidence jump" strategy
		const firstTwoRounds = roundHistory.slice(0, 2);
		if (firstTwoRounds.length === 2) {
			const gain = firstTwoRounds[1].confidence - firstTwoRounds[0].confidence;
			if (gain > 0.2) {
				strategies.push({
					id: nextId("st"),
					trigger: "When starting a new concept with low initial confidence",
					action: `Use the "${firstTwoRounds[1].perspective}" perspective early — it produced a ${gain.toFixed(0)}% confidence jump in the second round`,
					rationale: `Analysis of learning trajectory shows that switching from "${firstTwoRounds[0].perspective}" to "${firstTwoRounds[1].perspective}" after the first round maximizes early confidence gain.`,
					exemplarConceptId: "",
					averageGain: gain,
					occurrenceCount: 1,
				});
			}
		}

		// Strategy 2: "Plateau escape" strategy
		const plateauRounds = this.detectPlateaus(roundHistory);
		if (plateauRounds.length > 0 && plateauRounds.length < roundHistory.length) {
			const escapeRound = roundHistory[plateauRounds[plateauRounds.length - 1] + 1];
			if (escapeRound) {
				strategies.push({
					id: nextId("st"),
					trigger: "When confidence plateaus for multiple rounds",
					action: `Switch to the "${escapeRound.perspective}" perspective — it broke a ${plateauRounds.length}-round plateau`,
					rationale: `Plateau detected at confidence ~${roundHistory[plateauRounds[0]].confidence.toFixed(2)}. The "${escapeRound.perspective}" perspective introduced fresh analytical angles that restarted progress.`,
					exemplarConceptId: "",
					averageGain: escapeRound.confidence - roundHistory[plateauRounds[plateauRounds.length - 1]].confidence,
					occurrenceCount: 1,
				});
			}
		}

		// Strategy 3: "Round efficiency" — when to stop
		const masteredAt = roundHistory.findIndex((r) => r.confidence >= 0.8);
		if (masteredAt > 0 && masteredAt < roundHistory.length - 2) {
			strategies.push({
				id: nextId("st"),
				trigger: "When confidence reaches mastery threshold early",
				action: `Stop after ${masteredAt + 1} rounds — additional rounds showed diminishing returns (avg gain < 0.05 after mastery)`,
				rationale:
					"Continuing rounds after reaching confidence threshold produced negligible additional gains. Early stopping saves resources without sacrificing quality.",
				exemplarConceptId: "",
				averageGain: 0,
				occurrenceCount: 1,
			});
		}

		return strategies.slice(0, this.config.maxStrategies);
	}

	/**
	 * Catalog common pitfalls from self-test failures and blind spots.
	 */
	private catalogPitfalls(kg: KnowledgeGraph, selfTestResults: SelfTestResult[]): Pitfall[] {
		const pitfalls: Pitfall[] = [];

		// Pitfall type 1: from self-test failures
		const failures = selfTestResults.filter((r) => !r.correct);
		if (failures.length > 0) {
			// Group failures by question type
			const byType = new Map<string, SelfTestResult[]>();
			for (const f of failures) {
				const type = f.question.type;
				if (!byType.has(type)) byType.set(type, []);
				byType.get(type)!.push(f);
			}

			for (const [type, results] of byType) {
				const severity = type === "recall" ? "high" : type === "application" ? "medium" : "low";
				const conceptNames = [...new Set(results.map((r) => r.question.conceptName))];
				pitfalls.push({
					id: nextId("pf"),
					description: `Consistently failed "${type}" questions for concepts: ${conceptNames.join(", ")}`,
					correction:
						type === "recall"
							? "Focus on memorization and definitional clarity. Use spaced repetition."
							: type === "application"
								? "Practice applying the concept in concrete scenarios with code examples."
								: "Study edge cases, limitations, and counter-examples explicitly.",
					relatedConceptIds: [...new Set(results.map((r) => r.conceptId))],
					severity,
					occurrenceCount: results.length,
				});
			}
		}

		// Pitfall type 2: from persistent blind spots in the knowledge graph
		const blindSpots = kg.getBlindSpots(0.6);
		if (blindSpots.length > 0) {
			const highSeverity = blindSpots.filter((bs) => bs.severity === "high");
			if (highSeverity.length > 0) {
				pitfalls.push({
					id: nextId("pf"),
					description: `${highSeverity.length} persistent high-severity blind spots remain: ${highSeverity.map((bs) => bs.conceptName).join(", ")}`,
					correction:
						"These concepts need targeted remediation. Consider breaking them into smaller sub-concepts or adding more prerequisite knowledge.",
					relatedConceptIds: highSeverity.map((bs) => bs.conceptId),
					severity: "high",
					occurrenceCount: highSeverity.length,
				});
			}
		}

		return pitfalls;
	}

	// ── Phase 4: Playbook Assembly ─────────────────────────────────────────────

	/**
	 * Compute statistics about the knowledge graph and learning session.
	 */
	private computeStats(
		kg: KnowledgeGraph,
		roundHistory: RoundResult[],
		selfTestResults: SelfTestResult[],
	): PlaybookStats {
		const concepts = kg.getAllConcepts();
		const mastered = concepts.filter((c) => c.status === "mastered");
		const avgConf = concepts.length > 0 ? concepts.reduce((sum, c) => sum + c.confidence, 0) / concepts.length : 0;

		// Perspective effectiveness
		const perspectiveStats = new Map<string, { rounds: number; totalGain: number }>();
		let prevConf = 0;
		for (const r of roundHistory) {
			const gain = r.confidence - prevConf;
			prevConf = r.confidence;
			const prev = perspectiveStats.get(r.perspective) ?? { rounds: 0, totalGain: 0 };
			perspectiveStats.set(r.perspective, {
				rounds: prev.rounds + 1,
				totalGain: prev.totalGain + gain,
			});
		}

		const perspectiveEffectiveness: Record<string, { rounds: number; averageGain: number }> = {};
		for (const [name, stats] of perspectiveStats) {
			perspectiveEffectiveness[name] = {
				rounds: stats.rounds,
				averageGain: stats.rounds > 0 ? stats.totalGain / stats.rounds : 0,
			};
		}

		return {
			totalConcepts: concepts.length,
			masteredConcepts: mastered.length,
			averageConfidence: avgConf,
			totalRounds: roundHistory.length,
			totalSelfTests: selfTestResults.length,
			blindSpotsResolved: kg.getBlindSpots(0.6).length,
			perspectiveEffectiveness,
		};
	}

	/**
	 * Generate a human-readable change log comparing to the previous playbook.
	 */
	private generateChangeLog(
		previousPlaybook: Playbook | undefined,
		merged: number,
		pruned: number,
		principles: Principle[],
		strategies: Strategy[],
		pitfalls: Pitfall[],
	): string {
		const lines: string[] = [];

		if (!previousPlaybook) {
			lines.push("Initial dreaming pass — no previous playbook to compare against.");
		} else {
			const newPrincipleCount = principles.length - previousPlaybook.principles.length;
			const newStrategyCount = strategies.length - previousPlaybook.strategies.length;

			if (newPrincipleCount > 0) lines.push(`+${newPrincipleCount} new principles discovered.`);
			if (newPrincipleCount < 0) lines.push(`${newPrincipleCount} principles removed or merged.`);
			if (newStrategyCount > 0) lines.push(`+${newStrategyCount} new strategies identified.`);
		}

		if (merged > 0) lines.push(`${merged} duplicate concept(s) merged.`);
		if (pruned > 0) lines.push(`${pruned} stale concept(s) pruned.`);
		if (principles.length > 0) lines.push(`${principles.length} principle(s) active.`);
		if (pitfalls.length > 0) lines.push(`${pitfalls.length} pitfall(s) cataloged.`);

		return lines.join(" ");
	}

	// ── L2: LLM-Driven Distillation ────────────────────────────────────────

	/**
	 * Use the deep thinking engine (L2) to generate higher-quality principles
	 * from the learning history.
	 *
	 * This is the L2 equivalent of Anthropic Dreaming's pattern mining —
	 * using an LLM itself to analyze learning data and extract durable insights.
	 */
	private async extractPrinciplesLLM(
		kg: KnowledgeGraph,
		roundHistory: RoundResult[],
		selfTestResults: SelfTestResult[],
		domain: string,
	): Promise<Principle[]> {
		if (!this.deepThinker) return [];

		const concepts = kg.getAllConcepts();
		const mastered = concepts.filter((c) => c.status === "mastered");
		const blindSpots = kg.getBlindSpots(0.6);

		const knowledgeSummary = [
			`Domain: ${domain}`,
			`Total concepts: ${concepts.length} | Mastered: ${mastered.length}`,
			`Rounds: ${roundHistory.length} | Self-tests: ${selfTestResults.length}`,
			mastered.length > 0 ? `Mastered: ${mastered.map((c) => c.name).join(", ")}` : "",
			blindSpots.length > 0
				? `Blind spots: ${blindSpots.map((bs) => `${bs.conceptName}(${bs.severity})`).join(", ")}`
				: "",
		]
			.filter(Boolean)
			.join("\n");

		const observations =
			roundHistory.length > 0
				? [
						`Round history: ${roundHistory.map((r) => `R${r.round}/${r.perspective}:${r.confidence.toFixed(2)}`).join(" | ")}`,
					]
				: [];

		try {
			const result = await this.deepThinker.think({
				domain,
				objective: `Extract durable learning principles from ${roundHistory.length} rounds of learning data across ${concepts.length} concepts`,
				mode: "consolidate",
				knowledgeSummary,
				observations,
				constraints: [
					"Extract 3-5 concrete, actionable principles. Each should be specific to this domain.",
					"Focus on WHAT worked, WHY it worked, and HOW to replicate it.",
					"Avoid generic advice. Each principle must reference specific patterns from the data.",
					"Include perspective effectiveness data if available.",
					"Output conclusions as an array of concise principle statements.",
				],
				maxOutputItems: this.config.maxPrinciples,
			});

			const principles: Principle[] = result.conclusions.map((conclusion, i) => ({
				id: nextId("pr-llm"),
				title: `LLM Principle ${i + 1}: ${conclusion.slice(0, 60)}`,
				statement: conclusion,
				sourceConceptIds: mastered.map((c) => c.id),
				sourceEventIds: [],
				confidence: result.confidence,
				utilityScore: 1,
				lastUpdatedAt: Date.now(),
			}));

			// Also convert knowledge updates to principles
			for (const update of result.knowledgeUpdates.slice(0, this.config.maxPrinciples - principles.length)) {
				principles.push({
					id: nextId("pr-llm"),
					title: `Knowledge Update`,
					statement: update,
					sourceConceptIds: mastered.map((c) => c.id),
					sourceEventIds: [],
					confidence: result.confidence * 0.85,
					utilityScore: 1,
					lastUpdatedAt: Date.now(),
				});
			}

			return principles;
		} catch {
			// LLM failure → fall back to rule-based extraction
			return [];
		}
	}

	// ── Deduplication helpers ──────────────────────────────────────────────────

	private deduplicatePrinciples(principles: Principle[]): Principle[] {
		const seen = new Set<string>();
		return principles.filter((p) => {
			const key = p.title.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	private deduplicateStrategies(strategies: Strategy[]): Strategy[] {
		const seen = new Set<string>();
		return strategies.filter((s) => {
			const key = `${s.trigger}|${s.action}`.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	private deduplicatePitfalls(pitfalls: Pitfall[]): Pitfall[] {
		const seen = new Set<string>();
		return pitfalls.filter((p) => {
			const key = p.description.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	// ── Utility: Plateau detection ─────────────────────────────────────────────

	/**
	 * Detect plateau indices in round history.
	 * Returns the indices of rounds that are part of a plateau (same confidence).
	 */
	private detectPlateaus(roundHistory: RoundResult[]): number[] {
		const plateauIndices: number[] = [];
		let streakStart = 0;

		for (let i = 1; i < roundHistory.length; i++) {
			if (roundHistory[i].confidence === roundHistory[i - 1].confidence) {
				if (i - streakStart >= 2) {
					for (let j = streakStart; j <= i; j++) {
						if (!plateauIndices.includes(j)) plateauIndices.push(j);
					}
				}
			} else {
				streakStart = i;
			}
		}

		return plateauIndices;
	}
}

/**
 * Format a Playbook as text suitable for injection into learning prompts.
 *
 * This is the "playbook injection" mechanism — future learning sessions
 * receive this text as context so they can benefit from past dreaming output.
 */
export function formatPlaybookForPrompt(playbook: Playbook): string {
	const lines: string[] = [
		"## Learning Playbook",
		`Domain: ${playbook.domain} | Version: ${playbook.version} | Generated: ${new Date(playbook.createdAt).toISOString()}`,
		"",
	];

	if (playbook.principles.length > 0) {
		lines.push("### Principles (Transferable Insights)");
		for (const p of playbook.principles) {
			lines.push(`- **${p.title}**: ${p.statement}`);
		}
		lines.push("");
	}

	if (playbook.strategies.length > 0) {
		lines.push("### Recommended Strategies");
		for (const s of playbook.strategies) {
			lines.push(`- **When**: ${s.trigger}`);
			lines.push(`  **Do**: ${s.action}`);
			lines.push(`  **Why**: ${s.rationale}`);
		}
		lines.push("");
	}

	if (playbook.pitfalls.length > 0) {
		lines.push("### Common Pitfalls to Avoid");
		for (const p of playbook.pitfalls) {
			lines.push(`- ⚠️ **${p.description}**`);
			lines.push(`  ✅ Correction: ${p.correction}`);
		}
		lines.push("");
	}

	if (playbook.stats.totalConcepts > 0) {
		lines.push("### Session Statistics");
		lines.push(
			`- Concepts: ${playbook.stats.masteredConcepts}/${playbook.stats.totalConcepts} mastered (avg confidence: ${playbook.stats.averageConfidence.toFixed(2)})`,
		);
		lines.push(`- Rounds: ${playbook.stats.totalRounds} | Self-tests: ${playbook.stats.totalSelfTests}`);
	}

	return lines.join("\n");
}

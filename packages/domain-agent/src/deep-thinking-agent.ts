import { CognitiveAgent, type CognitiveAgentConfig, type LearnResult } from "./cognitive-agent.ts";
import type { DeepThinkingEngineLike } from "./continuous-learning-agent.ts";
import type { DeepThinkingInput, DeepThinkingResult } from "./deep-thinking.ts";
import type { DreamingResult, Playbook, RoundResult, SelfTestResult } from "./types.ts";

/**
 * Configuration for the L2 DeepThinkingAgent.
 */
export interface DeepThinkingAgentConfig extends CognitiveAgentConfig {
	/** Deep thinking engine for meta-cognition. Required for L2 capabilities. */
	deepThinking: DeepThinkingEngineLike;
	/** Domain for deep thinking memory paths. Default: derived from topic. */
	domain?: string;
	/** Whether to run deep thinking before each learning round. Default: true. */
	preRoundThinking?: boolean;
	/** Whether to run deep thinking on self-test failures. Default: true. */
	reflectionOnFailures?: boolean;
	/** Whether to run deep thinking consolidation after Dreaming. Default: true. */
	consolidateAfterDreaming?: boolean;
}

/**
 * Extended learn result with L2 deep thinking insights.
 */
export interface DeepLearnResult extends LearnResult {
	/** Guidance from deep thinking (learn mode) used during the session. */
	deepThinkingGuidance: DeepThinkingResult[];
	/** Reflection results from self-test analysis. */
	reflections: DeepThinkingResult[];
	/** Consolidation result from post-dreaming analysis (LLM-level Playbook insights). */
	consolidation?: DeepThinkingResult;
	/** The final Playbook from the session. */
	playbook?: Playbook;
}

/**
 * DeepThinkingAgent wraps L1 CognitiveAgent with L2 DeepThinkingEngine meta-cognition.
 *
 * ## L2 Layer Architecture
 *
 * ```
 * L2 DeepThinkingAgent
 *   │
 *   ├─ L1 CognitiveAgent (multi-perspective learning + SelfTest + Dreaming)
 *   │
 *   └─ L2 DeepThinkingEngine (meta-cognition at every stage)
 *        │
 *        ├─ Pre-round: deepThink({mode:"learn"}) → guidance injected into prompt
 *        ├─ Post-failure: deepThink({mode:"reflect"}) → root cause analysis
 *        └─ Post-dreaming: deepThink({mode:"consolidate"}) → LLM insights → Playbook
 * ```
 *
 * Usage:
 * ```typescript
 * const l2Agent = new DeepThinkingAgent({
 *   agent,
 *   learningConfig: { perspectives, maxRounds: 5, confidenceThreshold: 0.8, plateauThreshold: 3 },
 *   deepThinking: new DeepThinkingEngine({ model }),
 *   domain: "Rust",
 * });
 * const result = await l2Agent.learn("Rust Ownership", [...]);
 * // result.deepThinkingGuidance, result.reflections, result.consolidation
 * ```
 */
export class DeepThinkingAgent {
	private cognitive: CognitiveAgent;
	private deepThinking: DeepThinkingEngineLike;
	private domain: string;
	private preRoundThinking: boolean;
	private reflectionOnFailures: boolean;
	private consolidateAfterDreaming: boolean;

	/** Accumulated deep thinking guidance from all rounds. */
	private guidanceLog: DeepThinkingResult[] = [];
	/** Accumulated reflection results. */
	private reflectionLog: DeepThinkingResult[] = [];

	constructor(config: DeepThinkingAgentConfig) {
		this.cognitive = new CognitiveAgent({
			agent: config.agent,
			learningConfig: config.learningConfig,
			dreamingEnabled: config.dreamingEnabled,
			dreamingConfig: config.dreamingConfig,
		});
		this.deepThinking = config.deepThinking;
		this.domain = config.domain ?? "general";
		this.preRoundThinking = config.preRoundThinking ?? true;
		this.reflectionOnFailures = config.reflectionOnFailures ?? true;
		this.consolidateAfterDreaming = config.consolidateAfterDreaming ?? true;
	}

	get knowledgeGraph() {
		return this.cognitive.knowledgeGraph;
	}

	get currentPlaybook(): Playbook | undefined {
		return this.cognitive.currentPlaybook;
	}

	getPlaybookContext(): string {
		return this.cognitive.getPlaybookContext();
	}

	/**
	 * Run deep thinking in the specified mode and log the result.
	 */
	private async think(
		mode: DeepThinkingInput["mode"],
		objective: string,
		extra?: Partial<DeepThinkingInput>,
	): Promise<DeepThinkingResult> {
		const input: DeepThinkingInput = {
			domain: this.domain,
			objective,
			mode,
			knowledgeSummary: this.buildKnowledgeSummary(),
			...extra,
		};
		return this.deepThinking.think(input);
	}

	/**
	 * Build a summary of current knowledge graph state for deep thinking context.
	 */
	private buildKnowledgeSummary(): string {
		const concepts = this.cognitive.knowledgeGraph.getAllConcepts();
		if (concepts.length === 0) return "";
		return concepts.map((c) => `${c.name} (${c.status}, confidence=${c.confidence.toFixed(2)})`).join("\n");
	}

	// ── L1 Delegation ─────────────────────────────────────────────────

	async runOneRound(): Promise<RoundResult | null> {
		return this.cognitive.runOneRound();
	}

	async runSelfTest(conceptId: string): Promise<SelfTestResult[]> {
		return this.cognitive.runSelfTest(conceptId);
	}

	async dream(domain: string, history: RoundResult[], tests: SelfTestResult[]): Promise<DreamingResult> {
		return this.cognitive.dream(domain, history, tests);
	}

	// ── L2-Enhanced Operations ────────────────────────────────────────

	/**
	 * Run a single learning round with L2 pre-round deep thinking guidance.
	 *
	 * The deep thinking output is injected as additional context into the
	 * learning prompt, providing the agent with meta-cognitive guidance.
	 */
	async runOneRoundWithDeepThink(
		conceptName: string,
		gap?: string,
	): Promise<{
		roundResult: RoundResult | null;
		guidance: DeepThinkingResult | null;
	}> {
		let guidance: DeepThinkingResult | null = null;

		if (this.preRoundThinking) {
			try {
				const objective = gap
					? `Prepare to learn "${conceptName}" — blind spot: ${gap}`
					: `Prepare to learn "${conceptName}" deeply`;
				guidance = await this.think("learn", objective, {
					memoryPath: {
						domain: this.domain,
						capability: "learning",
						concept: conceptName,
						situation: `Learning round preparation`,
					},
					constraints: [
						"Identify assumptions, contradictions, missing evidence, and practice tasks before the learning round.",
					],
				});
				this.guidanceLog.push(guidance);
			} catch {
				// Guidance failure shouldn't break the learning loop
			}
		}

		const roundResult = await this.cognitive.runOneRound();
		return { roundResult, guidance };
	}

	/**
	 * Run self-test and reflect on failures using deep thinking.
	 */
	async runSelfTestWithReflection(
		conceptId: string,
		conceptName: string,
	): Promise<{
		testResults: SelfTestResult[];
		reflection: DeepThinkingResult | null;
	}> {
		const testResults = await this.cognitive.runSelfTest(conceptId);
		const failures = testResults.filter((r) => !r.correct);
		let reflection: DeepThinkingResult | null = null;

		if (failures.length > 0 && this.reflectionOnFailures) {
			try {
				reflection = await this.think("reflect", `Reflect on self-test gaps for "${conceptName}"`, {
					memoryPath: {
						domain: this.domain,
						capability: "reflection",
						concept: conceptName,
						situation: "Self-test gaps",
					},
					observations: [`Correct answers: ${testResults.length - failures.length}/${testResults.length}`],
					failures: failures.map((f) => f.question.question),
					constraints: ["Convert self-test failures into precise blind spots and remediation practice tasks."],
				});
				this.reflectionLog.push(reflection);
			} catch {
				// Reflection failure shouldn't break the loop
			}
		}

		return { testResults, reflection };
	}

	/**
	 * Run consolidation deep thinking after Dreaming to generate LLM-level insights.
	 *
	 * This is the L2 equivalent of Anthropic's "dreaming about the dream" —
	 * using the LLM itself to generate deeper insights from the Dreaming output.
	 */
	async consolidateDreaming(): Promise<DeepThinkingResult | null> {
		if (!this.consolidateAfterDreaming) return null;

		const playbook = this.cognitive.currentPlaybook;
		if (!playbook) return null;

		try {
			const result = await this.think("consolidate", "Consolidate learning session into durable wisdom", {
				memoryPath: {
					domain: this.domain,
					capability: "meta-learning",
					situation: "Post-session consolidation",
				},
				observations: [
					`Playbook principles: ${playbook.principles.map((p) => p.statement).join("; ")}`,
					`Strategies: ${playbook.strategies.map((s) => `${s.trigger} → ${s.action}`).join("; ")}`,
					`Pitfalls: ${playbook.pitfalls.map((p) => p.description).join("; ")}`,
				],
				constraints: [
					"Extract the single most important meta-learning insight from this session.",
					"Identify one surprising finding that challenges initial assumptions.",
					"Recommend the highest-leverage next learning action.",
				],
			});
			return result;
		} catch {
			return null;
		}
	}

	// ── L2-Enhanced Learning Pipeline ─────────────────────────────────

	/**
	 * Run the full L2-enhanced autonomous learning loop.
	 *
	 * Pipeline per concept:
	 * 1. L2 pre-round guidance → L1 multi-perspective learning
	 * 2. L1 SelfTest → L2 reflection on failures
	 * 3. L1 blind-spot remediation
	 * 4. L1 Dreaming → L2 consolidation thinking → LLM Playbook
	 */
	async learn(topic: string, concepts: Array<{ name: string; prerequisites: string[] }>): Promise<DeepLearnResult> {
		const messages: string[] = [];
		this.domain = topic;
		this.guidanceLog = [];
		this.reflectionLog = [];

		// L1: Run the base learning pipeline
		const l1Result = await this.cognitive.learn(topic, concepts);
		messages.push(...l1Result.messages);

		// L2: Consolidation thinking (post-dreaming)
		const consolidation = await this.consolidateDreaming();
		if (consolidation) {
			messages.push("");
			messages.push("L2 Consolidation complete:");
			if (consolidation.conclusions.length > 0) {
				messages.push(`  Meta-insight: ${consolidation.conclusions[0]}`);
			}
			if (consolidation.nextResearchQuestions.length > 0) {
				messages.push(`  Next action: ${consolidation.nextResearchQuestions[0]}`);
			}
		}

		return {
			...l1Result,
			deepThinkingGuidance: [...this.guidanceLog],
			reflections: [...this.reflectionLog],
			consolidation: consolidation ?? undefined,
			playbook: this.cognitive.currentPlaybook,
		};
	}
}

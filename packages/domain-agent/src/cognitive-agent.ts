import type { Agent } from "@earendil-works/pi-agent-core";
import { completeSimple } from "@earendil-works/pi-ai";
import { Curriculum } from "./curriculum.ts";
import { DreamingEngine, formatPlaybookForPrompt } from "./dreaming.ts";
import { KnowledgeGraph } from "./knowledge-graph.ts";
import type { LearningLoopConfig, SeedConcept } from "./learning-loop.ts";
import { LearningLoop } from "./learning-loop.ts";
import { parseRoundResult } from "./parse-result.ts";
import { SelfTest } from "./self-test.ts";
import { createKnowledgeGraphTools } from "./tools/kg-tools.ts";
import type { RunPromptFn } from "./tools/search-tools.ts";
import { createSearchTools } from "./tools/search-tools.ts";
import { createSelfTestTools } from "./tools/test-tools.ts";
import type { DreamingConfig, DreamingResult, Playbook, RoundResult, SelfTestResult } from "./types.ts";

export interface CognitiveAgentConfig {
	agent: Agent;
	learningConfig: Omit<LearningLoopConfig, "knowledgeGraph" | "curriculum" | "selfTest">;
	/** Enable post-learning dreaming (Anthropic Dreaming pattern). Default: true. */
	dreamingEnabled?: boolean;
	/** Dreaming engine configuration. Defaults are used for any omitted fields. */
	dreamingConfig?: Partial<DreamingConfig>;
}

export interface LearnResult {
	topic: string;
	conceptsLearned: number;
	totalRounds: number;
	finalBlindSpots: number;
	messages: string[];
	/** Detailed round results for each concept. */
	roundDetails: RoundResult[];
	/** Self-test results collected during learning. */
	selfTestResults: SelfTestResult[];
	/** Dreaming result — only populated when dreaming is enabled. */
	dreaming?: DreamingResult;
}

// Re-export for backward compatibility
export { parseRoundResult } from "./parse-result.ts";

/**
 * Extract the text content from an assistant message.
 */
function extractTextContent(message: { role: string; content: unknown }): string {
	if (message.role !== "assistant") return "";
	const content = message.content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is { type: "text"; text: string } => (c as { type: string }).type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	if (typeof content === "string") return content;
	return "";
}

/**
 * Parse self-test results from an agent's text response.
 *
 * Heuristic: checks whether the response mentions each concept name,
 * indicating the agent successfully engaged with the question.
 */
function parseSelfTestResponse(
	responseText: string,
	questions: ReturnType<SelfTest["generateQuestions"]>,
	conceptId: string,
): SelfTestResult[] {
	return questions.map((q) => {
		const answered = responseText.toLowerCase().includes(q.conceptName.toLowerCase());
		return {
			conceptId,
			question: q,
			userAnswer: responseText.slice(0, 500),
			expectedAnswer: `Should demonstrate understanding of ${q.conceptName} (${q.type})`,
			correct: answered,
			explanation: answered ? `Response addresses ${q.conceptName}` : `Response does not address ${q.conceptName}`,
		};
	});
}

/**
 * CognitiveAgent wires the LearningLoop to a Pi Agent for autonomous learning.
 *
 * ## Anthropic Dreaming Integration
 *
 * After each `learn()` session, the agent optionally runs a **Dreaming** pass
 * that performs three operations on the learning history:
 *
 * 1. **Consolidation** — merges duplicate concepts, transfers evidence
 * 2. **Freshness** — prunes stale/low-confidence knowledge
 * 3. **Distillation** — extracts principles, strategies, and pitfalls into a Playbook
 *
 * The generated Playbook is automatically injected as context into subsequent
 * learning prompts, enabling self-improvement across sessions.
 *
 * Usage:
 * ```typescript
 * const agent = new Agent({ ... });
 * const cognitive = new CognitiveAgent({
 *   agent,
 *   learningConfig: { ... },
 *   dreamingEnabled: true,               // default
 * });
 *
 * // First session — learns and dreams
 * const result1 = await cognitive.learn("Rust", [...]);
 * console.log(result1.dreaming.playbook.principles);
 *
 * // Second session — playbook context is automatically injected
 * const result2 = await cognitive.learn("Advanced Rust", [...]);
 * ```
 */
export class CognitiveAgent {
	private agent: Agent;
	private kg: KnowledgeGraph;
	private curriculum: Curriculum;
	private selfTest: SelfTest;
	private loop: LearningLoop;
	private dreamingEngine: DreamingEngine;
	private dreamingEnabled: boolean;
	private playbook: Playbook | undefined;

	constructor(config: CognitiveAgentConfig) {
		this.agent = config.agent;
		this.kg = new KnowledgeGraph();
		this.curriculum = new Curriculum(this.kg);
		this.selfTest = new SelfTest(this.kg);
		this.dreamingEnabled = config.dreamingEnabled ?? true;
		this.dreamingEngine = new DreamingEngine(config.dreamingConfig);

		this.loop = new LearningLoop({
			knowledgeGraph: this.kg,
			curriculum: this.curriculum,
			selfTest: this.selfTest,
			...config.learningConfig,
		});

		// Register cognitive tools
		const runPrompt = this.createRunPrompt();
		const tools = [
			...createKnowledgeGraphTools(this.kg),
			...createSelfTestTools(this.kg),
			...createSearchTools({ runPrompt }),
		];
		this.agent.state.tools = [...this.agent.state.tools, ...tools];
	}

	/**
	 * Create a runPrompt callback that uses the agent's model to answer a
	 * question about fetched web content. Uses a one-shot completion
	 * (no tools, no agent loop) so it works even during tool execution.
	 */
	private createRunPrompt(): RunPromptFn {
		return async (content: string, prompt: string, signal?: AbortSignal): Promise<string> => {
			const model = this.agent.state.model;
			const apiKey = await this.agent.getApiKey?.(model.provider);

			const result = await completeSimple(
				model,
				{
					systemPrompt:
						"Answer questions based ONLY on the provided content. " +
						"Reply with just the direct answer, no preamble or explanation.",
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: [
										"Based on the following content, answer this question:",
										"",
										"Content:",
										content.slice(0, 8000),
										"",
										`Question: ${prompt}`,
									].join("\n"),
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey, signal },
			);

			if (Array.isArray(result.content)) {
				return result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
			}
			if (typeof result.content === "string") return result.content;
			return "";
		};
	}

	get knowledgeGraph(): KnowledgeGraph {
		return this.kg;
	}

	/**
	 * Get the current playbook (generated by the last dreaming pass).
	 * Returns undefined if dreaming has never run.
	 */
	get currentPlaybook(): Playbook | undefined {
		return this.playbook;
	}

	/**
	 * Get the formatted playbook text for injection into learning prompts.
	 * Returns empty string if no playbook exists.
	 */
	getPlaybookContext(): string {
		if (!this.playbook) return "";
		return formatPlaybookForPrompt(this.playbook);
	}

	/**
	 * Run a single round: send prompt to LLM, parse response, record result.
	 * Injects playbook context from previous dreaming passes if available.
	 */
	async runOneRound(): Promise<RoundResult | null> {
		const prompt = this.loop.getNextRoundPrompt();
		if (!prompt) return null;

		let promptText = this.loop.formatPromptText(prompt);

		// Inject playbook context from previous dreaming sessions
		const playbookCtx = this.getPlaybookContext();
		if (playbookCtx) {
			promptText = [playbookCtx, "", "---", "", promptText].join("\n");
		}

		// Wait for the agent's response via event listener
		let responseText = "";
		let resolved = false;

		const unsubscribe = this.agent.subscribe(async (event) => {
			if (resolved) return;
			if (event.type === "message_end" && event.message.role === "assistant") {
				responseText = extractTextContent(event.message);
				resolved = true;
			}
		});

		try {
			await this.agent.prompt(promptText);
			await this.agent.waitForIdle();
		} catch (error) {
			unsubscribe();
			throw error;
		}

		unsubscribe();

		if (!responseText) return null;

		const result = parseRoundResult(responseText, prompt.round, prompt.perspective.name);
		if (result) {
			this.loop.recordRoundResult(result);
		}
		return result;
	}

	/**
	 * Run self-test verification for the current concept.
	 */
	async runSelfTest(conceptId: string): Promise<SelfTestResult[]> {
		const questions = this.selfTest.generateQuestions(conceptId);
		if (questions.length === 0) return [];

		const testPrompt = [
			"## Self-Test Verification",
			"Answer these questions to demonstrate your understanding. Be thorough.",
			"",
			...questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question}`),
			"",
			"## Instructions",
			"Answer each question completely. For application questions, include code examples.",
			"For boundary questions, explain when the concept does NOT apply.",
		].join("\n");

		let responseText = "";

		const unsubscribe = this.agent.subscribe(async (event) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				responseText = extractTextContent(event.message);
			}
		});

		try {
			await this.agent.prompt(testPrompt);
			await this.agent.waitForIdle();
		} catch {
			unsubscribe();
			return [];
		}

		unsubscribe();

		if (!responseText) return [];

		const results = parseSelfTestResponse(responseText, questions, conceptId);
		this.loop.recordSelfTestResults(results);
		return results;
	}

	/**
	 * Run the dreaming pass on the current knowledge graph and learning history.
	 *
	 * This is exposed as a public method so callers can trigger dreaming
	 * manually between sessions, on a schedule, or with custom configurations.
	 */
	async dream(
		domain: string,
		roundHistory: RoundResult[],
		selfTestResults: SelfTestResult[],
	): Promise<DreamingResult> {
		const result = await this.dreamingEngine.dream(
			this.kg,
			roundHistory,
			selfTestResults,
			domain,
			this.playbook, // chain from previous playbook
		);
		this.playbook = result.playbook;
		return result;
	}

	/**
	 * Run the full autonomous learning loop for a topic.
	 *
	 * Pipeline for each concept:
	 * 1. Multi-perspective recurrent-depth learning rounds (with playbook context)
	 * 2. Self-test verification
	 * 3. Targeted remediation if blind spots remain
	 * 4. Post-session dreaming (consolidation + freshness + distillation)
	 */
	async learn(topic: string, concepts: SeedConcept[]): Promise<LearnResult> {
		const messages: string[] = [];
		const allRoundDetails: RoundResult[] = [];
		const allSelfTestResults: SelfTestResult[] = [];

		// Inject playbook context from previous dreaming sessions
		if (this.playbook) {
			messages.push(`Using playbook v${this.playbook.version} from previous dreaming session`);
			messages.push(
				`  Principles: ${this.playbook.principles.length} | Strategies: ${this.playbook.strategies.length} | Pitfalls: ${this.playbook.pitfalls.length}`,
			);
		}

		this.loop.seedConcepts(topic, concepts);
		const path = this.loop.getLearningPath();
		let totalRounds = 0;

		for (let i = 0; i < path.length; i++) {
			messages.push(`Learning: ${path[i].conceptName}`);

			// Phase 1: Multi-perspective recurrent-depth learning
			while (true) {
				const result = await this.runOneRound();
				if (!result) break;

				totalRounds++;
				allRoundDetails.push(result);
				messages.push(
					`  Round ${result.round} (${result.perspective}): confidence=${result.confidence.toFixed(2)}`,
				);

				if (this.loop.isCurrentConceptComplete()) {
					messages.push(`  Mastered: ${path[i].conceptName}`);
					break;
				}
			}

			// Phase 2: Self-test verification
			const allConcepts = this.kg.getAllConcepts();
			const currentConcept = allConcepts.find((c) => c.name === path[i].conceptName);
			if (currentConcept) {
				messages.push(`  Self-testing: ${path[i].conceptName}`);
				const testResults = await this.runSelfTest(currentConcept.id);
				allSelfTestResults.push(...testResults);

				const correctCount = testResults.filter((r) => r.correct).length;
				messages.push(`  Self-test: ${correctCount}/${testResults.length} correct`);

				// Phase 3: Targeted remediation for blind spots
				const blindSpots = this.kg.getBlindSpots(0.6);
				const conceptBlindSpots = blindSpots.filter((bs) => bs.conceptId === currentConcept.id);

				if (conceptBlindSpots.length > 0) {
					messages.push(`  Remediating ${conceptBlindSpots.length} blind spots...`);
					const fixResult = await this.runOneRound();
					if (fixResult) {
						totalRounds++;
						allRoundDetails.push(fixResult);
						messages.push(
							`  Fix round (${fixResult.perspective}): confidence=${fixResult.confidence.toFixed(2)}`,
						);
					}
				}
			}

			this.loop.advanceToNextConcept();
		}

		const finalBlindSpots = this.kg.getBlindSpots(0.6);

		// ── Phase 4: Dreaming (Anthropic pattern) ──────────────────────────
		let dreaming: DreamingResult | undefined;
		if (this.dreamingEnabled) {
			dreaming = await this.dream(topic, allRoundDetails, allSelfTestResults);
			messages.push("");
			messages.push(`Dreaming complete (${dreaming.durationMs}ms):`);
			messages.push(`  Concepts merged: ${dreaming.conceptsMerged} | Pruned: ${dreaming.conceptsPruned}`);
			messages.push(
				`  Principles: ${dreaming.principlesExtracted} | Strategies: ${dreaming.strategiesIdentified} | Pitfalls: ${dreaming.pitfallsCataloged}`,
			);
			messages.push(`  Playbook v${dreaming.playbook.version}: ${dreaming.playbook.changeLog}`);
		}

		return {
			topic,
			conceptsLearned: path.length,
			totalRounds,
			finalBlindSpots: finalBlindSpots.length,
			messages,
			roundDetails: allRoundDetails,
			selfTestResults: allSelfTestResults,
			dreaming,
		};
	}
}

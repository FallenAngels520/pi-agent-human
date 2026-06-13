import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getEnvApiKey, getModel, streamSimple } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Type } from "typebox";
import { AutonomousLearner } from "../autonomous-learner.ts";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import { TaskBoard } from "../task-board.ts";
import { LearningRegistry } from "./learning-registry.ts";

export interface LearnerConfig {
	/** Learning domain, e.g. "Bevy ECS". Used to namespace tasks and KG. */
	domain?: string;
	/** Provider name, e.g. "deepseek", "anthropic". */
	provider: string;
	/** Model ID, e.g. "deepseek-v4-pro". */
	modelId: string;
	/** API key. Falls back to env var if empty. */
	apiKey?: string;
	/** Shared knowledge graph — learners write here, query reads from here. */
	kg?: KnowledgeGraph;
	/** Max learning rounds per concept (default 5). */
	maxRounds?: number;
	/** Confidence threshold for mastery (default 0.8). */
	confidenceThreshold?: number;
	/** Max parallel learners (default 2). */
	maxConcurrency?: number;
	/** Progress callback. Default: silent. */
	onProgress?: (msg: string) => void;
}

export interface LearningResult {
	domain: string;
	tasks_completed: number;
	concepts_learned: number;
	total_rounds: number;
	duration_ms: number;
}

/**
 * BackgroundPool manages a fixed-size pool of Learner agents.
 * Learners claim tasks from a TaskBoard, run multi-round learning,
 * and write results to a shared Knowledge Graph.
 *
 * Modeled after learn-claude-code s11 (autonomous agents) and
 * Claude Code's Agent tool with run_in_background.
 */
export class BackgroundPool {
	private config: LearnerConfig;
	private running = false;
	private completedCallbacks: Array<(result: LearningResult) => void> = [];
	private taskBoard = new TaskBoard();
	private registry = new LearningRegistry();

	constructor(config: LearnerConfig) {
		this.config = {
			maxRounds: 5,
			confidenceThreshold: 0.8,
			maxConcurrency: 2,
			apiKey: "",
			...config,
		};
	}

	/** Submit a learning session. Starts N learners. Returns immediately. */
	submit(
		topic: string,
		_concepts: Array<string | { name: string; prerequisites: string[] }>,
		subTasks?: Array<{ id: number; subject: string; blockedBy: number[] }>,
	): void {
		if (this.running) return;

		const domain = this.config.domain ?? topic.replace(/\s+/g, "-").toLowerCase();

		// Build task board
		if (subTasks && subTasks.length > 0) {
			for (const st of subTasks) {
				this.taskBoard.create(domain, st.subject, st.blockedBy);
			}
		}

		this.running = true;
		const startTime = Date.now();
		let activeCount = 0;
		const maxConcurrency = this.config.maxConcurrency ?? 2;

		const log = (msg: string) => this.config.onProgress?.(msg);

		const runOneLearner = (name: string) => {
			activeCount++;
			// Each learner runs in its own async context (microtask-queued)

			const tick = () => {
				const unclaimed = this.taskBoard.scanUnclaimed(domain);
				if (unclaimed.length === 0) {
					activeCount--;
					if (activeCount === 0) {
						this.running = false;
						const result: LearningResult = {
							domain,
							tasks_completed: this.taskBoard.getProgress(domain).completed,
							concepts_learned: 0,
							total_rounds: 0,
							duration_ms: Date.now() - startTime,
						};
						for (const cb of this.completedCallbacks) cb(result);
					}
					return;
				}

				// Scenario 1: skip if another learner is already on this concept
				const task = unclaimed[0];
				const otherLearner = this.registry.isBeingLearned(task.subject);
				if (otherLearner && otherLearner !== name) {
					log(`[${name}] ⏭️ Skip "${task.subject}" — ${otherLearner} is already learning it`);
					tick();
					return;
				}

				const claimResult = this.taskBoard.claim(domain, task.id, name);
				if (!claimResult.ok) {
					tick();
					return;
				}

				this.registry.register(name, claimResult.task.subject);
				log(`[${name}] 📍 Learning: "${claimResult.task.subject}"`);

				// Scenario 2: check stuck hints from previous attempts
				const hints = this.registry.getStuckHints(claimResult.task.subject);
				if (hints) log(`[${name}] 💡 Hints:\n${hints}`);

				this.runLearningRound(domain, claimResult.task.subject, [claimResult.task.subject])
					.then((roundResult) => {
						if (roundResult && roundResult.confidence < 0.5) {
							this.registry.markStuck(name, claimResult.task.subject, {
								confidence: roundResult.confidence,
								findings: roundResult.findings ?? "",
								uncertainties: roundResult.uncertainties ?? "",
							});
							log(
								`[${name}] 📝 Left hints for "${claimResult.task.subject}" (conf=${roundResult.confidence.toFixed(2)})`,
							);
						}
						this.registry.complete(claimResult.task.subject);
						this.taskBoard.update(domain, task.id, "completed");
						log(`[${name}] ✅ Completed: "${claimResult.task.subject}"`);
						tick();
					})
					.catch((err) => {
						this.registry.markStuck(name, claimResult.task.subject, {
							confidence: 0,
							findings: "",
							uncertainties: String(err),
						});
						this.registry.complete(claimResult.task.subject);
						this.taskBoard.update(domain, task.id, "failed");
						log(`[${name}] ❌ Failed: "${claimResult.task.subject}" — ${String(err)}`);
						tick();
					});
			};

			tick();
		};

		// Launch multiple learners concurrently
		for (let i = 0; i < maxConcurrency; i++) {
			runOneLearner(`learner-${String.fromCharCode(97 + i)}`); // learner-a, learner-b, ...
		}
	}

	/** Register a callback for when all learners complete. */
	onComplete(callback: (result: LearningResult) => void): void {
		this.completedCallbacks.push(callback);
	}

	/** Get the task board (for querying progress). */
	getTaskBoard(): TaskBoard {
		return this.taskBoard;
	}

	/** Check if currently running. */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Create a single Learner agent. Each learner gets:
	 * - A fresh Agent instance with restricted tools
	 * - Access to web_search, web_fetch for research
	 * - Add-only KG tools (add_concept, add_evidence, add_relation)
	 * - No learn_topic (prevents recursion)
	 * - No bash, write, edit (read-only on external world)
	 */
	private createSingleLearner(domain: string, name: string): Agent {
		const apiKey = this.config.apiKey || getEnvApiKey(this.config.provider);
		const model = getModel(this.config.provider as any, this.config.modelId as any);
		if (!model) throw new Error(`Model not found: ${this.config.provider}/${this.config.modelId}`);

		// Restricted tools for learner: search tools only, no coding tools
		// The learner's system prompt tells it:
		// "Your ONLY job: learn. Search, read, add to knowledge graph."
		const agent = new Agent({
			streamFn: streamSimple,
			getApiKey: () => apiKey,
			initialState: {
				model: model as Model<any>,
				systemPrompt: [
					`You are '${name}', a learning specialist. Your ONLY job: learn about '${domain}'.`,
					"",
					"CRITICAL RULES:",
					"1. Search the web for authoritative sources (web_search).",
					"2. Read full articles (web_fetch).",
					"3. Add what you learn to the knowledge graph (add_concept + add_evidence).",
					"4. Link related concepts (add_relation, query_concepts).",
					"5. You do NOT have: bash, write, edit, learn_topic.",
					"   You CANNOT modify files or spawn other learners.",
					"6. Respond with: {findings, contradictions, uncertainties, confidence}",
				].join("\n"),
				tools: [], // Tools will be set by caller (domain-agent init)
			},
		});

		return agent;
	}

	/**
	 * Run one round of multi-perspective learning for a concept.
	 * Uses the AutonomousLearner internally.
	 */

	private async runLearningRound(
		domain: string,
		conceptName: string,
		concepts: string[],
	): Promise<{ confidence: number; findings: string; uncertainties: string }> {
		if (!this.config.kg) {
			return { confidence: 0, findings: "", uncertainties: "No shared KG configured" };
		}

		const apiKey = this.config.apiKey || getEnvApiKey(this.config.provider);

		const learner = new AutonomousLearner({
			provider: this.config.provider,
			modelId: this.config.modelId,
			apiKey,
			domain,
			kg: this.config.kg,
			maxRounds: this.config.maxRounds,
			confidenceThreshold: this.config.confidenceThreshold,
			maxConceptsPerSession: 1,
			perspectives: [{ name: "default", instruction: "Research and learn" }],
			practicalApplicationEnabled: false,
			frontierExpansionEnabled: false,
			dreamingEnabled: false,
			onProgress: (msg: string) => this.config.onProgress?.(msg),
		});

		await learner.init();

		try {
			const result = await learner.learn(domain, concepts);
			const allConcepts = this.config.kg!.getAllConcepts();
			const updated = allConcepts.find((c) => c.name.toLowerCase() === conceptName.toLowerCase());
			return {
				confidence: updated?.confidence ?? 0,
				findings: result.sessionLog
					? result.sessionLog
							.map((e) => e.type)
							.join(" | ")
							.slice(0, 500)
					: "",
				uncertainties:
					(result.finalBlindSpots?.length ?? 0) > 0 ? `${result.finalBlindSpots.length} blind spots remain` : "",
			};
		} catch (err) {
			return {
				confidence: 0,
				findings: "",
				uncertainties: String(err),
			};
		}
	}
}

// ── Main Agent Tools ──────────────────────────────────────────────────────────
//
// These tools are registered on the Main Agent. They let the Main Agent
// spawn background learners, query knowledge, and check learning progress.
// All three are AgentTool instances that can be added to Agent.state.tools.

const learnTopicSchema = Type.Object({
	topic: Type.String({ description: "The topic/domain to learn about" }),
	concepts: Type.Array(
		Type.Union([
			Type.String(),
			Type.Object({
				name: Type.String(),
				prerequisites: Type.Array(Type.String()),
			}),
		]),
		{ description: "Concepts to learn. Strings or { name, prerequisites } objects." },
	),
	learner_count: Type.Optional(Type.Number({ description: "Number of parallel learners (default: 2)" })),
});

export function createLearnTopicTool(
	pools: Map<string, BackgroundPool>,
	sharedKg?: KnowledgeGraph,
	onProgress?: (msg: string) => void,
): AgentTool<typeof learnTopicSchema> {
	return {
		name: "learn_topic",
		label: "Learn Topic",
		description:
			"Spawn background learner agents to acquire deep knowledge about a domain. " +
			"Returns immediately — use check_learning to track progress and query_knowledge " +
			"to access learned knowledge. Multiple learners run in parallel, sharing tasks via a board.",
		parameters: learnTopicSchema,
		execute: async (
			_toolCallId,
			params: Static<typeof learnTopicSchema>,
			_signal?: AbortSignal,
		): Promise<AgentToolResult<any>> => {
			const domain = params.topic.replace(/\s+/g, "-").toLowerCase();
			const provider = process.env.PI_PROVIDER ?? "deepseek";
			const modelId = process.env.PI_MODEL_ID ?? "deepseek-v4-pro";
			const pool = new BackgroundPool({
				domain,
				provider,
				modelId,
				kg: sharedKg,
				maxConcurrency: params.learner_count ?? 2,
				onProgress,
			});

			pools.set(domain, pool);

			pool.submit(params.topic, params.concepts);
			pool.onComplete((result) => {
				onProgress?.(
					`✅ Learning complete: ${result.domain} — ${result.tasks_completed} tasks in ${(result.duration_ms / 1000).toFixed(0)}s`,
				);
			});

			return {
				content: [
					{
						type: "text",
						text: [
							`Started learning "${params.topic}" with ${pool.getTaskBoard().listAll(domain).length || params.concepts.length} tasks`,
							`and ${params.learner_count ?? 2} parallel learners.`,
							"",
							`Use check_learning("${domain}") to track progress.`,
							`Use query_knowledge("<question>") once tasks are completed.`,
						].join("\n"),
					},
				],
				details: {
					topic: params.topic,
					domain,
					status: "learning",
					learner_count: params.learner_count ?? 2,
				},
			};
		},
	};
}

// ── check_learning ────────────────────────────────────────────────────────────

const checkLearningSchema = Type.Object({
	domain: Type.String({ description: "The domain to check learning progress for" }),
});

export function createCheckLearningTool(pools: Map<string, BackgroundPool>): AgentTool<typeof checkLearningSchema> {
	return {
		name: "check_learning",
		label: "Check Learning",
		description: "Check the progress of background learning tasks for a domain.",
		parameters: checkLearningSchema,
		execute: async (
			_toolCallId,
			params: Static<typeof checkLearningSchema>,
			_signal?: AbortSignal,
		): Promise<AgentToolResult<any>> => {
			const pool = pools.get(params.domain);
			if (!pool) {
				return {
					content: [
						{
							type: "text",
							text: `No active learning session found for "${params.domain}". Use learn_topic to start one.`,
						},
					],
					details: { domain: params.domain, found: false },
				};
			}

			const tb = pool.getTaskBoard();
			const progress = tb.getProgress(params.domain);
			const allTasks = tb.listAll(params.domain);

			const taskList = allTasks
				.map((t) => `  - [${t.status}] ${t.subject} ${t.owner ? `(owner: ${t.owner})` : ""}`)
				.join("\n");

			const status = tb.isAllDone(params.domain) ? "done" : "learning";

			return {
				content: [
					{
						type: "text",
						text: [
							`Learning "${params.domain}": ${status === "done" ? "✅ Complete" : "🔄 In progress"}`,
							`Progress: ${progress.completed}/${progress.total} tasks completed`,
							taskList ? `\nTasks:\n${taskList}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				details: {
					domain: params.domain,
					status,
					progress,
					tasks: allTasks.map((t) => ({
						id: t.id,
						subject: t.subject,
						status: t.status,
						owner: t.owner,
					})),
				},
			};
		},
	};
}

// ── query_knowledge ───────────────────────────────────────────────────────────

const queryKnowledgeSchema = Type.Object({
	question: Type.String({ description: "The question to query the knowledge graph for" }),
});

export function createQueryKnowledgeTool(
	kg: KnowledgeGraph,
	pools?: Map<string, BackgroundPool>,
): AgentTool<typeof queryKnowledgeSchema> {
	return {
		name: "query_knowledge",
		label: "Query Knowledge",
		description:
			"Query the knowledge graph for an answer to a question. " +
			"Returns existing knowledge immediately (no API calls). " +
			"If the topic is currently being learned, reports status. " +
			"If unknown, suggests using learn_topic.",
		parameters: queryKnowledgeSchema,
		execute: async (
			_toolCallId,
			params: Static<typeof queryKnowledgeSchema>,
			_signal?: AbortSignal,
		): Promise<AgentToolResult<any>> => {
			const question = params.question;
			const questionLower = question.toLowerCase();
			const concepts = kg.getAllConcepts();

			// Find matching concepts via keyword overlap
			const questionWords = new Set(questionLower.split(/\s+/));
			const relevant = concepts
				.map((c) => {
					const nameLower = c.name.toLowerCase();
					const descLower = c.description.toLowerCase();
					let overlap = 0;
					for (const w of questionWords) {
						if (w.length < 3) continue;
						if (nameLower.includes(w) || descLower.includes(w)) overlap++;
					}
					return { concept: c, score: overlap };
				})
				.filter((r) => r.score > 0)
				.sort((a, b) => b.concept.confidence * b.score - a.concept.confidence * a.score);

			const goodMatch = relevant.find((r) => r.concept.confidence >= 0.6);
			if (goodMatch) {
				const c = goodMatch.concept;
				const evidence = c.evidence.map((e) => `${e.type}: ${e.source}`).join("\n");
				return {
					content: [
						{
							type: "text",
							text: [
								`**${c.name}** (confidence: ${c.confidence.toFixed(2)})`,
								c.description,
								evidence ? `\nSources:\n${evidence}` : "",
							]
								.filter(Boolean)
								.join("\n"),
						},
					],
					details: {
						status: "found",
						confidence: c.confidence,
						source_concepts: [c.name],
					},
				};
			}

			// Check if currently learning
			if (pools) {
				for (const [domain, pool] of pools) {
					const domainWords = domain.split(/[\s-]+/).filter((w) => w.length > 2);
					const anyWordMatches = domainWords.some((dw) => questionLower.includes(dw));
					if (pool.isRunning() && anyWordMatches) {
						const progress = pool.getTaskBoard().getProgress(domain);
						return {
							content: [
								{
									type: "text",
									text: `Knowledge about "${question}" is being learned right now. ${progress.completed}/${progress.total} tasks completed. Use check_learning("${domain}") for details.`,
								},
							],
							details: {
								status: "learning",
								domain,
								progress,
							},
						};
					}
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `No knowledge found for "${question}". Use learn_topic to start learning about this topic.`,
					},
				],
				details: { status: "unknown" },
			};
		},
	};
}

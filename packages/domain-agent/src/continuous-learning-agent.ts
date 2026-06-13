import { writeFile } from "node:fs/promises";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { DeepThinkingInput, DeepThinkingMode, DeepThinkingResult } from "./deep-thinking.ts";
import { DreamingEngine } from "./dreaming.ts";
import { Innovation } from "./innovation.ts";
import { JudgeAgent, type JudgmentCriterion } from "./judge.ts";
import { KnowledgeGraph } from "./knowledge-graph.ts";
import type { LongTermMemoryContext, LongTermMemoryEventType, LongTermMemoryLike } from "./long-term-memory.ts";
import { tryParseStructuredFindings } from "./parse-result.ts";
import { SelfTest } from "./self-test.ts";
import { KnowledgeSynthesis } from "./synthesis.ts";
import type { BlindSpot, Concept, DreamingConfig, DreamingResult, Perspective, Playbook } from "./types.ts";
import { createConcept } from "./types.ts";

export interface ContinuousLearningConfig {
	agent: Agent;
	perspectives: Perspective[];
	verifierModel: Model<string>;
	maxRounds: number;
	confidenceThreshold: number;
	plateauThreshold: number;
	maxConceptsPerSession: number;
	practicalApplicationEnabled: boolean;
	frontierExpansionEnabled: boolean;
	domain?: string;
	deepThinking?: DeepThinkingEngineLike;
	longTermMemory?: LongTermMemoryLike;
	knowledgeGraphFile?: string;
	checkpointFile?: string;
	/** Enable post-session dreaming. Default: true. */
	dreamingEnabled?: boolean;
	/** Dreaming engine configuration. */
	dreamingConfig?: Partial<DreamingConfig>;
	onProgress?: (msg: string) => void;
}

export interface DeepThinkingEngineLike {
	think(input: DeepThinkingInput): Promise<DeepThinkingResult>;
}

export type SessionEntry =
	| { type: "learn"; conceptName: string; result: LearnConceptResult }
	| { type: "verify"; conceptName: string; result: VerifyConceptResult }
	| { type: "apply"; conceptName: string; result: ApplyConceptResult }
	| { type: "synthesize"; result: SynthesizeResult }
	| { type: "innovate"; result: InnovateResult }
	| { type: "deep_thinking"; mode: DeepThinkingMode; result: DeepThinkingResult };

export interface LearnConceptResult {
	conceptId: string;
	conceptName: string;
	rounds: number;
	finalConfidence: number;
	passed: boolean;
	feedback: string;
}

export interface VerifyConceptResult {
	conceptId: string;
	totalQuestions: number;
	correctAnswers: number;
	newBlindSpots: number;
	updatedConfidence: number;
}

export interface ApplyConceptResult {
	conceptId: string;
	exerciseDescription: string;
	passed: boolean;
	gapsIdentified: number;
	feedback: string;
}

export interface SynthesizeResult {
	conceptCount: number;
	insightProduced: boolean;
	summary: string;
}

export interface InnovateResult {
	frontiersDetected: number;
	newConceptsAdded: number;
	summary: string;
}

export interface ContinuousLearningResult {
	conceptsLearned: number;
	totalRounds: number;
	sessionLog: SessionEntry[];
	finalBlindSpots: BlindSpot[];
	knowledgeGraphSize: number;
	/** Dreaming result (populated when dreamingEnabled is true). */
	dreaming?: DreamingResult;
	/** The playbook from the dreaming pass. */
	playbook?: Playbook;
}

/** Extract text from the most recent assistant turn only (since last user message). */
function extractLastAssistantText(messages: readonly { role?: string; content?: unknown }[]): string {
	const parts: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!("role" in msg)) continue;
		if (msg.role === "user") break;
		if (msg.role !== "assistant") continue;
		if (!("content" in msg)) continue;
		const content = msg.content;
		if (typeof content === "string") {
			parts.unshift(content);
		} else if (Array.isArray(content)) {
			for (let j = content.length - 1; j >= 0; j--) {
				const b = content[j] as { type?: string; text?: string };
				if (b.type === "text" && typeof b.text === "string") parts.unshift(b.text);
			}
		}
	}
	return parts.join("\n");
}

function findConceptByName(kg: KnowledgeGraph, name: string): Concept | undefined {
	return kg.getAllConcepts().find((c) => c.name === name);
}

function summarizeConcept(concept: Concept | undefined): string | undefined {
	if (!concept) return undefined;
	const evidence = concept.evidence.map((item) => `${item.type}: ${item.source}`).join("\n");
	return [
		`Concept: ${concept.name}`,
		`Description: ${concept.description}`,
		`Confidence: ${concept.confidence}`,
		`Status: ${concept.status}`,
		evidence ? `Evidence:\n${evidence}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function formatDeepThinkingGuidance(result: DeepThinkingResult | undefined): string {
	if (!result) return "";
	const lines = ["## Deep Thinking Guidance"];
	if (result.conclusions.length > 0) lines.push("Conclusions:", ...result.conclusions.map((item) => `- ${item}`));
	if (result.assumptions.length > 0) lines.push("Assumptions:", ...result.assumptions.map((item) => `- ${item}`));
	if (result.contradictions.length > 0)
		lines.push("Contradictions:", ...result.contradictions.map((item) => `- ${item}`));
	if (result.blindSpots.length > 0) lines.push("Blind spots:", ...result.blindSpots.map((item) => `- ${item}`));
	if (result.nextResearchQuestions.length > 0)
		lines.push("Research questions:", ...result.nextResearchQuestions.map((item) => `- ${item}`));
	if (result.nextPracticeTasks.length > 0)
		lines.push("Practice tasks:", ...result.nextPracticeTasks.map((item) => `- ${item}`));
	if (result.innovationHypotheses.length > 0)
		lines.push("Innovation hypotheses:", ...result.innovationHypotheses.map((item) => `- ${item}`));
	lines.push(`Confidence: ${result.confidence}`);
	return lines.join("\n");
}

function formatMemoryContext(context: LongTermMemoryContext | undefined): string {
	if (!context?.summary) return "";
	return ["## Long-Term Memory Context", context.summary].join("\n");
}

/**
 * {@link ContinuousLearningAgent} wires the cognitive layer into the agent harness.
 *
 * Integration points:
 *   - {@link JudgeAgent} (from agent harness) — maker/checker verification at each round
 *   - {@link SelfTest} — recall/application/boundary question generation
 *   - {@link Innovation} — frontier expansion when no blind spots remain
 *   - {@link KnowledgeSynthesis} — cross-concept insight generation
 *   - Knowledge graph + checkpoint persistence — cross-session continuity
 *
 * Flow:
 *   pick gap → multi-perspective learning → JudgeAgent verify →
 *   SelfTest → apply → gaps feed back → synthesize →
 *   expand frontiers → persist → repeat
 *
 * Usage:
 * ```ts
 * const agent = new ContinuousLearningAgent({
 *   agent: codingAgent,
 *   perspectives: [
 *     { name: "Theory", instruction: "Research fundamental principles" },
 *     { name: "Practice", instruction: "Find real-world applications" },
 *     { name: "Critique", instruction: "Identify limitations and edge cases" },
 *   ],
 *   verifierModel: haikuModel,
 *   maxRounds: 5,
 *   confidenceThreshold: 0.8,
 *   plateauThreshold: 3,
 *   maxConceptsPerSession: 10,
 *   practicalApplicationEnabled: true,
 *   frontierExpansionEnabled: true,
 *   knowledgeGraphFile: ".pi/knowledge-graph.json",
 *   checkpointFile: ".pi/learning-checkpoint.json",
 * });
 *
 * agent.seedConcepts("Rust Ownership", [
 *   "Ownership",
 *   { name: "Borrowing", prerequisites: ["Ownership"] },
 *   { name: "Lifetimes", prerequisites: ["Borrowing"] },
 * ]);
 *
 * const result = await agent.run();
 * ```
 */
export class ContinuousLearningAgent {
	private agent: Agent;
	private kg: KnowledgeGraph;
	private selfTest: SelfTest;
	private innovation: Innovation;
	private synthesis: KnowledgeSynthesis;
	private config: ContinuousLearningConfig;
	private sessionLog: SessionEntry[] = [];
	private totalRounds = 0;
	/** Event IDs that have been recorded but not yet consolidated. */
	private pendingEventIds: string[] = [];
	/** Per-perspective contribution tracking for strategy bandit. */
	private perspectiveStats: Map<string, { rounds: number; totalConfidenceGain: number }> = new Map();
	/** Dreaming engine for post-session memory consolidation. */
	private dreamingEngine: DreamingEngine;
	private onProgress?: (msg: string) => void;
	/** Stored playbook from the most recent dreaming pass. */
	private playbook: Playbook | undefined;

	constructor(config: ContinuousLearningConfig) {
		this.config = config;
		this.agent = config.agent;
		this.kg = new KnowledgeGraph();
		this.selfTest = new SelfTest(this.kg);
		this.innovation = new Innovation(this.kg);
		this.synthesis = new KnowledgeSynthesis(this.kg);
		this.dreamingEngine = new DreamingEngine(config.dreamingConfig);
		this.onProgress = config.onProgress;
	}

	async loadState(): Promise<boolean> {
		if (!this.config.knowledgeGraphFile) return false;
		return this.kg.loadFromFile(this.config.knowledgeGraphFile);
	}

	async saveState(): Promise<void> {
		if (this.config.knowledgeGraphFile) {
			await this.kg.saveToFile(this.config.knowledgeGraphFile);
		}
		if (this.config.checkpointFile) {
			const checkpoint = {
				conceptsLearned: this.sessionLog.length,
				totalRounds: this.totalRounds,
				sessionLog: this.sessionLog,
				lastUpdated: new Date().toISOString(),
			};
			try {
				await writeFile(this.config.checkpointFile, JSON.stringify(checkpoint, null, 2), "utf-8");
			} catch {
				// Best-effort
			}
		}
	}

	seedConcepts(topic: string, concepts: Array<string | { name: string; prerequisites: string[] }>): void {
		for (const item of concepts) {
			const seed = typeof item === "string" ? { name: item, prerequisites: [] as string[] } : item;
			this.kg.addConcept(createConcept({ name: seed.name, description: `Part of: ${topic}` }));
		}
		const allConcepts = this.kg.getAllConcepts();
		const nameToId = new Map(allConcepts.map((c) => [c.name, c.id]));
		for (const item of concepts) {
			const seed = typeof item === "string" ? { name: item, prerequisites: [] as string[] } : item;
			const conceptId = nameToId.get(seed.name);
			if (!conceptId) continue;
			for (const prereqName of seed.prerequisites) {
				const prereqId = nameToId.get(prereqName);
				if (prereqId) {
					this.kg.addRelation({ fromId: prereqId, toId: conceptId, type: "prerequisite_of", confidence: 1 });
				}
			}
		}
	}

	private get domain(): string {
		return this.config.domain ?? "general";
	}

	private buildKnowledgeSummary(extra?: string): string {
		const concepts = this.kg
			.getAllConcepts()
			.map((concept) => `${concept.name} (${concept.status}, confidence=${concept.confidence})`)
			.join("\n");
		const profile = this.buildCapabilityProfile();
		return [profile, concepts ? `Known concepts:\n${concepts}` : "No known concepts yet.", extra]
			.filter(Boolean)
			.join("\n\n");
	}

	private async recallMemory(input: Omit<DeepThinkingInput, "domain">): Promise<LongTermMemoryContext | undefined> {
		const memory = this.config.longTermMemory;
		if (!memory) return undefined;

		// v2: LLM query expansion for semantic retrieval
		let expandedQuery = input.objective;
		if (this.config.deepThinking) {
			try {
				const expansion = await this.config.deepThinking.think({
					domain: this.domain,
					mode: "learn",
					objective: `Generate related search keywords for: ${input.objective.slice(0, 200)}`,
					constraints: [
						"Output 5-8 specific search terms that would help find relevant past experiences, related concepts, and common patterns.",
						"Include synonyms, related concepts, and potential pitfalls.",
					],
					maxOutputItems: 8,
				});
				if (expansion && expansion.conclusions.length > 0) {
					expandedQuery = [input.objective, ...expansion.conclusions].join(" ");
				}
			} catch {
				// Fall back to original query on expansion failure
			}
		}

		const context = await memory.buildContext({
			domain: this.domain,
			query: expandedQuery,
			mode: input.mode,
			limit: input.maxOutputItems ?? 5,
			path: input.memoryPath,
		});
		// Record recall for utility tracking — items that help get reinforced
		if (context.distilledKnowledge.length > 0) {
			const distilledIds = context.distilledKnowledge.map((item) => item.id);
			memory.recordDistilledRecall(distilledIds).catch(() => {});
		}
		return context;
	}

	private async recordMemoryEvent(input: {
		type: LongTermMemoryEventType;
		title: string;
		text: string;
		conceptName?: string;
		mode?: DeepThinkingMode;
		facts?: string[];
		concepts?: string[];
		metadata?: Record<string, unknown>;
	}): Promise<string | undefined> {
		const memory = this.config.longTermMemory;
		if (!memory) return undefined;
		const event = await memory.recordEvent({
			domain: this.domain,
			...input,
		});
		this.pendingEventIds.push(event.id);
		return event.id;
	}

	private async deepThink(input: Omit<DeepThinkingInput, "domain">): Promise<DeepThinkingResult | undefined> {
		const engine = this.config.deepThinking;
		if (!engine) return undefined;
		const memoryContext = await this.recallMemory(input);
		const knowledgeSummary = [input.knowledgeSummary, formatMemoryContext(memoryContext)]
			.filter(Boolean)
			.join("\n\n");
		const result = await engine.think({ domain: this.domain, ...input, knowledgeSummary });
		this.sessionLog.push({ type: "deep_thinking", mode: result.mode, result });
		await this.recordMemoryEvent({
			type: "deep_thinking",
			title: `Deep thinking: ${result.mode}`,
			text: JSON.stringify(result),
			mode: result.mode,
			facts: result.knowledgeUpdates,
			concepts: result.conclusions,
		});
		return result;
	}

	async run(onProgress?: (msg: string) => void): Promise<ContinuousLearningResult> {
		const log = (msg: string) => {
			this.onProgress?.(msg);
			onProgress?.(msg);
		};

		await this.loadState();
		let conceptsLearned = 0;
		const maxConcepts = this.config.maxConceptsPerSession;
		const target = this.config.confidenceThreshold;

		log(`🚀 Starting learning session | domain: ${this.domain} | max concepts: ${maxConcepts}`);

		const kgStart = this.kg.getAllConcepts();
		if (kgStart.length > 0) {
			log(`   Knowledge graph: ${kgStart.length} concepts loaded`);
		}

		while (conceptsLearned < maxConcepts) {
			const allBlindSpots = this.kg.getBlindSpots(target);
			// Only pick concepts whose prerequisites are met
			const readyIds = new Set(this.kg.getReadyToLearn().map((c) => c.id));
			const blindSpots = allBlindSpots.filter((bs) => readyIds.has(bs.conceptId));

			if (blindSpots.length === 0) {
				// If there are unready blind spots (blocked by prerequisites), learn their prereqs first
				if (allBlindSpots.length > 0) {
					// Force-learn the first blocked concept (prerequisites will be learned in dependency order)
					const blocked = allBlindSpots.filter((bs) => !readyIds.has(bs.conceptId));
					if (blocked.length > 0) {
						// Pick a blocked concept and learn its missing prerequisites instead
						const concept = this.kg.getConcept(blocked[0].conceptId);
						if (concept) {
							const prereqNames = concept.relations
								.filter((r) => r.type === "prerequisite_of")
								.map((r) => {
									const c = this.kg.getConcept(r.fromId);
									return c?.name ?? "";
								})
								.filter(Boolean);
							if (prereqNames.length > 0) {
								// The next iteration will pick up these prerequisite blind spots
								// since they should be in the blind spot list
							}
						}
					}
				}

				if (this.config.frontierExpansionEnabled) {
					const expanded = await this.expandFrontiers();
					if (expanded) continue;
				}
				break;
			}

			const spot = this.pickBlindSpot(blindSpots);

			log(
				`📍 [${conceptsLearned + 1}/${maxConcepts}] Learning: "${spot.conceptName}" | gap: ${spot.gap.slice(0, 80)}`,
			);

			// Phase 1: Learn with perspective rotation + JudgeAgent verification
			const learnResult = await this.learnConcept(spot);
			this.sessionLog.push({ type: "learn", conceptName: spot.conceptName, result: learnResult });
			await this.recordMemoryEvent({
				type: learnResult.passed ? "learning_event" : "failure_event",
				title: `Learned ${spot.conceptName}`,
				text: learnResult.feedback,
				conceptName: spot.conceptName,
				concepts: [spot.conceptName],
				metadata: { ...learnResult },
			});

			if (!learnResult.passed && learnResult.rounds >= this.config.maxRounds) {
				conceptsLearned++;
				await this.saveState();
				continue;
			}

			// Phase 2: SelfTest verification
			log(`   📝 Self-test...`);
			const verifyResult = await this.verifyConcept(spot.conceptId);
			log(
				`   ${verifyResult.correctAnswers >= verifyResult.totalQuestions * 0.6 ? "✅" : "⚠️"}  Score: ${verifyResult.correctAnswers}/${verifyResult.totalQuestions}`,
			);
			this.sessionLog.push({ type: "verify", conceptName: spot.conceptName, result: verifyResult });
			await this.recordMemoryEvent({
				type: "verification_event",
				title: `Verified ${spot.conceptName}`,
				text: `Self-test score: ${verifyResult.correctAnswers}/${verifyResult.totalQuestions}`,
				conceptName: spot.conceptName,
				concepts: [spot.conceptName],
				metadata: { ...verifyResult },
			});

			// Phase 3: Practical application (gaps auto-feed back as new concepts)
			if (this.config.practicalApplicationEnabled && learnResult.passed) {
				const applyResult = await this.applyConcept(spot.conceptId);
				this.sessionLog.push({ type: "apply", conceptName: spot.conceptName, result: applyResult });
				await this.recordMemoryEvent({
					type: applyResult.passed ? "application_event" : "failure_event",
					title: `Applied ${spot.conceptName}`,
					text: [applyResult.exerciseDescription, applyResult.feedback].filter(Boolean).join("\n\n"),
					conceptName: spot.conceptName,
					concepts: [spot.conceptName],
					metadata: { ...applyResult },
				});
			}

			// Phase 1: Consolidate this concept experience into distilled knowledge
			await this.consolidateConceptExperience(spot.conceptName);
			conceptsLearned++;

			// Phase 4: Synthesize periodically
			const mastered = this.kg.getAllConcepts().filter((c) => c.status === "mastered");
			if (mastered.length >= 3 && conceptsLearned % 3 === 0) {
				const synthResult = await this.synthesizeKnowledge(mastered.map((c) => c.id));
				this.sessionLog.push({ type: "synthesize", result: synthResult });
				await this.recordMemoryEvent({
					type: "synthesis_event",
					title: "Synthesized mastered concepts",
					text: synthResult.summary,
					concepts: mastered.map((concept) => concept.name),
					metadata: { ...synthResult },
				});
			}

			// Phase 5: Consolidate all remaining experience at session end
			await this.consolidateSessionEnd();
			await this.saveState();
		}

		const finalBlindSpots = this.kg.getBlindSpots(target);

		// ── Phase 6: Dreaming (Anthropic pattern) ──────────────────────────
		let dreaming: DreamingResult | undefined;
		if (this.config.dreamingEnabled !== false) {
			const domain = this.config.domain ?? "general";
			dreaming = await this.dreamingEngine.dream(this.kg, [], [], domain, this.playbook);
			this.playbook = dreaming.playbook;
		}

		return {
			conceptsLearned,
			totalRounds: this.totalRounds,
			sessionLog: this.sessionLog,
			finalBlindSpots,
			knowledgeGraphSize: this.kg.size,
			dreaming,
			playbook: this.playbook,
		};
	}

	private pickBlindSpot(spots: BlindSpot[]): BlindSpot {
		return spots.sort((a, b) => {
			const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
			return order[a.severity] - order[b.severity] || a.conceptName.localeCompare(b.conceptName);
		})[0];
	}

	/**
	 * Learn one concept using multi-perspective round-robin learning
	 * with {@link JudgeAgent} maker/checker verification at each round.
	 */
	private async learnConcept(blindSpot: BlindSpot): Promise<LearnConceptResult> {
		const conceptName = blindSpot.conceptName;
		const concept = findConceptByName(this.kg, conceptName);
		const conceptId = concept?.id ?? "";

		const goal = blindSpot.gap.includes("Confidence")
			? `Deeply understand and master the concept: ${conceptName}`
			: `${conceptName}: ${blindSpot.gap}`;
		// Phase 2: Inject historical failure prevention context
		const failurePrevention = await this.buildFailurePreventionContext(conceptName);

		const deepGuidance = await this.deepThink({
			mode: "learn",
			objective: goal,
			memoryPath: {
				domain: this.domain,
				capability: "learning",
				concept: conceptName,
				situation: goal,
			},
			knowledgeSummary: this.buildKnowledgeSummary(summarizeConcept(concept)),
			observations: [blindSpot.gap],
			constraints: [
				"Identify assumptions, contradictions, missing evidence, and practice tasks before the learning round.",
			],
		});

		const judge = new JudgeAgent({ model: this.config.verifierModel });

		const criteria: JudgmentCriterion[] = [
			{ name: "clarity", description: "Can explain the concept clearly and accurately" },
			{ name: "evidence", description: "Found authoritative sources and supporting evidence" },
			{ name: "edge_cases", description: "Identified edge cases, limitations, and misconceptions" },
			{ name: "relationships", description: "Related this concept to others in the knowledge graph" },
		];

		const buildRoundPrompt = (iteration: number, perspective: Perspective, feedback?: string): string => {
			const lines = [this.buildLearningPrompt(goal)];
			if (deepGuidance) lines.push("", formatDeepThinkingGuidance(deepGuidance));
			if (failurePrevention) lines.push("", failurePrevention);
			lines.push("", `## Round ${iteration} of ${this.config.maxRounds}`);
			lines.push(`## Perspective: ${perspective.name}`);
			lines.push(`## Approach: ${perspective.instruction}`);
			if (feedback) lines.push("", "## Feedback from Previous Round", feedback);
			lines.push(
				"",
				"## Output Format",
				'Respond with JSON: {"findings": "...", "contradictions": "...", "uncertainties": "...", "confidence": 0.0-1.0}',
			);
			return lines.join("\n");
		};

		return this.runMultiRoundLearning(buildRoundPrompt, judge, criteria, conceptName, conceptId);
	}

	/**
	 * Multi-round learning with perspective rotation + JudgeAgent maker/checker verification.
	 *
	 * Each round: build perspective-aware prompt → agent.prompt → waitForIdle →
	 * parse findings → JudgeAgent.evaluate → pass/feedback/retry.
	 * Stopping: confidence >= threshold, plateau detected, or max rounds reached.
	 */
	private async runMultiRoundLearning(
		buildRoundPrompt: (iteration: number, perspective: Perspective, feedback?: string) => string,
		judge: JudgeAgent,
		criteria: JudgmentCriterion[],
		conceptName: string,
		conceptId: string,
	): Promise<LearnConceptResult> {
		const maxRounds = this.config.maxRounds;
		const confidenceThreshold = this.config.confidenceThreshold;
		const plateauThreshold = this.config.plateauThreshold;
		const confidenceHistory: number[] = [];

		let finalConfidence = 0;
		let passed = false;
		let feedback: string | undefined;
		let round = 0;

		while (round < maxRounds) {
			round++;
			const perspective = this.selectPerspective(round);

			// Build perspective-aware prompt
			const prompt = buildRoundPrompt(round, perspective, feedback);

			// Run the agent
			try {
				await this.agent.prompt(prompt);
				await this.agent.waitForIdle();
			} catch (error) {
				confidenceHistory.push(0);
				feedback = `Error: ${error instanceof Error ? error.message : String(error)}`;
				continue;
			}

			// Parse structured findings
			const agentText = extractLastAssistantText([...this.agent.state.messages]);
			const parsed = this.tryParseRoundResult(agentText);

			if (!parsed) continue;

			finalConfidence = Math.max(finalConfidence, parsed.confidence);
			confidenceHistory.push(parsed.confidence);
			// Track perspective contribution for strategy bandit
			const prevConfidence = confidenceHistory.length >= 2 ? confidenceHistory[confidenceHistory.length - 2] : 0;
			this.recordPerspectiveContribution(perspective.name, parsed.confidence - prevConfidence);
			this.totalRounds++;

			if (conceptId) {
				this.kg.updateConfidence(conceptId, parsed.confidence);
			}

			// ---------- JudgeAgent maker/checker verification ----------
			const verdict = await judge.evaluate(conceptName, criteria, {
				agentWork: extractLastAssistantText([...this.agent.state.messages]).slice(0, 8000),
			});

			if (verdict.passed) {
				passed = true;
				feedback = verdict.summary;
				break;
			}

			// Stopping conditions
			if (parsed.confidence >= confidenceThreshold) {
				passed = true;
				break;
			}

			if (round >= plateauThreshold) {
				const recent = confidenceHistory.slice(-plateauThreshold);
				if (recent.every((c) => c === recent[0])) break;
			}

			feedback = parsed.uncertainties ? `Address these uncertainties: ${parsed.uncertainties}` : verdict.summary;
		}

		return {
			conceptId,
			conceptName,
			rounds: round,
			finalConfidence,
			passed,
			feedback: feedback ?? "",
		};
	}

	/** Parse structured findings from agent output text. Delegates to shared utility. */
	private tryParseRoundResult(
		text: string,
	): { findings: string; contradictions: string; uncertainties: string; confidence: number } | null {
		return tryParseStructuredFindings(text);
	}

	private buildLearningPrompt(goal: string): string {
		return [
			"## Learning Goal",
			goal,
			"",
			"## Instructions — YOU MUST FOLLOW THESE IN ORDER",
			"",
			"STEP 1 (REQUIRED): Call web_search to find authoritative sources about this concept.",
			"  Search for: official documentation, MDN/TypeScript handbook, reputable tutorials.",
			"",
			"STEP 2 (REQUIRED): Call web_fetch on the 2-3 most relevant URLs from search results.",
			"  Read the full articles to extract detailed, accurate information.",
			"",
			"STEP 3: Call add_concept with the knowledge you extracted from the sources.",
			"  Include a thorough description based on what you READ, not what you already know.",
			"",
			"STEP 4: Call add_evidence to record each source URL you used.",
			"  Every concept MUST have at least one evidence entry with the source URL.",
			"",
			"STEP 5: Call query_concepts to check for related concepts in the knowledge graph.",
			"  Then call add_relation to link new concepts to existing ones.",
			"",
			"STEP 6: Identify edge cases, limitations, and common misconceptions.",
			"",
			"CRITICAL RULES:",
			"- You MUST call web_search and web_fetch before adding any concepts.",
			"- You MUST cite sources via add_evidence — no source = no credit.",
			"- Do NOT rely on your pretraining knowledge. Use live web data.",
			"- After completing all steps, respond with structured JSON:",
			'  {"findings": "...", "contradictions": "...", "uncertainties": "...", "confidence": 0.0-1.0}',
		].join("\n");
	}

	/** Self-test via the cognitive layer's SelfTest component. */
	private async verifyConcept(conceptId: string): Promise<VerifyConceptResult> {
		const questions = this.selfTest.generateQuestions(conceptId);
		if (questions.length === 0) {
			return { conceptId, totalQuestions: 0, correctAnswers: 0, newBlindSpots: 0, updatedConfidence: 0 };
		}

		const testPrompt = [
			"## Self-Test",
			"Answer these questions to demonstrate your understanding. Be honest.",
			"",
			...questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question}`),
		].join("\n");

		try {
			await this.agent.prompt(testPrompt);
			await this.agent.waitForIdle();
		} catch {
			return {
				conceptId,
				totalQuestions: questions.length,
				correctAnswers: 0,
				newBlindSpots: questions.length,
				updatedConfidence: 0,
			};
		}

		const responseText = extractLastAssistantText([...this.agent.state.messages]);
		let correct = 0;
		for (const q of questions) {
			if (responseText.toLowerCase().includes(q.conceptName.toLowerCase())) correct++;
		}

		const concept = this.kg.getConcept(conceptId);
		const oldConf = concept?.confidence ?? 0;
		const ratio = questions.length > 0 ? correct / questions.length : 0;
		const newConf = oldConf * 0.3 + ratio * 0.7;
		this.kg.updateConfidence(conceptId, newConf);
		if (correct < questions.length) {
			await this.deepThink({
				mode: "reflect",
				objective: `Reflect on self-test gaps for ${concept?.name ?? conceptId}`,
				memoryPath: {
					domain: this.domain,
					capability: "reflection",
					concept: concept?.name ?? conceptId,
					situation: "Self-test gaps",
				},
				knowledgeSummary: this.buildKnowledgeSummary(summarizeConcept(concept)),
				observations: [`Correct answers: ${correct}/${questions.length}`, responseText.slice(0, 1000)],
				failures: questions
					.filter((question) => !responseText.toLowerCase().includes(question.conceptName.toLowerCase()))
					.map((question) => question.question),
				constraints: ["Convert self-test failures into precise blind spots and remediation practice tasks."],
			});
		}

		return {
			conceptId,
			totalQuestions: questions.length,
			correctAnswers: correct,
			newBlindSpots: this.kg.getBlindSpots(this.config.confidenceThreshold).length,
			updatedConfidence: newConf,
		};
	}

	/** Apply a concept in a practical exercise. Gaps become new concepts (feedback loop). */
	private async applyConcept(conceptId: string): Promise<ApplyConceptResult> {
		const concept = this.kg.getConcept(conceptId);
		if (!concept) {
			return { conceptId, exerciseDescription: "", passed: false, gapsIdentified: 0, feedback: "Concept not found" };
		}
		const applyGuidance = await this.deepThink({
			mode: "apply",
			objective: `Apply ${concept.name} in a practical exercise`,
			memoryPath: {
				domain: this.domain,
				capability: "application",
				concept: concept.name,
				situation: "Practical exercise",
			},
			knowledgeSummary: this.buildKnowledgeSummary(summarizeConcept(concept)),
			constraints: ["Design a task that exposes real understanding and likely gaps."],
		});

		const promptLines = [
			"## Practical Application",
			`Apply: **${concept.name}**`,
			"",
			"1. Design a small practical exercise that tests real understanding.",
			"2. Solve it, showing your work.",
			"3. Reflect: what was easy, hard, and what gaps were revealed?",
			"",
			'Respond with JSON: {"exercise": "...", "solution": "...", "reflection": "...", "gapsIdentified": ["gap"]}',
		];
		if (applyGuidance) promptLines.splice(3, 0, formatDeepThinkingGuidance(applyGuidance), "");
		const prompt = promptLines.join("\n");

		try {
			await this.agent.prompt(prompt);
			await this.agent.waitForIdle();
		} catch {
			return { conceptId, exerciseDescription: "", passed: false, gapsIdentified: 0, feedback: "Agent error" };
		}

		const text = extractLastAssistantText([...this.agent.state.messages]);
		let exerciseDescription = "";
		let gapsIdentified = 0;
		let feedback = "";

		try {
			const m = text.match(/\{[\s\S]*\}/);
			if (m) {
				const p = JSON.parse(m[0]);
				exerciseDescription = p.exercise ?? "";
				feedback = p.reflection ?? "";
				if (Array.isArray(p.gapsIdentified)) {
					for (const gap of p.gapsIdentified) {
						if (typeof gap === "string" && gap.trim()) {
							const gc = createConcept({ name: gap.trim(), description: `Gap found applying ${concept.name}` });
							this.kg.addConcept(gc);
							this.kg.addRelation({ fromId: concept.id, toId: gc.id, type: "supports", confidence: 0.7 });
							gapsIdentified++;
						}
					}
				}
			}
		} catch {
			feedback = text.slice(0, 500);
		}
		if (gapsIdentified > 0) {
			await this.deepThink({
				mode: "reflect",
				objective: `Reflect on gaps revealed while applying ${concept.name}`,
				memoryPath: {
					domain: this.domain,
					capability: "reflection",
					concept: concept.name,
					situation: "Application gaps",
				},
				knowledgeSummary: this.buildKnowledgeSummary(summarizeConcept(concept)),
				observations: [feedback].filter(Boolean),
				failures: this.kg
					.getAllConcepts()
					.filter((candidate) => candidate.description === `Gap found applying ${concept.name}`)
					.map((candidate) => candidate.name),
				constraints: ["Turn application failures into specific remediation questions and future practice tasks."],
			});
		}

		return { conceptId, exerciseDescription, passed: text.length > 100, gapsIdentified, feedback };
	}

	/** Synthesize mastered concepts into higher-level insights. */
	private async synthesizeKnowledge(conceptIds: string[]): Promise<SynthesizeResult> {
		const concepts = conceptIds
			.map((id) => this.kg.getConcept(id))
			.filter((concept): concept is Concept => concept !== undefined);
		const evolveGuidance = await this.deepThink({
			mode: "evolve",
			objective: "Synthesize mastered concepts into a stronger domain model",
			memoryPath: {
				domain: this.domain,
				capability: "synthesis",
				situation: "Mastered concept synthesis",
			},
			knowledgeSummary: this.buildKnowledgeSummary(
				concepts.map((concept) => summarizeConcept(concept)).join("\n\n"),
			),
			constraints: [
				"Find cross-concept structure, contradictions, confidence changes, and higher-leverage next steps.",
			],
		});
		const prompt = [
			evolveGuidance ? formatDeepThinkingGuidance(evolveGuidance) : "",
			this.synthesis.buildSynthesisPrompt(conceptIds),
		]
			.filter(Boolean)
			.join("\n\n");
		if (!prompt) return { conceptCount: conceptIds.length, insightProduced: false, summary: "" };

		try {
			await this.agent.prompt(prompt);
			await this.agent.waitForIdle();
		} catch {
			return { conceptCount: conceptIds.length, insightProduced: false, summary: "Synthesis failed" };
		}

		const text = extractLastAssistantText([...this.agent.state.messages]);
		return { conceptCount: conceptIds.length, insightProduced: text.length > 200, summary: text.slice(0, 1000) };
	}

	/** Expand frontiers — detect knowledge boundaries and create new concepts. */
	private async expandFrontiers(): Promise<boolean> {
		const frontiers = this.innovation.detectFrontiers(this.config.confidenceThreshold * 0.5);
		if (frontiers.length === 0) return false;

		const innovateGuidance = await this.deepThink({
			mode: "innovate",
			objective: `Expand the knowledge frontier around ${frontiers[0].conceptName}`,
			memoryPath: {
				domain: this.domain,
				capability: "innovation",
				concept: frontiers[0].conceptName,
				situation: "Frontier expansion",
			},
			knowledgeSummary: this.buildKnowledgeSummary(),
			observations: [frontiers[0].gap],
			constraints: ["Generate falsifiable hypotheses and next research or practice tasks."],
		});
		const prompt = [
			innovateGuidance ? formatDeepThinkingGuidance(innovateGuidance) : "",
			this.innovation.buildHypothesisPrompt(frontiers[0]),
		]
			.filter(Boolean)
			.join("\n\n");
		try {
			await this.agent.prompt(prompt);
			await this.agent.waitForIdle();
		} catch {
			return false;
		}

		const text = extractLastAssistantText([...this.agent.state.messages]);
		let newConcepts = 0;

		try {
			const m = text.match(/\{[\s\S]*\}/);
			if (m) {
				const p = JSON.parse(m[0]);
				if (Array.isArray(p.hypotheses)) {
					for (const h of p.hypotheses) {
						const name = typeof h.statement === "string" ? h.statement.slice(0, 80) : "Frontier hypothesis";
						this.kg.addConcept(
							createConcept({
								name,
								description: typeof h.rationale === "string" ? h.rationale : "Frontier exploration",
								confidence: typeof h.confidence === "number" ? h.confidence : 0.2,
							}),
						);
						newConcepts++;
					}
				}
			}
		} catch {
			// Non-JSON — still record attempt
		}

		this.sessionLog.push({
			type: "innovate",
			result: { frontiersDetected: frontiers.length, newConceptsAdded: newConcepts, summary: text.slice(0, 500) },
		});
		await this.recordMemoryEvent({
			type: "innovation_event",
			title: `Expanded frontier around ${frontiers[0].conceptName}`,
			text: text.slice(0, 1000),
			conceptName: frontiers[0].conceptName,
			concepts: [frontiers[0].conceptName],
			metadata: { frontiersDetected: frontiers.length, newConceptsAdded: newConcepts },
		});

		await this.saveState();
		return newConcepts > 0;
	}

	// ─── Experience Consolidation ────────────────────────────────────────
	/**
	 * Consolidate the learn + verify + apply experience for one concept
	 * into distilled knowledge using LLM-driven semantic distillation.
	 *
	 * v2: Instead of mechanically copying sessionLog text, this calls DeepThinking
	 * in "consolidate" mode to extract WHY learning succeeded or failed,
	 * identify transferable patterns, and separate concept-specific insights
	 * from general reusable principles.
	 */
	private async consolidateConceptExperience(conceptName: string): Promise<void> {
		const memory = this.config.longTermMemory;
		if (!memory) return;

		// 1. Collect full event context
		const learnEntry = this.sessionLog.find(
			(e) => e.type === "learn" && "conceptName" in e && e.conceptName === conceptName,
		);
		const verifyEntry = this.sessionLog.find(
			(e) => e.type === "verify" && "conceptName" in e && e.conceptName === conceptName,
		);
		const applyEntry = this.sessionLog.find(
			(e) => e.type === "apply" && "conceptName" in e && e.conceptName === conceptName,
		);

		if (!learnEntry || learnEntry.type !== "learn") {
			this.pendingEventIds = [];
			return;
		}
		const lr = learnEntry.result;

		// 2. Build knowledge summary for the consolidate prompt
		const summaryParts: string[] = [
			this.buildCapabilityProfile(),
			"## Learn Result",
			`- Passed: ${lr.passed}`,
			`- Rounds: ${lr.rounds}`,
			`- Final Confidence: ${lr.finalConfidence}`,
			`- Feedback: ${lr.feedback}`,
		];
		if (verifyEntry && verifyEntry.type === "verify") {
			const vr = verifyEntry.result;
			summaryParts.push(
				"## Verify Result",
				`- Score: ${vr.correctAnswers}/${vr.totalQuestions}`,
				`- Updated Confidence: ${vr.updatedConfidence}`,
			);
		}
		if (applyEntry && applyEntry.type === "apply") {
			const ar = applyEntry.result;
			summaryParts.push(
				"## Apply Result",
				`- Passed: ${ar.passed}`,
				`- Gaps Found: ${ar.gapsIdentified}`,
				`- Feedback: ${ar.feedback}`,
			);
		}
		const knowledgeSummary = summaryParts.join("\n");

		// 3. LLM-driven semantic distillation
		const distillResult = await this.deepThink({
			mode: "consolidate",
			objective: `Distill transferable wisdom from the learning experience for: ${conceptName}`,
			memoryPath: {
				domain: this.domain,
				capability: "meta-learning",
				concept: conceptName,
				situation: "post-learning consolidation",
			},
			knowledgeSummary,
			constraints: [
				"Extract WHY the learning succeeded or failed, not just WHAT happened.",
				"Identify patterns that can transfer to learning similar concepts.",
				"Distinguish between concept-specific insights and general learning principles.",
			],
			maxOutputItems: 8,
		});

		if (!distillResult) {
			this.pendingEventIds = [];
			return;
		}

		// 4. Write distilled knowledge using semantic field mapping:
		//    conclusions -> success patterns (strategy)
		//    blindSpots -> failure root causes (pitfall)
		//    knowledgeUpdates -> transferable lessons (principle/pitfall)
		//    nextPracticeTasks -> recommended actions (procedure)
		const basePath = { domain: this.domain, capability: "learning", concept: conceptName };
		const sourceIds = [...this.pendingEventIds];

		for (const item of distillResult.conclusions) {
			if (!item.trim()) continue;
			await memory.recordDistilledKnowledge({
				path: { ...basePath, situation: "success-pattern" },
				level: "strategy",
				title: `Success: ${conceptName}`,
				text: item,
				sourceEventIds: sourceIds,
				confidence: distillResult.confidence,
				tags: [conceptName, "success", "pattern"],
			});
		}

		for (const item of distillResult.blindSpots) {
			if (!item.trim()) continue;
			await memory.recordDistilledKnowledge({
				path: { ...basePath, situation: "failure-root-cause" },
				level: "pitfall",
				title: `Pitfall: ${conceptName}`,
				text: item,
				sourceEventIds: sourceIds,
				confidence: distillResult.confidence,
				tags: [conceptName, "failure", "pitfall"],
			});
		}

		for (const item of distillResult.knowledgeUpdates) {
			if (!item.trim()) continue;
			const isPitfall = item.toLowerCase().includes("avoid") || item.toLowerCase().includes("mistake");
			await memory.recordDistilledKnowledge({
				path: { ...basePath, situation: "transferable" },
				level: isPitfall ? "pitfall" : "principle",
				title: `Insight: ${conceptName}`,
				text: item,
				sourceEventIds: sourceIds,
				confidence: distillResult.confidence,
				tags: [conceptName, "transferable"],
			});
		}

		for (const item of distillResult.nextPracticeTasks) {
			if (!item.trim()) continue;
			await memory.recordDistilledKnowledge({
				path: { ...basePath, situation: "recommendation" },
				level: "procedure",
				title: `Next: ${conceptName}`,
				text: item,
				sourceEventIds: sourceIds,
				confidence: distillResult.confidence,
				tags: [conceptName, "recommendation"],
			});
		}

		// Fallback: if no patterns extracted, record a minimal entry
		const totalItems =
			distillResult.conclusions.length +
			distillResult.blindSpots.length +
			distillResult.knowledgeUpdates.length +
			distillResult.nextPracticeTasks.length;
		if (totalItems === 0 && lr.passed) {
			await memory.recordDistilledKnowledge({
				path: { ...basePath, situation: "consolidation" },
				level: "strategy",
				title: `Learned: ${conceptName}`,
				text:
					"Confidence " +
					lr.finalConfidence +
					" after " +
					lr.rounds +
					" rounds. Feedback: " +
					lr.feedback.slice(0, 300),
				sourceEventIds: sourceIds,
				confidence: lr.finalConfidence,
				tags: [conceptName, "learning"],
			});
		}

		this.pendingEventIds = [];
	}

	/**
	 * Consolidate all remaining unconsolidated events at session end.
	 */
	private async consolidateSessionEnd(): Promise<void> {
		const memory = this.config.longTermMemory;
		if (!memory || this.pendingEventIds.length === 0) return;

		const mastered = this.kg.getAllConcepts().filter((c) => c.status === "mastered");
		if (mastered.length > 0) {
			await memory.recordDistilledKnowledge({
				path: { domain: this.domain, capability: "meta", situation: "session-summary" },
				level: "principle",
				title: "Session mastery summary",
				text: `Mastered ${mastered.length} concepts: ${mastered.map((c) => c.name).join(", ")}. Total rounds: ${this.totalRounds}. Total events: ${this.sessionLog.length}.`,
				sourceEventIds: [...this.pendingEventIds],
				confidence: 0.8,
				tags: ["session-summary", ...mastered.map((c) => c.name)],
			});
		}

		await memory.pruneStaleKnowledge(this.domain);
		this.pendingEventIds = [];
	}

	// ─── Failure Prevention ─────────────────────────────────────────────

	private async buildFailurePreventionContext(conceptName: string): Promise<string> {
		const memory = this.config.longTermMemory;
		if (!memory) return "";

		const context = await memory.buildContext({
			domain: this.domain,
			query: `failure ${conceptName} mistakes errors gaps`,
			conceptName,
			limit: 3,
		});

		const failureEvents = context.events.filter(
			(e) => e.type === "failure_event" || e.type === "verification_event" || e.type === "reflection_event",
		);

		const failureKnowledge = context.distilledKnowledge.filter((k) =>
			k.tags?.some((t) => t === "failure" || t === "gaps" || t === conceptName),
		);

		if (failureEvents.length === 0 && failureKnowledge.length === 0) return "";

		const lines = ["## ⚠️ Historical Pitfalls — Learn From Past Mistakes"];
		for (const event of failureEvents.slice(0, 3)) {
			lines.push(`- [${event.type}] ${event.title}: ${event.text.slice(0, 200)}`);
		}
		for (const dk of failureKnowledge.slice(0, 3)) {
			lines.push(`- [${dk.level}] ${dk.title}: ${dk.text.slice(0, 200)}`);
		}
		lines.push("", "Before you proceed, actively guard against the pitfalls listed above.");
		return lines.join("\n");
	}

	// ─── Capability Profile ─────────────────────────────────────────────

	private buildCapabilityProfile(): string {
		const allConcepts = this.kg.getAllConcepts();
		if (allConcepts.length === 0) return "";

		const totalConf = allConcepts.reduce((sum, c) => sum + c.confidence, 0);
		const avgConf = totalConf / allConcepts.length;
		const mastered = allConcepts.filter((c) => c.status === "mastered").length;

		let level = "novice";
		if (avgConf >= 0.8) level = "expert";
		else if (avgConf >= 0.6) level = "intermediate";
		else if (avgConf >= 0.3) level = "beginner";

		const sorted = [...allConcepts].sort((a, b) => b.confidence - a.confidence);
		const strengths = sorted.slice(0, 3).filter((c) => c.confidence >= 0.6);
		const weaknesses = [...allConcepts]
			.filter((c) => c.confidence < 0.5)
			.sort((a, b) => a.confidence - b.confidence)
			.slice(0, 3);

		const lines = [
			`## Capability Profile: ${this.domain}`,
			`Level: **${level}** (avg confidence: ${avgConf.toFixed(2)}, mastered: ${mastered}/${allConcepts.length})`,
		];
		if (strengths.length > 0) {
			lines.push("", "### Strengths", ...strengths.map((c) => `- ${c.name} (${c.confidence.toFixed(2)})`));
		}
		if (weaknesses.length > 0) {
			lines.push(
				"",
				"### Weaknesses (priority learning targets)",
				...weaknesses.map((c) => `- ${c.name} (${c.confidence.toFixed(2)})`),
			);
		}
		return lines.join("\n");
	}

	// ─── Strategy Bandit ─────────────────────────────────────────────────

	private selectPerspective(round: number): Perspective {
		const perspectives = this.config.perspectives;
		if (perspectives.length === 0) return { name: "Default", instruction: "Learn the concept" };

		const stats: { name: string; avgGain: number; rounds: number }[] = [];
		for (const p of perspectives) {
			const s = this.perspectiveStats.get(p.name);
			stats.push({
				name: p.name,
				avgGain: s && s.rounds > 0 ? s.totalConfidenceGain / s.rounds : 0,
				rounds: s?.rounds ?? 0,
			});
		}

		const hasHistory = stats.some((s) => s.rounds > 0);
		if (!hasHistory) return perspectives[(round - 1) % perspectives.length];

		// Epsilon-greedy: 20% exploration, 80% exploitation
		if (Math.random() < 0.2) {
			return perspectives[Math.floor(Math.random() * perspectives.length)];
		}

		const eligible = stats.filter((s) => s.rounds >= 1);
		if (eligible.length === 0) return perspectives[(round - 1) % perspectives.length];

		const best = eligible.reduce((a, b) => (a.avgGain >= b.avgGain ? a : b));
		return perspectives.find((p) => p.name === best.name) ?? perspectives[0];
	}

	private recordPerspectiveContribution(perspectiveName: string, confidenceGain: number): void {
		const existing = this.perspectiveStats.get(perspectiveName);
		if (existing) {
			existing.rounds += 1;
			existing.totalConfidenceGain += Math.max(0, confidenceGain);
		} else {
			this.perspectiveStats.set(perspectiveName, { rounds: 1, totalConfidenceGain: Math.max(0, confidenceGain) });
		}
	}

	// ─── Dreaming Session ─────────────────────────────────────────────

	/**
	 * Run a dreaming session: an independent LLM pass that consolidates
	 * fragmented distilled knowledge by merging duplicates, upgrading core
	 * principles, flagging contradictions, and deprecating outdated entries.
	 *
	 * Reference: Anthropic Dreaming Session pattern —
	 * "consolidates fragmented content into a separate new output store."
	 */
	async runDreamingSession(): Promise<{ merged: number; upgraded: number; deprecated: number; gaps: string[] }> {
		const memory = this.config.longTermMemory;
		if (!memory) return { merged: 0, upgraded: 0, deprecated: 0, gaps: [] };

		const allKnowledge = await memory.retrieveDistilledKnowledge({
			path: { domain: this.domain },
			limit: 100,
		});
		if (allKnowledge.length < 5) return { merged: 0, upgraded: 0, deprecated: 0, gaps: [] };

		const knowledgeList = allKnowledge
			.map(
				(dk, i) =>
					`[${i}] ${dk.level} | ${dk.path.concept ?? "general"} | utility=${dk.utilityScore} | conf=${dk.confidence.toFixed(2)} | consolidations=${dk.consolidationCount}\n${dk.title}: ${dk.text.slice(0, 300)}`,
			)
			.join("\n\n");

		const dreamingResult = await this.deepThink({
			mode: "evolve",
			objective: "Consolidate and curate the distilled knowledge base",
			knowledgeSummary: [`## Knowledge Base (${allKnowledge.length} entries)`, knowledgeList].join("\n"),
			constraints: [
				"MERGE semantically equivalent entries. Output merged indices.",
				"UPGRADE entries with utility >= 3. Mark them as CORE.",
				"DEPRECATE entries proven wrong or outdated.",
				"GAP: Identify missing knowledge areas to explore.",
			],
		});

		let merged = 0,
			upgraded = 0,
			deprecated = 0;
		const gaps: string[] = [];

		if (dreamingResult) {
			for (const item of dreamingResult.conclusions) {
				if (item.toLowerCase().includes("merge")) merged++;
				if (item.toLowerCase().includes("core") || item.toLowerCase().includes("upgrade")) upgraded++;
				if (item.toLowerCase().includes("deprecat")) deprecated++;
			}
			gaps.push(...dreamingResult.nextResearchQuestions);
		}

		return { merged, upgraded, deprecated, gaps };
	}

	getKnowledgeGraph(): KnowledgeGraph {
		return this.kg;
	}

	getSessionLog(): SessionEntry[] {
		return [...this.sessionLog];
	}

	getBlindSpots(): BlindSpot[] {
		return this.kg.getBlindSpots(this.config.confidenceThreshold);
	}
}

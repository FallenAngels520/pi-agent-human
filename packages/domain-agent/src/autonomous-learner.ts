import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getEnvApiKey, getModel, streamSimple } from "@earendil-works/pi-ai";
import type { ContinuousLearningResult, DeepThinkingEngineLike, SessionEntry } from "./continuous-learning-agent.ts";
import { ContinuousLearningAgent } from "./continuous-learning-agent.ts";
import type { DeepThinkingInput, DeepThinkingResult } from "./deep-thinking.ts";
import { DeepThinkingEngine } from "./deep-thinking.ts";
import { KnowledgeGraph } from "./knowledge-graph.ts";
import { JsonLongTermMemory } from "./long-term-memory.ts";
import { createKnowledgeGraphTools } from "./tools/kg-tools.ts";
import { createSearchTools } from "./tools/search-tools.ts";
import { createSelfTestTools } from "./tools/test-tools.ts";
import type { BlindSpot, DreamingConfig, Perspective } from "./types.ts";

// ── Config ───────────────────────────────────────────────────────────────────

export interface AutonomousLearnerConfig {
	/** Model provider, e.g. "anthropic" */
	provider: string;
	/** Model ID, e.g. "anthropic.claude-haiku-4-5-20251001-v1:0" */
	modelId: string;
	/** API key for the provider. Falls back to env var if empty. */
	apiKey?: string;
	/** Domain this agent is learning, e.g. "Rust" */
	domain: string;
	/** Multi-perspective definitions for learning rounds */
	perspectives: Perspective[];
	/** Max learning rounds per concept (default 5) */
	maxRounds?: number;
	/** Confidence threshold for mastery (default 0.8) */
	confidenceThreshold?: number;
	/** Plateau rounds before giving up (default 3) */
	plateauThreshold?: number;
	/** Max concepts to learn per session (default 10) */
	maxConceptsPerSession?: number;
	/** Enable practical application phase (default true) */
	practicalApplicationEnabled?: boolean;
	/** Enable frontier expansion (default true) */
	frontierExpansionEnabled?: boolean;
	/** Enable post-session dreaming (default true) */
	dreamingEnabled?: boolean;
	/** Dreaming configuration overrides */
	dreamingConfig?: Partial<DreamingConfig>;
	/** Progress callback. Default: console.log. Set to undefined to silence. */
	kg?: KnowledgeGraph;
	onProgress?: (msg: string) => void;
	/** File to persist the knowledge graph */
	knowledgeGraphFile?: string;
	/** File to persist long-term memory */
	memoryFile?: string;
	/** Checkpoint file for session recovery */
	checkpointFile?: string;
	/** Model to use for the JudgeAgent verifier (defaults to main model) */
	verifierModelId?: string;
	/** Deep thinking engine config for L2 meta-cognition */
	deepThinkingModelId?: string;
	/** System prompt override */
	systemPrompt?: string;
}

// ── Default Perspectives ─────────────────────────────────────────────────────

const DEFAULT_PERSPECTIVES: Perspective[] = [
	{
		name: "Fundamentals",
		instruction:
			"Research the core concepts, definitions, and foundational principles. Find authoritative sources (official docs, RFCs, textbooks). Identify WHAT the concept is and WHY it exists.",
	},
	{
		name: "Practice",
		instruction:
			"Find real-world usage examples, code snippets, and common patterns. Look for blog posts, GitHub repos, and tutorials. Focus on HOW to apply the concept correctly.",
	},
	{
		name: "Critique",
		instruction:
			"Identify limitations, edge cases, common mistakes, and anti-patterns. When does this concept break? What are the trade-offs? What do experienced practitioners warn about?",
	},
];

// ── Agent System Prompt ──────────────────────────────────────────────────────

function buildLearnerSystemPrompt(domain: string): string {
	return `You are an autonomous domain-learning agent specializing in **${domain}**.

## Your Mission
Learn everything about ${domain} from first principles to advanced topics. Be thorough and evidence-driven.

## Available Tools
- **web_search**: Search the web for information about any topic
- **web_fetch**: Fetch and read the full text of any web page
- **add_concept**: Add a new concept to your knowledge graph
- **add_relation**: Link two concepts (prerequisite_of, supports, contradicts, etc.)
- **query_concepts**: Query your knowledge graph for existing concepts
- **get_blind_spots**: Find concepts with low confidence that need review
- **add_evidence**: Record sources and evidence for concepts
- **generate_self_test**: Generate self-test questions for a concept
- **generate_cross_test**: Generate cross-concept test questions
- **record_self_test_results**: Record your self-test performance

## Learning Process
1. Search the web for authoritative information about the assigned concept
2. Fetch and read the most relevant pages (official docs, tutorials, papers)
3. Extract key findings and add them as concepts with evidence
4. Link new concepts to existing ones in your knowledge graph
5. Identify contradictions, uncertainties, and edge cases
6. After learning, respond with structured JSON:
   {"findings": "what you learned", "contradictions": "any conflicts found", "uncertainties": "what you are unsure about", "confidence": 0.0-1.0}

## Rules
- Always cite sources when adding evidence
- Prefer official documentation and primary sources
- Be honest about your confidence — uncertainty is valuable data
- If you find contradictions between sources, report them
- Search in English for the best quality results`;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

/**
 * AutonomousLearner wires a Pi Agent with domain learning tools into a
 * self-driven learning system.
 *
 * Usage:
 * ```typescript
 * const learner = new AutonomousLearner({
 *   provider: "anthropic",
 *   modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   domain: "Rust",
 *   perspectives: DEFAULT_PERSPECTIVES,
 * });
 *
 * const result = await learner.learn("Rust Ownership", [
 *   "Ownership",
 *   { name: "Borrowing", prerequisites: ["Ownership"] },
 *   { name: "Lifetimes", prerequisites: ["Borrowing"] },
 * ]);
 * console.log(result.conceptsLearned, result.totalRounds);
 * ```
 */
export class AutonomousLearner {
	private config: AutonomousLearnerConfig;
	private agent!: Agent;
	private learner!: ContinuousLearningAgent;

	constructor(config: AutonomousLearnerConfig) {
		this.config = {
			maxRounds: 5,
			confidenceThreshold: 0.8,
			plateauThreshold: 3,
			maxConceptsPerSession: 10,
			practicalApplicationEnabled: true,
			frontierExpansionEnabled: true,
			dreamingEnabled: true,
			...config,
		};
		// Default after spread so config can override
		if (!this.config.perspectives || this.config.perspectives.length === 0) {
			this.config.perspectives = DEFAULT_PERSPECTIVES;
		}
	}

	async init(): Promise<void> {
		const cfg = this.config;

		// 1. Load the model
		const model = getModel(cfg.provider as any, cfg.modelId as any);
		if (!model) {
			throw new Error(`Model not found: ${cfg.provider}/${cfg.modelId}`);
		}

		// 2. Build tools
		const kg = cfg.kg ?? new KnowledgeGraph();
		const tools = [...createKnowledgeGraphTools(kg), ...createSearchTools(), ...createSelfTestTools(kg)];

		// 3. Resolve API key
		const apiKey = cfg.apiKey ?? getEnvApiKey(cfg.provider);
		if (!apiKey) {
			throw new Error(
				`No API key for ${cfg.provider}. Set ${cfg.provider.toUpperCase()}_API_KEY env var or pass apiKey in config.`,
			);
		}

		// 4. Create the Agent
		this.agent = new Agent({
			streamFn: streamSimple,
			getApiKey: () => apiKey,
			initialState: {
				model,
				systemPrompt: cfg.systemPrompt ?? buildLearnerSystemPrompt(cfg.domain),
				tools,
			},
		});

		// 5. Set up long-term memory
		const memory = new JsonLongTermMemory({ filePath: cfg.memoryFile });
		if (cfg.memoryFile) {
			await memory.loadFromFile(cfg.memoryFile).catch(() => {});
		}

		// 6. Set up DeepThinking engine (L2)
		let deepThinking: DeepThinkingEngineLike | undefined;
		if (cfg.deepThinkingModelId) {
			const dtModel = getModel(cfg.provider as any, cfg.deepThinkingModelId as any);
			if (dtModel) {
				const dtEngine = new DeepThinkingEngine({ model: dtModel as Model<string> });
				deepThinking = {
					think: (input: DeepThinkingInput): Promise<DeepThinkingResult> => dtEngine.think(input),
				};
			}
		}

		// 7. Create the ContinuousLearningAgent
		const verifierModelId = cfg.verifierModelId ?? cfg.modelId;
		const verifierModel = getModel(cfg.provider as any, verifierModelId as any) ?? model;

		this.learner = new ContinuousLearningAgent({
			agent: this.agent,
			perspectives: cfg.perspectives,
			verifierModel: verifierModel as Model<string>,
			maxRounds: cfg.maxRounds!,
			confidenceThreshold: cfg.confidenceThreshold!,
			plateauThreshold: cfg.plateauThreshold!,
			maxConceptsPerSession: cfg.maxConceptsPerSession!,
			practicalApplicationEnabled: cfg.practicalApplicationEnabled!,
			frontierExpansionEnabled: cfg.frontierExpansionEnabled!,
			domain: cfg.domain,
			deepThinking,
			longTermMemory: memory,
			knowledgeGraphFile: cfg.knowledgeGraphFile,
			checkpointFile: cfg.checkpointFile,
			dreamingEnabled: cfg.dreamingEnabled,
			dreamingConfig: cfg.dreamingConfig,
			onProgress: cfg.onProgress,
		});
	}

	/**
	 * Seed concepts and start autonomous learning.
	 *
	 * @param topic - The overall topic name
	 * @param concepts - Concept names (strings) or { name, prerequisites } objects
	 */
	async learn(
		topic: string,
		concepts: Array<string | { name: string; prerequisites: string[] }>,
	): Promise<ContinuousLearningResult> {
		if (!this.learner) await this.init();

		this.learner.seedConcepts(topic, concepts);
		return this.learner.run();
	}

	/**
	 * Continue learning from a loaded knowledge graph state.
	 * Resumes where you left off — no need to re-seed.
	 */
	async continue(): Promise<ContinuousLearningResult> {
		if (!this.learner) await this.init();
		return this.learner.run();
	}

	/** Get the underlying knowledge graph for inspection */
	getAgent(): Agent {
		return this.agent;
	}

	getKnowledgeGraph(): KnowledgeGraph {
		return this.learner.getKnowledgeGraph();
	}

	/** Get the session log */
	getSessionLog(): SessionEntry[] {
		return this.learner.getSessionLog();
	}

	/** Get current blind spots */
	getBlindSpots(): BlindSpot[] {
		return this.learner.getBlindSpots();
	}

	/**
	 * Query the knowledge graph for an answer to a question.
	 *
	 * If the KG has high-confidence knowledge about the topic, returns it
	 * immediately. Otherwise triggers a learning session before answering.
	 */
	async query(question: string): Promise<{
		answer: string;
		confidence: number;
		sourceConcepts: string[];
		learned: boolean;
	}> {
		if (!this.learner) await this.init();

		const kg = this.learner.getKnowledgeGraph();
		const concepts = kg.getAllConcepts();

		const questionLower = question.toLowerCase();
		const questionWords = new Set(questionLower.split(/\s+/));

		const relevant = concepts
			.map((c) => {
				const nameLower = c.name.toLowerCase();
				const descLower = c.description.toLowerCase();
				const nameWords = new Set(nameLower.split(/\s+/));
				const descWords = new Set(descLower.split(/\s+/));
				let overlap = 0;
				for (const w of questionWords) {
					if (w.length < 3) continue;
					if (nameWords.has(w) || descWords.has(w)) overlap++;
					else if (nameLower.includes(w) || descLower.includes(w)) overlap += 0.5;
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
				answer: `${c.name}: ${c.description}\n\nEvidence:\n${evidence}`,
				confidence: c.confidence,
				sourceConcepts: [c.name],
				learned: false,
			};
		}

		const topic = question.slice(0, 80).replace(/[?？]/g, "").trim();
		const seedName = topic.replace(/^(what|how|why|explain|describe|tell me about)\s+/i, "").slice(0, 60);

		await this.learn(topic, [seedName]);
		await this.saveState();

		const updatedConcepts = kg.getAllConcepts();
		const learned = updatedConcepts.find((c) => c.name.toLowerCase().includes(seedName.toLowerCase().slice(0, 20)));

		if (learned) {
			const evidence = learned.evidence.map((e) => `${e.type}: ${e.source}`).join("\n");
			return {
				answer: `[Just learned] ${learned.name}: ${learned.description}\n\nEvidence:\n${evidence}`,
				confidence: learned.confidence,
				sourceConcepts: [learned.name],
				learned: true,
			};
		}

		return {
			answer: `Unable to find or learn about: ${question}. KG has ${updatedConcepts.length} concepts.`,
			confidence: 0,
			sourceConcepts: [],
			learned: true,
		};
	}
	/** Save knowledge graph and memory to disk */
	async saveState(): Promise<void> {
		await this.learner.saveState();
	}
}

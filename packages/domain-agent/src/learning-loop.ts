import type { Curriculum } from "./curriculum.ts";
import type { KnowledgeGraph } from "./knowledge-graph.ts";
import { RecurrentBlock, shouldStop } from "./recurrent-block.ts";
import type { SelfTest } from "./self-test.ts";
import type { LearningPathStep, Perspective, RoundPrompt, RoundResult, SelfTestResult } from "./types.ts";
import { createConcept, createRelation } from "./types.ts";

export interface LearningLoopConfig {
	knowledgeGraph: KnowledgeGraph;
	curriculum: Curriculum;
	selfTest: SelfTest;
	perspectives: Perspective[];
	maxRounds: number;
	confidenceThreshold: number;
	plateauThreshold: number;
	problem?: string;
}

export interface SeedConcept {
	name: string;
	prerequisites: string[];
}

export class LearningLoop {
	private kg: KnowledgeGraph;
	private curriculum: Curriculum;
	private selfTest: SelfTest;
	private recurrentBlock: RecurrentBlock;
	private config: LearningLoopConfig;
	private roundResults: RoundResult[] = [];
	private selfTestResults: SelfTestResult[] = [];
	private currentConceptIndex = 0;
	private learningPath: LearningPathStep[] = [];
	private pathComputed = false;
	private learningGoal = "";

	constructor(config: LearningLoopConfig) {
		this.config = config;
		this.kg = config.knowledgeGraph;
		this.curriculum = config.curriculum;
		this.selfTest = config.selfTest;
		this.recurrentBlock = new RecurrentBlock({
			problem: this.config.problem ?? "",
			perspectives: this.config.perspectives,
			maxRounds: this.config.maxRounds,
			confidenceThreshold: this.config.confidenceThreshold,
			plateauThreshold: this.config.plateauThreshold,
		});
	}

	seedConcepts(topic: string, concepts: (string | SeedConcept)[]): void {
		this.learningGoal = topic;
		const nameToId = new Map<string, string>();

		for (const item of concepts) {
			const seed: SeedConcept = typeof item === "string" ? { name: item, prerequisites: [] } : item;
			const concept = createConcept({ name: seed.name, description: `Part of: ${topic}` });
			this.kg.addConcept(concept);
			nameToId.set(seed.name, concept.id);
		}

		for (const item of concepts) {
			const seed: SeedConcept = typeof item === "string" ? { name: item, prerequisites: [] } : item;
			const conceptId = nameToId.get(seed.name);
			if (!conceptId) continue;

			for (const prereqName of seed.prerequisites) {
				const prereqId = nameToId.get(prereqName);
				if (prereqId && conceptId) {
					this.kg.addRelation(createRelation({ fromId: prereqId, toId: conceptId, type: "prerequisite_of" }));
				}
			}
		}
	}

	getLearningPath(): LearningPathStep[] {
		if (!this.pathComputed) {
			this.learningPath = this.curriculum.planPath(this.learningGoal);
			this.pathComputed = true;
		}
		return this.learningPath;
	}

	/**
	 * Get the prompt for the next learning round.
	 *
	 * Uses the persistent RecurrentBlock to build a prompt from its internal
	 * round history. Returns null when all concepts have been processed.
	 */
	getNextRoundPrompt(): RoundPrompt | null {
		this.getLearningPath();

		if (this.currentConceptIndex >= this.learningPath.length) {
			return null;
		}

		// Set the RecurrentBlock's problem to the current concept name
		const currentConcept = this.learningPath[this.currentConceptIndex];
		this.recurrentBlock.setProblem(currentConcept.conceptName);

		const blindSpots = this.kg.getBlindSpots(this.config.confidenceThreshold);
		return this.recurrentBlock.buildRoundPrompt(blindSpots);
	}

	formatPromptText(prompt: RoundPrompt): string {
		return this.recurrentBlock.formatPromptText(prompt);
	}

	/**
	 * Record a round result in both the local log and the RecurrentBlock.
	 */
	recordRoundResult(result: RoundResult): void {
		this.roundResults.push(result);
		this.recurrentBlock.recordResult(result);

		const allConcepts = this.kg.getAllConcepts();
		if (this.learningPath[this.currentConceptIndex]) {
			const currentName = this.learningPath[this.currentConceptIndex].conceptName;
			const concept = allConcepts.find((c) => c.name === currentName);
			if (concept) {
				this.kg.updateConfidence(concept.id, result.confidence);
			}
		}
	}

	/**
	 * Record self-test results for the current concept.
	 */
	recordSelfTestResults(results: SelfTestResult[]): void {
		this.selfTestResults.push(...results);
		this.selfTest.updateConfidenceFromResults(results);
	}

	isCurrentConceptComplete(): boolean {
		return shouldStop(this.roundResults, this.config.confidenceThreshold, this.config.plateauThreshold);
	}

	/**
	 * Advance to the next concept in the learning path.
	 * Resets the RecurrentBlock and local round history for the new concept.
	 */
	advanceToNextConcept(): boolean {
		this.roundResults = [];
		this.currentConceptIndex++;
		this.recurrentBlock.reset();

		// Update the RecurrentBlock's problem for the new concept
		if (this.currentConceptIndex < this.learningPath.length) {
			const nextConcept = this.learningPath[this.currentConceptIndex];
			this.recurrentBlock = new RecurrentBlock({
				problem: nextConcept.conceptName,
				perspectives: this.config.perspectives,
				maxRounds: this.config.maxRounds,
				confidenceThreshold: this.config.confidenceThreshold,
				plateauThreshold: this.config.plateauThreshold,
			});
		}

		return this.currentConceptIndex < this.learningPath.length;
	}

	reset(): void {
		this.roundResults = [];
		this.selfTestResults = [];
		this.currentConceptIndex = 0;
		this.learningPath = [];
		this.pathComputed = false;
		this.learningGoal = "";
		this.recurrentBlock.reset();
	}

	getRoundHistory(): RoundResult[] {
		return [...this.roundResults];
	}

	getSelfTestResults(): SelfTestResult[] {
		return [...this.selfTestResults];
	}

	getStatus(): {
		currentConceptIndex: number;
		totalConcepts: number;
		roundCount: number;
		isComplete: boolean;
	} {
		return {
			currentConceptIndex: this.currentConceptIndex,
			totalConcepts: this.learningPath.length,
			roundCount: this.roundResults.length,
			isComplete: this.currentConceptIndex >= this.learningPath.length,
		};
	}
}

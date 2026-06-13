export type ConceptStatus = "not_started" | "in_progress" | "mastered" | "skipped";

export type EvidenceType = "documentation" | "paper" | "code" | "experiment" | "web_search";

export type RelationType = "prerequisite_of" | "supports" | "contradicts" | "generalizes" | "example_of";

export interface Evidence {
	source: string;
	type: EvidenceType;
	excerpt?: string;
}

export interface Relation {
	fromId: string;
	toId: string;
	type: RelationType;
	confidence: number;
}

export interface Concept {
	id: string;
	name: string;
	description: string;
	confidence: number;
	evidence: Evidence[];
	relations: Relation[];
	status: ConceptStatus;
	createdAt: number;
	lastReviewedAt: number;
}

export interface CreateConceptInput {
	name: string;
	description: string;
	confidence?: number;
	evidence?: Evidence[];
	relations?: Relation[];
	status?: ConceptStatus;
}

let conceptCounter = 0;

export function createConcept(input: CreateConceptInput): Concept {
	conceptCounter++;
	const now = Date.now();
	return {
		id: `concept-${conceptCounter}`,
		name: input.name,
		description: input.description,
		confidence: input.confidence ?? 0,
		evidence: input.evidence ?? [],
		relations: input.relations ?? [],
		status: input.status ?? "not_started",
		createdAt: now,
		lastReviewedAt: now,
	};
}

export interface CreateRelationInput {
	fromId: string;
	toId: string;
	type: RelationType;
	confidence?: number;
}

export function createRelation(input: CreateRelationInput): Relation {
	return {
		fromId: input.fromId,
		toId: input.toId,
		type: input.type,
		confidence: input.confidence ?? 1,
	};
}

export interface Perspective {
	name: string;
	instruction: string;
}

export interface RoundResult {
	round: number;
	perspective: string;
	findings: string;
	contradictions: string;
	uncertainties: string;
	confidence: number;
}

export interface RecurrentBlockConfig {
	problem: string;
	perspectives: Perspective[];
	maxRounds: number;
	confidenceThreshold: number;
	plateauThreshold: number;
}

export interface RoundPrompt {
	problem: string;
	round: number;
	maxRounds: number;
	perspective: Perspective;
	previousFindings: string;
	previousBlindSpots: string;
}

export interface SelfTestQuestion {
	conceptId: string;
	conceptName: string;
	question: string;
	type: "recall" | "application" | "boundary";
}

export interface SelfTestResult {
	conceptId: string;
	question: SelfTestQuestion;
	userAnswer: string;
	expectedAnswer: string;
	correct: boolean;
	explanation: string;
}

export interface BlindSpot {
	conceptId: string;
	conceptName: string;
	gap: string;
	severity: "low" | "medium" | "high";
}

export interface LearningGoal {
	topic: string;
	depth: "basic" | "intermediate" | "advanced";
	constraints?: string;
}

export interface LearningPathStep {
	conceptName: string;
	prerequisites: string[];
	order: number;
}

// ─── Dreaming & Playbook Types ───────────────────────────────────────────────

/**
 * A distilled principle extracted from learning history.
 * Principles are durable, transferable insights that span multiple concepts.
 */
export interface Principle {
	/** Unique identifier for this principle. */
	id: string;
	/** Short, memorable name. E.g. "Boundary-First Learning". */
	title: string;
	/** The principle statement — what was learned and why it matters. */
	statement: string;
	/** Concept IDs that contributed evidence for this principle. */
	sourceConceptIds: string[];
	/** Source event/round IDs for full traceability. */
	sourceEventIds: string[];
	/** Confidence in this principle (0-1). */
	confidence: number;
	/** How many times this principle has been successfully applied. */
	utilityScore: number;
	/** When this principle was created or last updated. */
	lastUpdatedAt: number;
}

/**
 * A recommended learning strategy derived from pattern analysis.
 * Strategies are actionable — "when facing X, do Y".
 */
export interface Strategy {
	/** Unique identifier. */
	id: string;
	/** Situational trigger. E.g. "When learning memory-management concepts". */
	trigger: string;
	/** The recommended action. E.g. "Start with the critic perspective first". */
	action: string;
	/** Why this strategy works, backed by evidence. */
	rationale: string;
	/** Concept ID that this strategy was most effective for. */
	exemplarConceptId: string;
	/** Average confidence gain when this strategy was used. */
	averageGain: number;
	/** Number of times this strategy was observed to work. */
	occurrenceCount: number;
}

/**
 * A common pitfall extracted from self-test failures and blind spots.
 */
export interface Pitfall {
	/** Unique identifier. */
	id: string;
	/** What the learner commonly gets wrong. */
	description: string;
	/** The correct understanding. */
	correction: string;
	/** Which concept(s) this pitfall relates to. */
	relatedConceptIds: string[];
	/** Severity: how often or badly this pitfall occurs. */
	severity: "low" | "medium" | "high";
	/** Number of times this pitfall was observed. */
	occurrenceCount: number;
}

/**
 * A structured playbook produced by the DreamingEngine.
 *
 * Playbooks are the primary output of a dreaming session — they condense
 * raw learning history into actionable, durable knowledge that future
 * learning sessions can reference.
 */
export interface Playbook {
	/** Unique identifier for this playbook version. */
	id: string;
	/** The domain/topic this playbook covers. */
	domain: string;
	/** When this playbook was generated. */
	createdAt: number;
	/** Version number, incremented on each dreaming pass. */
	version: number;
	/** Distilled principles (transferable insights). */
	principles: Principle[];
	/** Recommended learning strategies (situation → action). */
	strategies: Strategy[];
	/** Common pitfalls to avoid. */
	pitfalls: Pitfall[];
	/** Summary of what changed since the last dreaming pass. */
	changeLog: string;
	/** Statistics about the knowledge graph at dream time. */
	stats: PlaybookStats;
}

/**
 * Statistics about the knowledge graph state when dreaming ran.
 */
export interface PlaybookStats {
	totalConcepts: number;
	masteredConcepts: number;
	averageConfidence: number;
	totalRounds: number;
	totalSelfTests: number;
	blindSpotsResolved: number;
	perspectiveEffectiveness: Record<string, { rounds: number; averageGain: number }>;
}

/**
 * Configuration for the DreamingEngine.
 */
export interface DreamingConfig {
	/** Minimum confidence for a concept to contribute to principle extraction. */
	minConfidenceForExtraction: number;
	/** Concepts with confidence below this are candidates for pruning. */
	pruneConfidenceThreshold: number;
	/** Concepts with name similarity above this are candidates for merging. */
	mergeSimilarityThreshold: number;
	/** Maximum number of principles to extract per dreaming pass. */
	maxPrinciples: number;
	/** Maximum number of strategies to extract per dreaming pass. */
	maxStrategies: number;
	/** Whether to run concept merging (deduplication). */
	enableMerge: boolean;
	/** Whether to run knowledge pruning (freshness). */
	enablePrune: boolean;
	/** Whether to run pattern extraction (distillation). */
	enableDistillation: boolean;
}

/**
 * The result of a dreaming pass.
 */
export interface DreamingResult {
	/** The generated playbook. */
	playbook: Playbook;
	/** Number of concepts merged during consolidation. */
	conceptsMerged: number;
	/** Number of concepts pruned (low confidence, stale). */
	conceptsPruned: number;
	/** Number of principles distilled. */
	principlesExtracted: number;
	/** Number of strategies identified. */
	strategiesIdentified: number;
	/** Number of pitfalls cataloged. */
	pitfallsCataloged: number;
	/** Duration of the dreaming pass in milliseconds. */
	durationMs: number;
}

/**
 * Default dreaming configuration.
 */
export const DEFAULT_DREAMING_CONFIG: DreamingConfig = {
	minConfidenceForExtraction: 0.6,
	pruneConfidenceThreshold: 0.15,
	mergeSimilarityThreshold: 0.7,
	maxPrinciples: 7,
	maxStrategies: 5,
	enableMerge: true,
	enablePrune: true,
	enableDistillation: true,
};

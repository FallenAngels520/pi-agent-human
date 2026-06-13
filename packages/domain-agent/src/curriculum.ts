import type { KnowledgeGraph } from "./knowledge-graph.ts";
import type { LearningPathStep } from "./types.ts";

/**
 * Plan a learning path through the knowledge graph.
 *
 * Uses Kahn's topological sort on prerequisite chains.
 *
 * When `goal` is non-empty, filters the concept set to those relevant to the goal:
 * 1. Seed set: concepts whose name or description contains the goal keywords
 * 2. Backward expansion: collect all prerequisite dependencies of seed concepts
 * 3. Forward expansion: collect concepts directly related to seeds via supports/generalizes
 * 4. Topological sort the filtered subset
 *
 * When `goal` is empty, returns all concepts in topological order.
 */
export class Curriculum {
	private kg: KnowledgeGraph;

	constructor(kg: KnowledgeGraph) {
		this.kg = kg;
	}

	planPath(goal: string): LearningPathStep[] {
		const allConcepts = this.kg.getAllConcepts();
		if (allConcepts.length === 0) return [];

		const relevantIds = goal ? this.selectRelevantConcepts(allConcepts, goal) : new Set(allConcepts.map((c) => c.id));

		return this.topologicalSort(allConcepts, relevantIds);
	}

	/**
	 * Select concepts relevant to the learning goal.
	 *
	 * Strategy:
	 * 1. Name/description keyword match → seed set
	 * 2. Prerequisite backward expansion (collect all deps of seeds)
	 * 3. Supports/generalizes forward expansion (one step from seeds)
	 */
	private selectRelevantConcepts(concepts: ReturnType<KnowledgeGraph["getAllConcepts"]>, goal: string): Set<string> {
		const keywords = goal.toLowerCase().split(/\s+/).filter(Boolean);
		const seedIds = new Set<string>();

		// Step 1: Name/description keyword match
		for (const concept of concepts) {
			const searchText = `${concept.name} ${concept.description}`.toLowerCase();
			if (keywords.some((kw) => searchText.includes(kw))) {
				seedIds.add(concept.id);
			}
		}

		if (seedIds.size === 0) {
			// No matches — fall back to all concepts
			return new Set(concepts.map((c) => c.id));
		}

		const relevant = new Set(seedIds);

		// Step 2: Backward expansion — collect all prerequisites of seeds
		for (const concept of concepts) {
			for (const rel of concept.relations) {
				if (rel.type === "prerequisite_of" && seedIds.has(rel.toId)) {
					relevant.add(rel.fromId);
				}
			}
		}

		// Step 3: Forward expansion — concepts directly supported/generalized by seeds
		for (const concept of concepts) {
			for (const rel of concept.relations) {
				if ((rel.type === "supports" || rel.type === "generalizes") && seedIds.has(rel.fromId)) {
					relevant.add(rel.toId);
				}
			}
		}

		return relevant;
	}

	/**
	 * Kahn's topological sort over the subset of concepts identified by relevantIds.
	 */
	private topologicalSort(
		allConcepts: ReturnType<KnowledgeGraph["getAllConcepts"]>,
		relevantIds: Set<string>,
	): LearningPathStep[] {
		const conceptMap = new Map(allConcepts.map((c) => [c.id, c]));
		const relevantConcepts = allConcepts.filter((c) => relevantIds.has(c.id));

		const inDegree = new Map<string, number>();
		const adjacency = new Map<string, string[]>();

		for (const concept of relevantConcepts) {
			inDegree.set(concept.id, 0);
			adjacency.set(concept.id, []);
		}

		for (const concept of relevantConcepts) {
			for (const rel of concept.relations) {
				if (rel.type === "prerequisite_of" && relevantIds.has(rel.fromId) && relevantIds.has(rel.toId)) {
					const deps = adjacency.get(rel.fromId) ?? [];
					deps.push(rel.toId);
					adjacency.set(rel.fromId, deps);
					inDegree.set(rel.toId, (inDegree.get(rel.toId) ?? 0) + 1);
				}
			}
		}

		const queue: string[] = [];
		for (const [id, degree] of inDegree) {
			if (degree === 0) queue.push(id);
		}

		const steps: LearningPathStep[] = [];
		let order = 0;

		while (queue.length > 0) {
			const currentId = queue.shift()!;
			const concept = conceptMap.get(currentId);
			if (!concept) continue;

			if (concept.status !== "mastered" && concept.status !== "skipped") {
				const prereqs = concept.relations
					.filter((r) => r.type === "prerequisite_of")
					.map((r) => {
						const c = conceptMap.get(r.fromId);
						return c?.name ?? r.fromId;
					});

				steps.push({
					conceptName: concept.name,
					prerequisites: prereqs,
					order,
				});
				order++;
			}

			for (const depId of adjacency.get(currentId) ?? []) {
				const newDegree = (inDegree.get(depId) ?? 0) - 1;
				inDegree.set(depId, newDegree);
				if (newDegree === 0) queue.push(depId);
			}
		}

		return steps;
	}
}

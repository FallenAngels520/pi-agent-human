import { readFile, writeFile } from "node:fs/promises";
import type { BlindSpot, Concept, Evidence, Relation } from "./types.ts";

export class KnowledgeGraph {
	private concepts: Map<string, Concept> = new Map();
	private conceptRelations: Relation[] = [];

	addConcept(concept: Concept): void {
		this.concepts.set(concept.id, { ...concept });
	}

	getConcept(id: string): Concept | undefined {
		const concept = this.concepts.get(id);
		return concept ? { ...concept } : undefined;
	}

	getAllConcepts(): Concept[] {
		return Array.from(this.concepts.values()).map((c) => ({ ...c }));
	}

	addRelation(relation: Relation): void {
		this.conceptRelations.push({ ...relation });
		const fromConcept = this.concepts.get(relation.fromId);
		if (fromConcept) {
			fromConcept.relations.push({ ...relation });
		}
	}

	updateConfidence(id: string, confidence: number): void {
		const concept = this.concepts.get(id);
		if (concept) {
			concept.confidence = Math.max(0, Math.min(1, confidence));
			concept.lastReviewedAt = Date.now();
			if (confidence >= 0.8) {
				concept.status = "mastered";
			}
		}
	}

	getBlindSpots(threshold: number): BlindSpot[] {
		const spots: BlindSpot[] = [];
		for (const concept of this.concepts.values()) {
			if (concept.confidence < threshold && concept.status !== "skipped") {
				spots.push({
					conceptId: concept.id,
					conceptName: concept.name,
					gap: `Confidence ${concept.confidence} below threshold ${threshold}`,
					severity: concept.confidence < 0.3 ? "high" : concept.confidence < 0.6 ? "medium" : "low",
				});
			}
		}
		return spots;
	}

	getReadyToLearn(): Concept[] {
		const result: Concept[] = [];
		for (const concept of this.concepts.values()) {
			if (concept.status === "mastered" || concept.status === "skipped") continue;
			const prereqs = this.conceptRelations.filter((r) => r.toId === concept.id && r.type === "prerequisite_of");
			const unmetPrereqs = prereqs.filter((r) => {
				const prereq = this.concepts.get(r.fromId);
				return !prereq || prereq.status !== "mastered";
			});
			if (unmetPrereqs.length === 0) {
				result.push({ ...concept });
			}
		}
		return result;
	}

	get size(): number {
		return this.concepts.size;
	}

	addEvidence(conceptId: string, evidence: Evidence): void {
		const concept = this.concepts.get(conceptId);
		if (!concept) return;
		const exists = concept.evidence.some((e) => e.source === evidence.source);
		if (!exists) {
			concept.evidence.push({ ...evidence });
		}
	}

	async saveToFile(filePath: string): Promise<void> {
		const data = {
			concepts: Array.from(this.concepts.values()),
			relations: this.conceptRelations,
		};
		await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
	}

	async loadFromFile(filePath: string): Promise<boolean> {
		try {
			const raw = await readFile(filePath, "utf-8");
			const data = JSON.parse(raw) as { concepts: Concept[]; relations: Relation[] };
			this.concepts.clear();
			this.conceptRelations = [];
			for (const concept of data.concepts) {
				this.concepts.set(concept.id, concept);
			}
			if (data.relations) {
				this.conceptRelations = data.relations;
			}
			for (const rel of this.conceptRelations) {
				const fromConcept = this.concepts.get(rel.fromId);
				if (fromConcept) {
					const hasRelation = fromConcept.relations.some(
						(r) => r.fromId === rel.fromId && r.toId === rel.toId && r.type === rel.type,
					);
					if (!hasRelation) fromConcept.relations.push(rel);
				}
			}
			return true;
		} catch {
			return false;
		}
	}
}

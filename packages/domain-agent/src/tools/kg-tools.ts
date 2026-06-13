import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import type { Concept, RelationType } from "../types.ts";
import { createConcept, createRelation } from "../types.ts";

const addConceptSchema = Type.Object({
	name: Type.String({ description: "Concept name" }),
	description: Type.String({ description: "Concept description or definition" }),
});

const addRelationSchema = Type.Object({
	fromId: Type.String({ description: "Source concept ID" }),
	toId: Type.String({ description: "Target concept ID" }),
	type: Type.String({ description: "Relation type: prerequisite_of, supports, contradicts, generalizes, example_of" }),
});

const queryConceptsSchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Substring to match against concept names" })),
});

const getBlindSpotsSchema = Type.Object({
	threshold: Type.Optional(Type.Number({ description: "Confidence threshold (default 0.6)", default: 0.6 })),
});

const addEvidenceSchema = Type.Object({
	conceptId: Type.String({ description: "Concept ID to add evidence to" }),
	source: Type.String({ description: "Source URL or reference" }),
	type: Type.Optional(
		Type.String({ description: "Evidence type: documentation, paper, code, experiment, web_search" }),
	),
	excerpt: Type.Optional(Type.String({ description: "Relevant excerpt or quote from the source" })),
});

export function createAddConceptTool(kg: KnowledgeGraph): AgentTool<typeof addConceptSchema> {
	return {
		name: "add_concept",
		label: "Add Concept",
		description: "Add a new concept to the knowledge graph.",
		parameters: addConceptSchema,
		execute: async (_toolCallId, params: Static<typeof addConceptSchema>): Promise<AgentToolResult<any>> => {
			const concept = createConcept({ name: params.name, description: params.description });
			kg.addConcept(concept);
			return {
				content: [{ type: "text", text: `Concept added: ${concept.name} (id: ${concept.id})` }],
				details: { concept },
			};
		},
	};
}

export function createAddRelationTool(kg: KnowledgeGraph): AgentTool<typeof addRelationSchema> {
	return {
		name: "add_relation",
		label: "Add Relation",
		description: "Add a relation between two concepts in the knowledge graph.",
		parameters: addRelationSchema,
		execute: async (_toolCallId, params: Static<typeof addRelationSchema>): Promise<AgentToolResult<any>> => {
			const relation = createRelation({
				fromId: params.fromId,
				toId: params.toId,
				type: params.type as RelationType,
			});
			kg.addRelation(relation);
			return {
				content: [{ type: "text", text: `Relation added: ${params.fromId} --[${params.type}]--> ${params.toId}` }],
				details: { relation },
			};
		},
	};
}

export function createQueryConceptsTool(kg: KnowledgeGraph): AgentTool<typeof queryConceptsSchema> {
	return {
		name: "query_concepts",
		label: "Query Concepts",
		description: "Query concepts in the knowledge graph, optionally filtered by name substring.",
		parameters: queryConceptsSchema,
		execute: async (_toolCallId, params: Static<typeof queryConceptsSchema>): Promise<AgentToolResult<any>> => {
			const all = kg.getAllConcepts();
			const results = params.query
				? all.filter((c: Concept) => c.name.toLowerCase().includes(params.query!.toLowerCase()))
				: all;

			const summary = results
				.map((c: Concept) => `- ${c.name} (${c.status}, confidence: ${c.confidence.toFixed(2)})`)
				.join("\n");

			return {
				content: [{ type: "text", text: results.length > 0 ? `Concepts:\n${summary}` : "No concepts found." }],
				details: { results },
			};
		},
	};
}

export function createGetBlindSpotsTool(kg: KnowledgeGraph): AgentTool<typeof getBlindSpotsSchema> {
	return {
		name: "get_blind_spots",
		label: "Get Blind Spots",
		description: "Get concepts with confidence below the specified threshold.",
		parameters: getBlindSpotsSchema,
		execute: async (_toolCallId, params: Static<typeof getBlindSpotsSchema>): Promise<AgentToolResult<any>> => {
			const threshold = params.threshold ?? 0.6;
			const blindSpots = kg.getBlindSpots(threshold);

			const summary =
				blindSpots.length > 0
					? blindSpots.map((bs) => `- ${bs.conceptName} (${bs.severity}): ${bs.gap}`).join("\n")
					: "No blind spots found — all concepts are above the confidence threshold.";

			return {
				content: [{ type: "text", text: summary }],
				details: { blindSpots },
			};
		},
	};
}

export function createAddEvidenceTool(kg: KnowledgeGraph): AgentTool<typeof addEvidenceSchema> {
	return {
		name: "add_evidence",
		label: "Add Evidence",
		description: "Add evidence (source, type, excerpt) to a concept. Skips duplicate sources.",
		parameters: addEvidenceSchema,
		execute: async (_toolCallId, params: Static<typeof addEvidenceSchema>): Promise<AgentToolResult<any>> => {
			const concept = kg.getConcept(params.conceptId);
			if (!concept) {
				return {
					content: [{ type: "text", text: `Concept not found: ${params.conceptId}` }],
					details: {},
				};
			}
			kg.addEvidence(params.conceptId, {
				source: params.source,
				type: (params.type ?? "web_search") as "documentation" | "paper" | "code" | "experiment" | "web_search",
				excerpt: params.excerpt,
			});
			return {
				content: [{ type: "text", text: `Evidence added to "${concept.name}" from ${params.source}` }],
				details: { conceptId: params.conceptId, source: params.source },
			};
		},
	};
}

export function createKnowledgeGraphTools(kg: KnowledgeGraph): AgentTool[] {
	return [
		createAddConceptTool(kg),
		createAddRelationTool(kg),
		createQueryConceptsTool(kg),
		createGetBlindSpotsTool(kg),
		createAddEvidenceTool(kg),
	];
}

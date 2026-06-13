import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import type { KnowledgeGraph } from "../knowledge-graph.ts";
import { KnowledgeSynthesis } from "../synthesis.ts";

const synthesizeSchema = Type.Object({
	conceptIds: Type.Array(Type.String(), { description: "Concept IDs to synthesize" }),
});

const graftingSchema = Type.Object({
	conceptIds: Type.Array(Type.String(), { description: "Source concept IDs to graft from" }),
	targetDomain: Type.String({ description: "Target domain to graft onto" }),
});

export function createSynthesizeTool(kg: KnowledgeGraph): AgentTool<typeof synthesizeSchema> {
	const synthesis = new KnowledgeSynthesis(kg);

	return {
		name: "synthesize",
		label: "Synthesize Knowledge",
		description:
			"Synthesize multiple concepts into a novel insight, application, or framework. Produces something NEW, not a summary.",
		parameters: synthesizeSchema,
		execute: async (_toolCallId, params: Static<typeof synthesizeSchema>): Promise<AgentToolResult<any>> => {
			const prompt = synthesis.buildSynthesisPrompt(params.conceptIds);
			if (!prompt) {
				return {
					content: [{ type: "text", text: "No valid concepts found to synthesize." }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: prompt }],
				details: { conceptIds: params.conceptIds },
			};
		},
	};
}

export function createGraftingTool(kg: KnowledgeGraph): AgentTool<typeof graftingSchema> {
	const synthesis = new KnowledgeSynthesis(kg);

	return {
		name: "cross_domain_graft",
		label: "Cross-Domain Graft",
		description: "Find structural analogies between known concepts and a target domain, then adapt the solution.",
		parameters: graftingSchema,
		execute: async (_toolCallId, params: Static<typeof graftingSchema>): Promise<AgentToolResult<any>> => {
			const prompt = synthesis.buildGraftingPrompt(params.conceptIds, params.targetDomain);
			if (!prompt) {
				return {
					content: [{ type: "text", text: "No valid source concepts found." }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: prompt }],
				details: { conceptIds: params.conceptIds, targetDomain: params.targetDomain },
			};
		},
	};
}

export function createSynthesisTools(kg: KnowledgeGraph): AgentTool[] {
	return [createSynthesizeTool(kg), createGraftingTool(kg)];
}

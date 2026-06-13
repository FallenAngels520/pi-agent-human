import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import { Innovation } from "../innovation.ts";
import type { KnowledgeGraph } from "../knowledge-graph.ts";

const frontierSchema = Type.Object({
	threshold: Type.Optional(Type.Number({ description: "Confidence threshold (default 0.5)", default: 0.5 })),
});

const hypothesisSchema = Type.Object({
	conceptId: Type.String({ description: "Concept ID with a knowledge gap" }),
	gap: Type.String({ description: "Description of the knowledge gap" }),
});

const experimentSchema = Type.Object({
	hypothesis: Type.String({ description: "The hypothesis to test" }),
});

const paradigmSchema = Type.Object({
	conceptIds: Type.Array(Type.String(), { description: "Concept IDs representing current understanding" }),
});

export function createFrontierTool(kg: KnowledgeGraph): AgentTool<typeof frontierSchema> {
	const innovation = new Innovation(kg);

	return {
		name: "detect_frontiers",
		label: "Detect Knowledge Frontiers",
		description: "Identify open questions and knowledge boundaries — concepts with confidence below the threshold.",
		parameters: frontierSchema,
		execute: async (_tcId, params: Static<typeof frontierSchema>): Promise<AgentToolResult<any>> => {
			const frontiers = innovation.detectFrontiers(params.threshold ?? 0.5);
			const text =
				frontiers.length > 0
					? frontiers.map((f) => `- **${f.conceptName}** (${f.severity}): ${f.gap}`).join("\n")
					: "No knowledge frontiers detected — all concepts are well-understood at this threshold.";

			return { content: [{ type: "text", text }], details: { frontiers } };
		},
	};
}

export function createHypothesisTool(kg: KnowledgeGraph): AgentTool<typeof hypothesisSchema> {
	const innovation = new Innovation(kg);

	return {
		name: "generate_hypotheses",
		label: "Generate Hypotheses",
		description: "Generate testable hypotheses to fill a knowledge gap.",
		parameters: hypothesisSchema,
		execute: async (_tcId, params: Static<typeof hypothesisSchema>): Promise<AgentToolResult<any>> => {
			const prompt = innovation.buildHypothesisPrompt({
				conceptId: params.conceptId,
				conceptName: params.conceptId,
				gap: params.gap,
				severity: "high",
			});
			return { content: [{ type: "text", text: prompt }], details: { conceptId: params.conceptId } };
		},
	};
}

export function createExperimentTool(kg: KnowledgeGraph): AgentTool<typeof experimentSchema> {
	const innovation = new Innovation(kg);

	return {
		name: "design_experiment",
		label: "Design Experiment",
		description: "Design an experiment to test a hypothesis.",
		parameters: experimentSchema,
		execute: async (_tcId, params: Static<typeof experimentSchema>): Promise<AgentToolResult<any>> => {
			const prompt = innovation.buildExperimentPrompt(params.hypothesis);
			return { content: [{ type: "text", text: prompt }], details: { hypothesis: params.hypothesis } };
		},
	};
}

export function createParadigmTool(kg: KnowledgeGraph): AgentTool<typeof paradigmSchema> {
	const innovation = new Innovation(kg);

	return {
		name: "challenge_paradigm",
		label: "Challenge Paradigm",
		description: "Question foundational assumptions of a domain and propose alternative paradigms.",
		parameters: paradigmSchema,
		execute: async (_tcId, params: Static<typeof paradigmSchema>): Promise<AgentToolResult<any>> => {
			const prompt = innovation.buildParadigmChallengePrompt(params.conceptIds);
			if (!prompt) {
				return { content: [{ type: "text", text: "No concepts found." }], details: {} };
			}
			return { content: [{ type: "text", text: prompt }], details: { conceptIds: params.conceptIds } };
		},
	};
}

export function createInnovationTools(kg: KnowledgeGraph): AgentTool[] {
	return [createFrontierTool(kg), createHypothesisTool(kg), createExperimentTool(kg), createParadigmTool(kg)];
}

import { completeSimple, type Model, type TextContent } from "@earendil-works/pi-ai";
import { extractJsonCandidates } from "./parse-result.ts";

export type DeepThinkingMode = "learn" | "apply" | "reflect" | "innovate" | "evolve" | "consolidate";

export interface DeepThinkingInput {
	domain: string;
	objective: string;
	mode: DeepThinkingMode;
	memoryPath?: {
		domain: string;
		capability?: string;
		concept?: string;
		situation?: string;
	};
	knowledgeSummary?: string;
	evidence?: string[];
	observations?: string[];
	failures?: string[];
	constraints?: string[];
	maxOutputItems?: number;
}

export interface DeepThinkingResult {
	mode: DeepThinkingMode;
	conclusions: string[];
	assumptions: string[];
	contradictions: string[];
	blindSpots: string[];
	knowledgeUpdates: string[];
	nextResearchQuestions: string[];
	nextPracticeTasks: string[];
	innovationHypotheses: string[];
	confidence: number;
}

export interface DeepThinkingEngineConfig {
	model: Model<string>;
}

const DEEP_THINKING_MODES = ["learn", "apply", "reflect", "innovate", "evolve", "consolidate"] as const;

const MODE_INSTRUCTIONS: Record<DeepThinkingMode, string> = {
	learn: "Extract durable concepts, relationships, evidence quality, contradictions, and learning gaps from the material.",
	apply: "Use the current knowledge to solve the practical objective, identify risks, and name the knowledge that matters.",
	reflect:
		"Analyze root causes, failed assumptions, missing knowledge, and concrete remediation questions after an attempt.",
	innovate: "Generate useful hypotheses through analogy, recombination, contradiction mining, and experiment design.",
	evolve:
		"Reorganize the domain model, adjust confidence, retire weak beliefs, and propose higher-leverage learning directions.",
	consolidate:
		"You are a learning strategist. Analyze the complete learning experience — what was learned, how it was verified, what gaps were found — and extract durable, transferable wisdom. Focus on WHY behind success and failure, not just WHAT. Distinguish concept-specific insights from general reusable principles.",
};

function isDeepThinkingMode(value: unknown): value is DeepThinkingMode {
	return typeof value === "string" && DEEP_THINKING_MODES.includes(value as DeepThinkingMode);
}

function formatListSection(title: string, values: string[] | undefined): string[] {
	if (!values || values.length === 0) return [];
	return ["", `## ${title}`, ...values.map((value) => `- ${value}`)];
}

export function buildDeepThinkingPrompt(input: DeepThinkingInput): string {
	const maxItems = input.maxOutputItems ?? 5;
	const lines: string[] = [
		"# Deep Thinking Mode",
		"",
		`Domain: ${input.domain}`,
		`Mode: ${input.mode}`,
		`Objective: ${input.objective}`,
		"",
		"## Mode Guidance",
		MODE_INSTRUCTIONS[input.mode],
	];

	if (input.knowledgeSummary) {
		lines.push("", "## Current Knowledge Summary", input.knowledgeSummary);
	}

	lines.push(...formatListSection("Evidence", input.evidence));
	lines.push(...formatListSection("Observations", input.observations));
	lines.push(...formatListSection("Failures", input.failures));
	lines.push(...formatListSection("Constraints", input.constraints));

	lines.push(
		"",
		"## Required Cognitive Work",
		"- State explicit assumptions.",
		"- Check for contradictions and boundary conditions.",
		"- Identify blind spots and missing evidence.",
		"- Separate conclusions from hypotheses.",
		"- Assign a calibrated confidence from 0 to 1.",
		"",
		"## Output Contract",
		`At most ${maxItems} items per array.`,
		"Return JSON only with this shape:",
		JSON.stringify(
			{
				mode: input.mode,
				conclusions: [],
				assumptions: [],
				contradictions: [],
				blindSpots: [],
				knowledgeUpdates: [],
				nextResearchQuestions: [],
				nextPracticeTasks: [],
				innovationHypotheses: [],
				confidence: 0,
			},
			null,
			2,
		),
	);

	return lines.join("\n");
}

function getStringArray(record: Record<string, unknown>, key: keyof DeepThinkingResult): string[] {
	const value = record[key];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function clampConfidence(value: unknown): number {
	if (typeof value !== "number" || Number.isNaN(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function normalizeParsedResult(value: unknown): DeepThinkingResult | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (!isDeepThinkingMode(record.mode)) return null;

	return {
		mode: record.mode,
		conclusions: getStringArray(record, "conclusions"),
		assumptions: getStringArray(record, "assumptions"),
		contradictions: getStringArray(record, "contradictions"),
		blindSpots: getStringArray(record, "blindSpots"),
		knowledgeUpdates: getStringArray(record, "knowledgeUpdates"),
		nextResearchQuestions: getStringArray(record, "nextResearchQuestions"),
		nextPracticeTasks: getStringArray(record, "nextPracticeTasks"),
		innovationHypotheses: getStringArray(record, "innovationHypotheses"),
		confidence: clampConfidence(record.confidence),
	};
}

export function parseDeepThinkingResult(text: string): DeepThinkingResult | null {
	for (const candidate of extractJsonCandidates(text)) {
		try {
			const parsed = normalizeParsedResult(JSON.parse(candidate) as unknown);
			if (parsed) return parsed;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

function fallbackResult(mode: DeepThinkingMode, responseText: string): DeepThinkingResult {
	const responseSummary = responseText.trim().slice(0, 500);
	return {
		mode,
		conclusions: [],
		assumptions: [],
		contradictions: [],
		blindSpots: [
			responseSummary
				? `Deep thinking response could not be parsed as structured JSON: ${responseSummary}`
				: "Deep thinking response could not be parsed as structured JSON.",
		],
		knowledgeUpdates: [],
		nextResearchQuestions: [],
		nextPracticeTasks: [],
		innovationHypotheses: [],
		confidence: 0,
	};
}

export class DeepThinkingEngine {
	private readonly model: Model<string>;

	constructor(config: DeepThinkingEngineConfig) {
		this.model = config.model;
	}

	async think(input: DeepThinkingInput): Promise<DeepThinkingResult> {
		const prompt = buildDeepThinkingPrompt(input);
		const response = await completeSimple(this.model, {
			systemPrompt:
				"You are a domain-agnostic deep thinking engine. Return concise structured JSON only. Do not reveal hidden chain-of-thought.",
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		});
		const responseText = response.content
			.filter((content): content is TextContent => content.type === "text")
			.map((content) => content.text)
			.join("\n");
		return parseDeepThinkingResult(responseText) ?? fallbackResult(input.mode, responseText);
	}
}

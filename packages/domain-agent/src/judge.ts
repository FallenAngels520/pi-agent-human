import { completeSimple, type Model, type TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Explicit, testable criterion for evaluation. */
export interface JudgmentCriterion {
	name: string;
	description: string;
	check?: string;
}

/** Evidence presented to the judge for evaluation. */
export interface JudgmentEvidence {
	agentWork: string;
	fileList?: string[];
	testOutput?: string;
	lintOutput?: string;
	commandOutputs?: Record<string, string>;
}

/** A single criterion evaluation result. */
export interface CriterionVerdict {
	name: string;
	passed: boolean;
	reasoning: string;
}

/** Full judgment returned by {@link JudgeAgent.evaluate}. */
export interface Judgment {
	passed: boolean;
	confidence: number;
	summary: string;
	criteria: CriterionVerdict[];
}

/** Configuration for {@link JudgeAgent}. */
export interface JudgeConfig {
	model: Model<string>;
	systemPrompt?: string;
	extraInstructions?: string;
}

/** Extract text content from an {@link AgentMessage}. */
function extractMessageText(message: AgentMessage): string {
	if (message.role === "assistant" || message.role === "user") {
		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}
	}
	return "";
}

/** Collect recent assistant work from messages, walking back until a user message. */
export function collectAgentWork(messages: AgentMessage[], maxLength = 8000): string {
	const parts: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "user") break;
		const text = extractMessageText(msg);
		if (text) parts.unshift(text);
	}
	return parts.join("\n").slice(0, maxLength);
}

/** Build a structured evaluation prompt. */
function buildEvaluationPrompt(
	task: string,
	criteria: JudgmentCriterion[],
	evidence: JudgmentEvidence,
	extraInstructions?: string,
): string {
	const lines: string[] = ["## Task Description", task, "", "## Evaluation Criteria"];

	for (const c of criteria) {
		lines.push(`- **${c.name}**: ${c.description}`);
		if (c.check) {
			lines.push(`  Verification: ${c.check}`);
		}
	}

	lines.push("", "## Evidence", "", "### Agent's Work");
	lines.push(evidence.agentWork || "(no work performed)");

	if (evidence.fileList && evidence.fileList.length > 0) {
		lines.push("", "### Files Modified", ...evidence.fileList.map((f) => `- ${f}`));
	}

	if (evidence.testOutput) {
		lines.push("", "### Test Output", "```", evidence.testOutput, "```");
	}

	if (evidence.lintOutput) {
		lines.push("", "### Lint Output", "```", evidence.lintOutput, "```");
	}

	if (evidence.commandOutputs) {
		for (const [name, output] of Object.entries(evidence.commandOutputs)) {
			lines.push("", `### ${name}`, "```", output, "```");
		}
	}

	if (extraInstructions) {
		lines.push("", "## Additional Instructions", extraInstructions);
	}

	lines.push(
		"",
		"## Verdict",
		"Evaluate each criterion. Respond ONLY with a JSON object:",
		"{",
		'  "criteria": [',
		'    { "name": "criterion name", "passed": true/false, "reasoning": "why" }',
		"  ],",
		'  "summary": "one-paragraph overall assessment",',
		'  "confidence": 0.0-1.0',
		"}",
	);

	return lines.join("\n");
}

/** Default system prompt for the judge model. */
function defaultJudgeSystemPrompt(): string {
	return [
		"You are an objective code reviewer and task evaluator.",
		"Your job is to determine whether a coding agent has correctly completed a task.",
		"",
		"Rules:",
		"1. Be precise — check each criterion against the provided evidence.",
		"2. Be honest — agents often claim success for incomplete work.",
		"3. If evidence is missing for a criterion, mark it as failed.",
		"4. Don't assume the agent did something unless there is explicit evidence.",
		"5. Your confidence should reflect how certain you are of your assessment.",
		"",
		"Respond ONLY with JSON. No preamble, no explanations outside the JSON.",
	].join("\n");
}

/** Parse the judge model's JSON response into a {@link Judgment}. */
function parseJudgmentResponse(text: string): Judgment | null {
	const candidates: string[] = [];

	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (codeBlockMatch) {
		candidates.push(codeBlockMatch[1].trim());
	}

	const jsonMatch = text.match(/\{[\s\S]*"criteria"[\s\S]*\}/);
	if (jsonMatch) {
		candidates.push(jsonMatch[0]);
	}

	if (text.trim().startsWith("{")) {
		candidates.push(text.trim());
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (Array.isArray(parsed.criteria)) {
				const criteria = parsed.criteria.map((c: Record<string, unknown>) => ({
					name: String(c.name ?? ""),
					passed: Boolean(c.passed),
					reasoning: String(c.reasoning ?? ""),
				}));

				const allPassed = criteria.length > 0 && criteria.every((c: { passed: boolean }) => c.passed);

				return {
					passed: allPassed,
					confidence:
						typeof parsed.confidence === "number"
							? Math.max(0, Math.min(1, parsed.confidence))
							: allPassed
								? 0.8
								: 0.3,
					summary: typeof parsed.summary === "string" ? parsed.summary : "",
					criteria,
				};
			}
		} catch {
			// Try next candidate
		}
	}

	return null;
}

/**
 * {@link JudgeAgent} provides standalone, LLM-based task evaluation.
 *
 * Unlike the verifier embedded in {@code GoalLoop}, {@code JudgeAgent} is a
 * reusable component usable independently — for PR review, task completion
 * checking, acceptance-criteria verification, or as the verifier inside
 * a {@code GoalLoop} or {@code TaskOrchestrator}.
 *
 * Usage (standalone):
 * ```ts
 * const judge = new JudgeAgent({ model: fastModel });
 * const verdict = await judge.evaluate(
 *   "Fix login form validation",
 *   [
 *     { name: "email_validation", description: "Invalid emails rejected" },
 *     { name: "password_length", description: "Password min 8 chars" },
 *   ],
 *   {
 *     agentWork: collectAgentWork(messages),
 *     testOutput: "...",
 *     lintOutput: "...",
 *   },
 * );
 * ```
 */
export class JudgeAgent {
	private config: JudgeConfig;

	constructor(config: JudgeConfig) {
		this.config = config;
	}

	/**
	 * Evaluate whether a task is complete according to the given criteria.
	 */
	async evaluate(task: string, criteria: JudgmentCriterion[], evidence: JudgmentEvidence): Promise<Judgment> {
		const prompt = buildEvaluationPrompt(task, criteria, evidence, this.config.extraInstructions);

		try {
			const response = await completeSimple(this.config.model, {
				systemPrompt: this.config.systemPrompt ?? defaultJudgeSystemPrompt(),
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			});

			const responseText = response.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			const parsed = parseJudgmentResponse(responseText);
			if (parsed) return parsed;

			return {
				passed: false,
				confidence: 0.2,
				summary: responseText.slice(0, 2000),
				criteria: criteria.map((c) => ({
					name: c.name,
					passed: false,
					reasoning: "Could not parse judge response",
				})),
			};
		} catch (error) {
			return {
				passed: false,
				confidence: 0,
				summary: `Judge model error: ${error instanceof Error ? error.message : String(error)}`,
				criteria: criteria.map((c) => ({
					name: c.name,
					passed: false,
					reasoning: "Judge model invocation failed",
				})),
			};
		}
	}
}

import type { KnowledgeGraph } from "./knowledge-graph.ts";
import { extractJsonCandidates } from "./parse-result.ts";

// ── Output types ────────────────────────────────────────────────────────────

export interface SynthesisOutput {
	synthesis: string;
	novelty: string;
	practicalValue: string;
	confidence: number;
}

export interface GraftingOutput {
	analogy: string;
	graftedSolution: string;
	limitations: string;
	confidence: number;
}

// ── Parse helpers ───────────────────────────────────────────────────────────

function parseSynthesisResponse(text: string): SynthesisOutput | null {
	for (const candidate of extractJsonCandidates(text)) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.synthesis === "string") {
				return {
					synthesis: (parsed.synthesis as string) ?? "",
					novelty: (parsed.novelty as string) ?? "",
					practicalValue: (parsed.practicalValue as string) ?? "",
					confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
				};
			}
		} catch {
			// Try next candidate
		}
	}
	return null;
}

function parseGraftingResponse(text: string): GraftingOutput | null {
	for (const candidate of extractJsonCandidates(text)) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.analogy === "string") {
				return {
					analogy: (parsed.analogy as string) ?? "",
					graftedSolution: (parsed.graftedSolution as string) ?? "",
					limitations: (parsed.limitations as string) ?? "",
					confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
				};
			}
		} catch {
			// Try next candidate
		}
	}
	return null;
}

/**
 * Minimal agent interface for what KnowledgeSynthesis needs to execute prompts.
 */
export interface SynthesisAgentLike {
	prompt(text: string): Promise<void>;
	waitForIdle(): Promise<void>;
	state: { messages: Array<{ role?: string; content?: unknown }> };
}

/**
 * KnowledgeSynthesis combines multiple mastered concepts to generate novel insights.
 *
 * ## Two modes
 *
 * 1. **Synthesis** — combine concepts within a domain to find emergent properties
 * 2. **Grafting** — map patterns from a source domain to a target domain (cross-domain analogy)
 *
 * ## Usage
 *
 * ```typescript
 * const synth = new KnowledgeSynthesis(kg);
 *
 * // Synthesis mode
 * const result = await synth.execute(agent, ["concept-1", "concept-2"]);
 * console.log(result.synthesis, result.novelty);
 *
 * // Grafting mode
 * const gResult = await synth.executeGrafting(agent, ["concept-1"], "biology");
 * console.log(gResult.analogy, gResult.graftedSolution);
 * ```
 */
export class KnowledgeSynthesis {
	private kg: KnowledgeGraph;

	constructor(kg: KnowledgeGraph) {
		this.kg = kg;
	}

	// ── Prompt builders (existing API) ──────────────────────────────────────

	buildSynthesisPrompt(conceptIds: string[]): string {
		const concepts = conceptIds.map((id) => this.kg.getConcept(id)).filter(Boolean);
		if (concepts.length === 0) return "";

		const conceptDesc = concepts
			.map((c) => `- **${c!.name}**: ${c!.description} (confidence: ${c!.confidence.toFixed(2)})`)
			.join("\n");

		return [
			"## Knowledge Synthesis",
			"",
			"Given the following mastered concepts:",
			"",
			conceptDesc,
			"",
			"### Task",
			"Synthesize these concepts into a **novel** insight, application, or framework.",
			"This is NOT a summary. You must produce something NEW that is not obvious from the individual concepts:",
			"1. A novel combination that creates emergent properties",
			"2. A new application or use case that requires both concepts working together",
			"3. A theoretical insight that bridges or extends these concepts",
			"",
			"### Output Format",
			"Respond with JSON:",
			"{",
			'  "synthesis": "your novel synthesis (paragraph)",',
			'  "novelty": "what is new about this (1 sentence)",',
			'  "practicalValue": "how could this be applied? (1 sentence)",',
			'  "confidence": 0.0',
			"}",
		].join("\n");
	}

	buildGraftingPrompt(sourceConceptIds: string[], targetDomain: string): string {
		const concepts = sourceConceptIds.map((id) => this.kg.getConcept(id)).filter(Boolean);
		if (concepts.length === 0) return "";

		const conceptDesc = concepts.map((c) => `- **${c!.name}**: ${c!.description}`).join("\n");

		return [
			"## Cross-Domain Grafting",
			"",
			"### Source Domain (known concepts)",
			conceptDesc,
			"",
			`### Target Domain: **${targetDomain}**`,
			"",
			"### Task",
			"Find structural analogies between the source concepts and the target domain.",
			"Then **graft** the source solution onto the target domain:",
			"1. Identify the core mechanism or pattern in the source concepts",
			"2. Map it to an analogous problem in the target domain",
			"3. Adapt the solution — what would the target-domain equivalent look like?",
			"4. Identify where the analogy breaks down (limitations)",
			"",
			"### Output Format",
			"Respond with JSON:",
			"{",
			'  "analogy": "the structural similarity you identified",',
			'  "graftedSolution": "the adapted solution for the target domain",',
			'  "limitations": "where the analogy breaks down",',
			'  "confidence": 0.0',
			"}",
		].join("\n");
	}

	generateCreativeQuestions(conceptIds: string[]): string[] {
		const concepts = conceptIds.map((id) => this.kg.getConcept(id)).filter(Boolean);
		if (concepts.length === 0) return [];

		const name = concepts[0]!.name;
		return [
			`How could ${name} be applied in a completely different domain (e.g., biology, economics, art)?`,
			`What if the opposite of ${name} were true? What would that world look like?`,
			`What is the most surprising consequence of ${name} that most people don't realize?`,
		];
	}

	// ── Executable methods (new API) ────────────────────────────────────────

	/**
	 * Execute knowledge synthesis: send the synthesis prompt to an agent,
	 * wait for the response, parse the result.
	 *
	 * @param agent — any agent that supports prompt() + waitForIdle() + state.messages
	 * @param conceptIds — IDs of concepts to synthesize (must be in the knowledge graph)
	 * @returns parsed synthesis output, or null if parsing failed
	 */
	async execute(agent: SynthesisAgentLike, conceptIds: string[]): Promise<SynthesisOutput | null> {
		const prompt = this.buildSynthesisPrompt(conceptIds);
		if (!prompt) return null;

		await agent.prompt(prompt);
		await agent.waitForIdle();

		const responseText = extractLastAssistantText(agent.state.messages);
		if (!responseText) return null;

		return parseSynthesisResponse(responseText);
	}

	/**
	 * Execute cross-domain grafting: send the grafting prompt to an agent,
	 * wait for the response, parse the result.
	 *
	 * @param agent — any agent that supports prompt() + waitForIdle() + state.messages
	 * @param sourceConceptIds — IDs of source concepts to graft from
	 * @param targetDomain — the target domain to graft onto (e.g., "biology", "economics")
	 * @returns parsed grafting output, or null if parsing failed
	 */
	async executeGrafting(
		agent: SynthesisAgentLike,
		sourceConceptIds: string[],
		targetDomain: string,
	): Promise<GraftingOutput | null> {
		const prompt = this.buildGraftingPrompt(sourceConceptIds, targetDomain);
		if (!prompt) return null;

		await agent.prompt(prompt);
		await agent.waitForIdle();

		const responseText = extractLastAssistantText(agent.state.messages);
		if (!responseText) return null;

		return parseGraftingResponse(responseText);
	}
}

// ── Text extraction ─────────────────────────────────────────────────────────

/**
 * Extract the text content from the most recent assistant message.
 */
function extractLastAssistantText(messages: ReadonlyArray<{ role?: string; content?: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const textParts = content
				.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
				.map((c) => c.text);
			return textParts.join("\n");
		}
	}
	return "";
}

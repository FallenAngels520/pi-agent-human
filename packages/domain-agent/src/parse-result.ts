import type { RoundResult } from "./types.ts";

/**
 * Extract JSON candidate strings from LLM response text.
 *
 * Tries three strategies in order:
 * 1. Markdown code block (```json ... ``` or ``` ... ```)
 * 2. JSON object pattern containing "findings" and "confidence"
 * 3. Raw text if it starts with `{`
 */
export function extractJsonCandidates(text: string): string[] {
	const candidates: string[] = [];

	// Candidate 1: markdown code block
	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (codeBlockMatch?.[1]) {
		candidates.push(codeBlockMatch[1].trim());
	}

	// Candidate 2: JSON object with required fields embedded in text
	const jsonMatch = text.match(/\{[\s\S]*"findings"[\s\S]*"confidence"[\s\S]*\}/);
	if (jsonMatch?.[0]) {
		candidates.push(jsonMatch[0]);
	}

	// Candidate 3: the whole text as-is if it looks like JSON
	if (text.trim().startsWith("{")) {
		candidates.push(text.trim());
	}

	return candidates;
}

/**
 * Structured findings parsed from an agent round response.
 */
export interface StructuredFindings {
	findings: string;
	contradictions: string;
	uncertainties: string;
	confidence: number;
}

/**
 * Clamp a confidence value to [0, 1]. Returns 0 for non-number values.
 */
export function clampConfidence(value: unknown): number {
	if (typeof value !== "number" || Number.isNaN(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

/**
 * Parse a RoundResult from structured JSON in LLM response text.
 *
 * Handles plain JSON, markdown-wrapped JSON, and JSON embedded in surrounding text.
 * Returns null if no parseable JSON with the required fields is found.
 */
export function parseRoundResult(text: string, round: number, perspective: string): RoundResult | null {
	for (const candidate of extractJsonCandidates(text)) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.findings === "string" && typeof parsed.confidence === "number") {
				return {
					round,
					perspective,
					findings: (parsed.findings as string) ?? "",
					contradictions: (parsed.contradictions as string) ?? "",
					uncertainties: (parsed.uncertainties as string) ?? "",
					confidence: clampConfidence(parsed.confidence),
				};
			}
		} catch {
			// Try next candidate
		}
	}

	return null;
}

/**
 * Parse structured findings from arbitrary JSON text (no round/perspective metadata).
 *
 * Used by ContinuousLearningAgent for inline round result parsing.
 */
export function tryParseStructuredFindings(text: string): StructuredFindings | null {
	for (const candidate of extractJsonCandidates(text)) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.findings === "string" && typeof parsed.confidence === "number") {
				return {
					findings: (parsed.findings as string) ?? "",
					contradictions: (parsed.contradictions as string) ?? "",
					uncertainties: (parsed.uncertainties as string) ?? "",
					confidence: clampConfidence(parsed.confidence),
				};
			}
		} catch {
			// Try next candidate
		}
	}

	return null;
}

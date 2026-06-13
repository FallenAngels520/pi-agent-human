import { describe, expect, it } from "vitest";
import { buildLearnerSystemPrompt, buildMainSystemPrompt } from "../../src/tools/prompt-assembly.ts";

describe("buildMainSystemPrompt", () => {
	it("returns default prompt with no context", () => {
		const prompt = buildMainSystemPrompt();
		expect(prompt).toContain("coding agent");
		expect(prompt).toContain("query_knowledge");
		expect(prompt).toContain("learn_topic");
		expect(prompt).toContain("check_learning");
	});

	it("includes capability profile when KG is provided", () => {
		const mockKg = {
			getAllConcepts: () => [
				{ name: "Rust Ownership", confidence: 0.85, status: "mastered", description: "Part of: Rust" },
				{ name: "Bevy ECS", confidence: 0.7, status: "active", description: "Part of: Bevy" },
			],
		} as any;
		const prompt = buildMainSystemPrompt({ kg: mockKg });
		expect(prompt).toContain("intermediate");
		expect(prompt).toContain("Rust");
		expect(prompt).toContain("Bevy");
	});

	it("includes learning status when active", () => {
		const prompt = buildMainSystemPrompt({
			activeLearning: [{ domain: "bevy", completed: 2, total: 4 }],
		});
		expect(prompt).toContain("Currently Learning");
		expect(prompt).toContain("2/4 tasks done");
	});

	it("includes bootstrap identity when provided", () => {
		const prompt = buildMainSystemPrompt({
			bootstrap: {
				identity: "I am a specialized Rust coding agent.",
				soul: "Be direct and helpful.",
			},
		});
		expect(prompt).toContain("I am a specialized Rust coding agent");
		expect(prompt).toContain("Be direct and helpful");
	});
});

describe("buildLearnerSystemPrompt", () => {
	it("builds focused learner prompt", () => {
		const prompt = buildLearnerSystemPrompt({ domain: "Bevy ECS" });
		expect(prompt).toContain("learning specialist");
		expect(prompt).toContain("Bevy ECS");
		expect(prompt).toContain("web_search");
		expect(prompt).toContain("learn_topic");
		expect(prompt).toContain("CANNOT modify files");
	});

	it("includes existing concepts for reuse", () => {
		const prompt = buildLearnerSystemPrompt({
			domain: "Bevy ECS",
			existingConcepts: [
				{ name: "Entities", confidence: 0.75 },
				{ name: "Components", confidence: 0.82 },
			],
		});
		expect(prompt).toContain("Already Known");
		expect(prompt).toContain("Entities (confidence: 0.75)");
		expect(prompt).toContain("don't re-learn");
	});

	it("includes task context when provided", () => {
		const prompt = buildLearnerSystemPrompt({
			domain: "Bevy ECS",
			task: { id: 3, subject: "Change Detection" } as any,
		});
		expect(prompt).toContain("task #3");
		expect(prompt).toContain("Change Detection");
	});
});

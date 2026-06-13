import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskBoard } from "../../src/task-board.ts";
import { createCheckLearningTool, createQueryKnowledgeTool } from "../../src/tools/learn-tool.ts";

const TEST_DOMAIN = "integration-test-domain";

beforeEach(() => {
	try {
		rmSync(`.tasks/${TEST_DOMAIN}`, { recursive: true });
	} catch {}
});

afterEach(() => {
	try {
		rmSync(`.tasks/${TEST_DOMAIN}`, { recursive: true });
	} catch {}
});

describe("TaskBoard + learn tool integration", () => {
	it("createCheckLearningTool reports no session for unknown domain", async () => {
		const pools = new Map();
		const tool = createCheckLearningTool(pools);
		const result = await tool.execute("call-1", { domain: "nonexistent" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("No active learning session found");
		expect(result.details.found).toBe(false);
	});

	it("createCheckLearningTool reports progress when pool exists", async () => {
		const pools = new Map();
		// Simulate: pool registered with tasks
		const tb = new TaskBoard();
		tb.create(TEST_DOMAIN, "Task 1");
		tb.create(TEST_DOMAIN, "Task 2");
		tb.claim(TEST_DOMAIN, 1, "learner-a");
		tb.update(TEST_DOMAIN, 1, "completed");

		// Mock pool with the task board
		pools.set(TEST_DOMAIN, { getTaskBoard: () => tb, isRunning: () => true });

		const tool = createCheckLearningTool(pools);
		const result = await tool.execute("call-1", { domain: TEST_DOMAIN });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("In progress");
		expect(text).toContain("1/2");
		expect(result.details.status).toBe("learning");
	});

	it("createQueryKnowledgeTool with empty KG returns unknown", async () => {
		const mockKg = { getAllConcepts: () => [] } as any;
		const tool = createQueryKnowledgeTool(mockKg);
		const result = await tool.execute("call-1", { question: "What is XYZ?" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("No knowledge found");
		expect(result.details.status).toBe("unknown");
	});

	it("createQueryKnowledgeTool with matching concept returns knowledge", async () => {
		const mockKg = {
			getAllConcepts: () => [
				{
					name: "Rust Ownership",
					description: "Rust's ownership system ensures memory safety.",
					confidence: 0.85,
					evidence: [{ type: "web_fetch", source: "https://doc.rust-lang.org/book/ch04-01.html" }],
				},
			],
		} as any;
		const tool = createQueryKnowledgeTool(mockKg);
		const result = await tool.execute("call-1", { question: "What is Rust ownership?" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Rust Ownership");
		expect(text).toContain("0.85");
		expect(text).toContain("doc.rust-lang.org");
		expect(result.details.status).toBe("found");
	});

	it("createQueryKnowledgeTool reports learning status when pool is active", async () => {
		const mockKg = { getAllConcepts: () => [] } as any;
		const tb = new TaskBoard();
		tb.create("rust", "Learn Ownership");
		tb.claim("rust", 1, "learner-a");

		const pools = new Map();
		pools.set("rust", {
			isRunning: () => true,
			getTaskBoard: () => tb,
		});

		const tool = createQueryKnowledgeTool(mockKg, pools);
		const result = await tool.execute("call-1", { question: "rust" });

		const _text = (result.content[0] as { type: "text"; text: string }).text;
		expect(result.details.status).toBe("learning");
	});
});

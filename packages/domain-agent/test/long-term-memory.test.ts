import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { JsonLongTermMemory, MemoryConsolidator } from "../src/long-term-memory.ts";

const tmpFile = "test-output/pi-long-term-memory-test.json";

afterEach(async () => {
	try {
		await rm(tmpFile);
	} catch {
		/* ignore */
	}
});

describe("JsonLongTermMemory", () => {
	it("records searchable observations and fetches details by id", async () => {
		const memory = new JsonLongTermMemory();

		const event = await memory.recordEvent({
			domain: "Rust ownership",
			type: "learning_event",
			title: "Learned ownership moves",
			text: "Moving a String transfers ownership to the callee.",
			concepts: ["Ownership", "Move semantics"],
			facts: ["String move invalidates the original binding."],
		});

		const results = await memory.search({ query: "ownership move", domain: "Rust ownership" });
		const details = await memory.getEvents([event.id]);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			id: event.id,
			type: "learning_event",
			title: "Learned ownership moves",
		});
		expect(details).toHaveLength(1);
		expect(details[0].text).toContain("transfers ownership");
	});

	it("returns chronological context around an anchor event", async () => {
		const memory = new JsonLongTermMemory();
		await memory.recordEvent({ domain: "Agents", type: "learning_event", title: "First", text: "Initial fact" });
		const anchor = await memory.recordEvent({
			domain: "Agents",
			type: "failure_event",
			title: "Second",
			text: "Application failed",
		});
		await memory.recordEvent({ domain: "Agents", type: "reflection_event", title: "Third", text: "Root cause" });

		const timeline = await memory.timeline({ anchorId: anchor.id, before: 1, after: 1 });

		expect(timeline.map((entry) => entry.title)).toEqual(["First", "Second", "Third"]);
		expect(timeline[1]).toMatchObject({ id: anchor.id, anchor: true });
	});

	it("persists events, drawers, summaries, and temporal facts to JSON", async () => {
		const memory = new JsonLongTermMemory({ filePath: tmpFile });
		await memory.recordEvent({
			domain: "Agents",
			type: "strategy_event",
			title: "Use progressive recall",
			text: "Search, timeline, then details keeps context small.",
			concepts: ["Progressive recall"],
		});
		await memory.recordDrawer({
			wing: "Agents",
			room: "Memory",
			title: "Verbatim note",
			text: "A drawer stores original content without paraphrase.",
			tags: ["drawer"],
		});
		await memory.recordSummary({
			domain: "Agents",
			title: "Session summary",
			text: "The agent learned progressive recall.",
			concepts: ["Progressive recall"],
		});
		const fact = await memory.recordFact({
			subject: "Progressive recall",
			predicate: "reduces",
			object: "context waste",
			validFrom: "2026-06-10T00:00:00.000Z",
		});
		await memory.invalidateFact(fact.id, "2026-06-11T00:00:00.000Z");
		await memory.saveToFile();

		const loaded = new JsonLongTermMemory({ filePath: tmpFile });
		const didLoad = await loaded.loadFromFile();
		const context = await loaded.buildContext({ domain: "Agents", query: "progressive recall", limit: 5 });

		expect(didLoad).toBe(true);
		expect(context.summary).toContain("Use progressive recall");
		expect(context.summary).toContain("Verbatim note");
		expect(context.summary).toContain("Session summary");
		expect(context.temporalFacts[0]).toMatchObject({
			subject: "Progressive recall",
			predicate: "reduces",
			object: "context waste",
			validTo: "2026-06-11T00:00:00.000Z",
		});
	});

	it("retrieves distilled principles, strategies, and procedures by memory path", async () => {
		const memory = new JsonLongTermMemory();
		const path = {
			domain: "Rust",
			capability: "Ownership reasoning",
			concept: "Borrowing",
			situation: "Compiler reports lifetime error",
		};

		await memory.recordDistilledKnowledge({
			path,
			level: "principle",
			title: "Owner outlives reference",
			text: "A reference cannot outlive the owner of the value it points to.",
			sourceEventIds: [],
			confidence: 0.9,
			tags: ["lifetime", "borrow checker"],
		});
		await memory.recordDistilledKnowledge({
			path,
			level: "strategy",
			title: "Trace owner before reference",
			text: "When debugging a lifetime error, identify the owner scope before changing annotations.",
			sourceEventIds: [],
			confidence: 0.8,
		});
		await memory.recordDistilledKnowledge({
			path,
			level: "procedure",
			title: "Lifetime debugging routine",
			text: "List owner creation, reference creation, last reference use, and owner drop in order.",
			sourceEventIds: [],
			confidence: 0.75,
		});

		const results = await memory.retrieveDistilledKnowledge({
			path,
			query: "lifetime owner reference",
			levels: ["principle", "strategy", "procedure"],
			limit: 5,
		});
		const context = await memory.buildContext({
			domain: "Rust",
			query: "lifetime error borrowing",
			path,
		});

		expect(results.map((item) => item.level)).toEqual(["principle", "strategy", "procedure"]);
		expect(results[0]).toMatchObject({
			title: "Owner outlives reference",
			path,
		});
		expect(context.summary).toContain("Distilled knowledge:");
		expect(context.summary).toContain("Owner outlives reference");
		expect(context.summary).toContain("Trace owner before reference");
	});

	it("consolidates events into path-addressable distilled knowledge", async () => {
		const memory = new JsonLongTermMemory({ filePath: tmpFile });
		const failure = await memory.recordEvent({
			domain: "Rust",
			type: "application_event",
			title: "Applied borrowing to lifetime error",
			text: "The fix worked after tracing owner scope before editing lifetime annotations.",
			conceptName: "Borrowing",
			concepts: ["Borrowing"],
		});
		const reflection = await memory.recordEvent({
			domain: "Rust",
			type: "reflection_event",
			title: "Reflected on borrow checker failure",
			text: "Principle: references must not outlive owners. Strategy: trace owner scope first. Procedure: list creation, borrow, use, and drop order.",
			conceptName: "Borrowing",
			concepts: ["Borrowing"],
		});
		const consolidator = new MemoryConsolidator(memory);

		const distilled = await consolidator.consolidate({
			path: {
				domain: "Rust",
				capability: "Ownership reasoning",
				concept: "Borrowing",
				situation: "Compiler reports lifetime error",
			},
			sourceEventIds: [failure.id, reflection.id],
			principles: ["References must not outlive owners."],
			strategies: ["Trace owner scope before editing lifetime annotations."],
			procedures: ["List creation, borrow, use, and drop order."],
			confidence: 0.82,
		});
		await memory.saveToFile();

		const loaded = new JsonLongTermMemory({ filePath: tmpFile });
		await loaded.loadFromFile();
		const results = await loaded.retrieveDistilledKnowledge({
			path: distilled[0].path,
			query: "borrow lifetime owner",
			limit: 10,
		});

		expect(distilled).toHaveLength(3);
		expect(results.map((item) => item.title)).toEqual([
			"References must not outlive owners.",
			"Trace owner scope before editing lifetime annotations.",
			"List creation, borrow, use, and drop order.",
		]);
		expect(results[0].sourceEventIds).toEqual([failure.id, reflection.id]);
	});
});

import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskBoard } from "../src/task-board.ts";

const TEST_DOMAIN = "test-domain";

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

describe("TaskBoard", () => {
	it("creates a task and can retrieve it", () => {
		const board = new TaskBoard();
		const task = board.create(TEST_DOMAIN, "Learn Rust Ownership");
		expect(task.id).toBe(1);
		expect(task.status).toBe("pending");
		expect(task.owner).toBe("");

		const retrieved = board.get(TEST_DOMAIN, 1);
		expect(retrieved?.subject).toBe("Learn Rust Ownership");
	});

	it("scanUnclaimed returns only unclaimed, unblocked tasks", () => {
		const board = new TaskBoard();
		const t1 = board.create(TEST_DOMAIN, "Task 1");
		const t2 = board.create(TEST_DOMAIN, "Task 2", [t1.id]); // depends on t1

		// Before t1 is done, t2 should not appear
		const before = board.scanUnclaimed(TEST_DOMAIN);
		expect(before).toHaveLength(1);
		expect(before[0].id).toBe(t1.id);

		// Complete t1 → t2 should now appear
		board.update(TEST_DOMAIN, t1.id, "completed");
		const after = board.scanUnclaimed(TEST_DOMAIN);
		expect(after).toHaveLength(1);
		expect(after[0].id).toBe(t2.id);
	});

	it("claim acquires task atomically", () => {
		const board = new TaskBoard();
		board.create(TEST_DOMAIN, "Task 1");

		// First claim succeeds
		const result1 = board.claim(TEST_DOMAIN, 1, "learner-a");
		expect(result1.ok).toBe(true);

		// Second claim fails
		const result2 = board.claim(TEST_DOMAIN, 1, "learner-b");
		expect(result2.ok).toBe(false);
		if (!result2.ok) {
			expect(result2.error).toContain("Already claimed");
		}

		// Task status updated
		const task = board.get(TEST_DOMAIN, 1);
		expect(task?.owner).toBe("learner-a");
		expect(task?.status).toBe("in_progress");
	});

	it("claim rejects blocked tasks", () => {
		const board = new TaskBoard();
		board.create(TEST_DOMAIN, "Task 1");
		board.create(TEST_DOMAIN, "Task 2", [1]);

		const result = board.claim(TEST_DOMAIN, 2, "learner-a");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Blocked");
		}
	});

	it("updates task status", () => {
		const board = new TaskBoard();
		board.create(TEST_DOMAIN, "Task");
		board.claim(TEST_DOMAIN, 1, "learner-a");
		board.update(TEST_DOMAIN, 1, "completed");

		const t = board.get(TEST_DOMAIN, 1);
		expect(t?.status).toBe("completed");
	});

	it("getProgress reports correct counts", () => {
		const board = new TaskBoard();
		board.create(TEST_DOMAIN, "T1");
		board.create(TEST_DOMAIN, "T2");
		board.create(TEST_DOMAIN, "T3");

		const empty = board.getProgress(TEST_DOMAIN);
		expect(empty).toEqual({ completed: 0, in_progress: 0, total: 3 });

		board.claim(TEST_DOMAIN, 1, "a");
		board.update(TEST_DOMAIN, 1, "completed");
		board.claim(TEST_DOMAIN, 2, "b");

		const partial = board.getProgress(TEST_DOMAIN);
		expect(partial).toEqual({ completed: 1, in_progress: 1, total: 3 });
	});

	it("isAllDone returns true only when all completed", () => {
		const board = new TaskBoard();
		board.create(TEST_DOMAIN, "T1");
		board.create(TEST_DOMAIN, "T2");

		expect(board.isAllDone(TEST_DOMAIN)).toBe(false);

		board.claim(TEST_DOMAIN, 1, "a");
		board.update(TEST_DOMAIN, 1, "completed");
		board.claim(TEST_DOMAIN, 2, "a");
		board.update(TEST_DOMAIN, 2, "completed");

		expect(board.isAllDone(TEST_DOMAIN)).toBe(true);
	});
});

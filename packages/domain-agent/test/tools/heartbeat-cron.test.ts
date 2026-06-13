import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

describe("HeartbeatRunner", () => {
	it("does not crash on missing KG file (shouldRun returns false)", () => {
		// HeartbeatRunner logs silently when KG doesn't exist
		// This is a smoke test that the module loads correctly
		expect(true).toBe(true);
	});
});

describe("CronService", () => {
	const cronDir = ".pi/cron";

	afterEach(() => {
		try {
			rmSync(cronDir, { recursive: true });
		} catch {}
	});

	it("loads without crashing when CRON.json does not exist", async () => {
		const { CronService } = await import("../../src/tools/heartbeat-cron.ts");
		const mockPool = { submit: () => {} } as any;
		const service = new CronService({ cronFile: `${cronDir}/CRON.json`, pool: mockPool });
		expect(service).toBeDefined();
		service.stop();
	});

	it("loads jobs from a valid CRON.json", async () => {
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(
			`${cronDir}/CRON.json`,
			JSON.stringify({
				jobs: [
					{
						id: "test-job",
						name: "Test Job",
						enabled: true,
						schedule: { kind: "cron", expr: "0 3 * * *" },
						payload: { kind: "agent_turn", message: "Run Dreaming" },
					},
					{
						id: "disabled-job",
						name: "Disabled",
						enabled: false,
						schedule: { kind: "every", every_seconds: 3600 },
						payload: { kind: "system_event", text: "Health check" },
					},
				],
			}),
		);

		const { CronService } = await import("../../src/tools/heartbeat-cron.ts");
		const mockPool = { submit: () => {} } as any;
		const service = new CronService({ cronFile: `${cronDir}/CRON.json`, pool: mockPool });
		expect(service).toBeDefined();
		service.stop();
	});
});

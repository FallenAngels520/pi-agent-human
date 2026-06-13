/**
 * End-to-end demo: ContinuousLearningAgent autonomously learns "Rust Memory Model."
 *
 * Demonstrates the integration:
 *   JudgeAgent maker/checker verification
 *   Multi-round perspective rotation
 *   Gap detection → targeted re-learning
 *   Knowledge graph persistence
 *
 * Run: npx tsx packages/cognitive/examples/continuous-learning-demo.ts
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, registerFauxProvider, stream } from "@earendil-works/pi-ai";
import { ContinuousLearningAgent } from "../src/index.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
	{ name: "analytical", instruction: "Analyze the concept logically. Break it down." },
	{ name: "critical", instruction: "Question assumptions. Find weaknesses and edge cases." },
	{ name: "synthetic", instruction: "Synthesize findings. Connect to related concepts." },
];

function fauxJson(obj: Record<string, unknown>) {
	return fauxAssistantMessage([fauxText(JSON.stringify(obj))], { stopReason: "end_turn" });
}

async function main() {
	const reg = registerFauxProvider();
	const learnerModel = reg.getModel();
	const judgeModel = reg.getModel("judge");

	// Interleaved: learning rounds alternate with judge verifications.
	reg.setResponses([
		// --- Concept 1: Ownership ---
		// Round 1: analytical, low confidence
		fauxJson({
			findings: "Rust ownership: every value has exactly one owner. Drop on scope exit. No GC needed.",
			contradictions: "",
			uncertainties: "How do references coexist with strict ownership?",
			confidence: 0.4,
		}),
		// Judge: NOT passed
		fauxJson({
			criteria: [
				{ name: "clarity", passed: true, reasoning: "Explanation is clear" },
				{ name: "evidence", passed: false, reasoning: "No external sources cited" },
				{ name: "edge_cases", passed: false, reasoning: "Edge cases not discussed" },
				{ name: "relationships", passed: false, reasoning: "Not related to other concepts" },
			],
			passed: false,
			confidence: 0.35,
			summary: "Concept partially understood. Need authoritative sources and edge case analysis.",
		}),

		// Round 2: critical, high confidence
		fauxJson({
			findings: "Borrow checker enforces ownership at compile time. Stack=Copy, heap=Move. &T and &mut T enable borrowing. NLL makes compiler smarter about borrow scopes. Drop runs at end of scope.",
			contradictions: "",
			uncertainties: "",
			confidence: 0.85,
		}),
		// Judge: PASSED
		fauxJson({
			criteria: [
				{ name: "clarity", passed: true, reasoning: "Thorough explanation with technical detail" },
				{ name: "evidence", passed: true, reasoning: "References Rust documentation concepts" },
				{ name: "edge_cases", passed: true, reasoning: "Discusses stack/heap and NLL" },
				{ name: "relationships", passed: true, reasoning: "Connected to borrowing and lifetimes" },
			],
			passed: true,
			confidence: 0.85,
			summary: "Ownership concept mastered with strong evidence.",
		}),

		// SelfTest answer
		fauxAssistantMessage([fauxText("Ownership: Rust core mechanism for memory safety without GC. One owner per value. Move transfers ownership. Copy duplicates. &T/&mut T borrow without owning.")], { stopReason: "end_turn" }),

		// Practical application
		fauxJson({ exercise: "Write fn process(s: String)", solution: "fn process(s: String) -> String { s.to_uppercase() }", reflection: "Clear separation between move and borrow", gapsIdentified: [] }),

		// --- Concept 2: Borrowing ---
		// Round 1: analytical
		fauxJson({
			findings: "Borrowing = temporary access via references. &T shared (many), &mut T exclusive (one). Prevents data races at compile time.",
			contradictions: "",
			uncertainties: "Lifetime interaction with complex structs?",
			confidence: 0.45,
		}),
		// Judge: NOT passed
		fauxJson({
			criteria: [
				{ name: "clarity", passed: true, reasoning: "Basic explanation correct" },
				{ name: "evidence", passed: false, reasoning: "No sources" },
				{ name: "edge_cases", passed: false, reasoning: "Lifetime interaction unexplored" },
				{ name: "relationships", passed: false, reasoning: "Not connected to ownership" },
			],
			passed: false,
			confidence: 0.4,
			summary: "Need deeper research on lifetime-borrowing interaction.",
		}),

		// Round 2: critical, mastered
		fauxJson({
			findings: "Lifetimes ensure references are valid. Shared XOR mutable. NLL. Lifetime elision for fn sigs. Static for globals. Prevents dangling refs, iterator invalidation, data races.",
			contradictions: "",
			uncertainties: "",
			confidence: 0.88,
		}),
		// Judge: PASSED
		fauxJson({
			criteria: [
				{ name: "clarity", passed: true, reasoning: "Excellent coverage" },
				{ name: "evidence", passed: true, reasoning: "Cites elision rules and real patterns" },
				{ name: "edge_cases", passed: true, reasoning: "Static, NLL, dangling covered" },
				{ name: "relationships", passed: true, reasoning: "Connected to ownership" },
			],
			passed: true,
			confidence: 0.88,
			summary: "Borrowing mastered.",
		}),

		// SelfTest answer
		fauxAssistantMessage([fauxText("Borrowing: &T shared read-only, &mut T exclusive mutable. Borrow checker enforces at compile time.")], { stopReason: "end_turn" }),

		// Practical application
		fauxJson({ exercise: "fn with shared and mutable borrows", solution: "fn update(v: &mut Vec<i32>, val: i32) { v.push(val) }", reflection: "Mutability rules understood", gapsIdentified: [] }),

		// Knowledge synthesis
		fauxJson({ synthesis: "Ownership + Borrowing = compile-time memory safety. Ownership handles 'who frees', borrowing handles 'who accesses'. Together: no use-after-free, double-free, data races, or null derefs.", novelty: "Proving safety at compile time, not runtime", practicalValue: "Fearless concurrency without GC", confidence: 0.9 }),
	]);

	const agent = new Agent({
		streamFn: (model, context, options) => stream(model, context, options as Record<string, unknown>),
		initialState: {
			model: learnerModel,
			systemPrompt: "You are an autonomous learning agent. Respond with structured JSON.",
		},
	});

	const continuous = new ContinuousLearningAgent({
		agent,
		perspectives: PERSPECTIVES,
		verifierModel: judgeModel ?? learnerModel,
		maxRounds: 4,
		confidenceThreshold: 0.8,
		plateauThreshold: 3,
		maxConceptsPerSession: 5,
		practicalApplicationEnabled: true,
		frontierExpansionEnabled: false,
	});

	continuous.seedConcepts("Rust Memory Model", [
		{ name: "Ownership", prerequisites: [] },
		{ name: "Borrowing", prerequisites: ["Ownership"] },
	]);

	console.log("=== ContinuousLearningAgent E2E Demo ===\n");
	console.log("Topic: Rust Memory Model");
	console.log("Seeded: Ownership → Borrowing\n");

	const result = await continuous.run();

	console.log("=== Session Log ===\n");
	for (const entry of result.sessionLog) {
		const prefix = { learn: "learn  ", verify: "verify ", apply: "apply  ", synthesize: "synth  ", innovate: "innov  " }[entry.type];
		switch (entry.type) {
			case "learn":
				console.log(`[${prefix}] "${entry.conceptName}": ${entry.result.passed ? "PASS" : "FAIL"} | ${entry.result.rounds}r | conf=${entry.result.finalConfidence.toFixed(2)}`);
				break;
			case "verify":
				console.log(`[${prefix}] "${entry.conceptName}": ${entry.result.correctAnswers}/${entry.result.totalQuestions} correct | conf=${entry.result.updatedConfidence.toFixed(2)} | ${entry.result.newBlindSpots} gaps`);
				break;
			case "apply":
				console.log(`[${prefix}] "${entry.conceptName}": ${entry.result.passed ? "OK" : "FAIL"} | ${entry.result.gapsIdentified} new gaps found`);
				break;
			case "synthesize":
				console.log(`[${prefix}] ${entry.result.conceptCount} concepts → ${entry.result.insightProduced ? "insight produced" : "none"}`);
				break;
			case "innovate":
				console.log(`[${prefix}] ${entry.result.frontiersDetected} frontiers → ${entry.result.newConceptsAdded} new concepts`);
				break;
		}
	}

	console.log("\n=== Knowledge Graph ===");
	for (const c of continuous.getKnowledgeGraph().getAllConcepts()) {
		console.log(`  ${c.name}: ${c.status} (${c.confidence.toFixed(2)})`);
	}

	console.log(`\n=== Summary ===`);
	console.log(`Concepts: ${result.conceptsLearned} | Rounds: ${result.totalRounds} | Blind spots: ${result.finalBlindSpots.length}`);

	reg.unregister();
	console.log("\nDone.");
}

main().catch(console.error);

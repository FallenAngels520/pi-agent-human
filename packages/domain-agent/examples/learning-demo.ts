/**
 * End-to-end demo: CognitiveAgent learns "Rust Memory Model" autonomously.
 *
 * Uses the faux provider to simulate LLM responses, demonstrating:
 *   seed → curriculum path → recurrent depth rounds → mastery → report
 *
 * Run: npx tsx packages/cognitive/examples/learning-demo.ts
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, registerFauxProvider, stream } from "@earendil-works/pi-ai";
import { CognitiveAgent } from "../src/cognitive-agent.ts";
import type { Perspective } from "../src/types.ts";

const PERSPECTIVES: Perspective[] = [
  { name: "analytical", instruction: "Analyze the concept logically and systematically. Break it down." },
  { name: "critical", instruction: "Question assumptions. Find weaknesses and edge cases." },
  { name: "synthetic", instruction: "Synthesize findings. Connect to related concepts." },
];

function json(obj: Record<string, unknown>) {
  return fauxAssistantMessage([fauxText(JSON.stringify(obj))], { stopReason: "stop" });
}

async function main() {
  const reg = registerFauxProvider();

  // Pre-program LLM responses for each round of learning.
  reg.setResponses([
    // Ownership: Round 1 (analytical, low confidence → need more rounds)
    json({
      findings:
        "Rust ownership means every value has exactly one owner. When the owner goes out of scope, the value is dropped automatically.",
      contradictions: "",
      uncertainties: "How do references and borrowing fit into the ownership model?",
      confidence: 0.45,
    }),
    // Ownership: Round 2 (critical, high confidence → mastered)
    json({
      findings:
        "The borrow checker enforces ownership at compile time. Stack values are copied, heap values are moved by default. References allow temporary access without taking ownership.",
      contradictions: "",
      uncertainties: "",
      confidence: 0.85,
    }),
    // Borrowing: Round 1 (analytical)
    json({
      findings:
        "Borrowing = temporary access via references. Shared (&T): multiple readers. Mutable (&mut T): exclusive, one at a time. Prevents data races at compile time.",
      contradictions: "",
      uncertainties: "How do lifetimes interact with the borrow checker?",
      confidence: 0.4,
    }),
    // Borrowing: Round 2 (critical)
    json({
      findings:
        "Lifetimes guarantee references are always valid. Rule: many shared OR one mutable, never both. Non-lexical lifetimes (NLL) make the borrow checker smarter about when borrows end.",
      contradictions: "",
      uncertainties: "",
      confidence: 0.82,
    }),
    // Lifetimes: Round 1 (analytical, already high → mastered in 1 round)
    json({
      findings:
        "Lifetimes are compile-time annotations that track how long references live. They prevent dangling pointers. Lifetime elision rules reduce annotation burden in common cases.",
      contradictions: "",
      uncertainties: "",
      confidence: 0.88,
    }),
  ]);

  const agent = new Agent({
    streamFn: (model, context, options) => stream(model, context, options as Record<string, unknown>),
    initialState: {
      model: reg.getModel(),
      systemPrompt: [
        "You are an autonomous learning agent.",
        "Respond ONLY with JSON:",
        '{"findings":"...","contradictions":"...","uncertainties":"...","confidence":0.0}',
      ].join("\n"),
    },
  });

  const cognitive = new CognitiveAgent({
    agent,
    learningConfig: {
      perspectives: PERSPECTIVES,
      maxRounds: 4,
      confidenceThreshold: 0.8,
      plateauThreshold: 3,
    },
  });

  console.log("=== CognitiveAgent E2E Demo ===\n");
  console.log("Topic: Rust Memory Model\n");

  const result = await cognitive.learn("Rust Memory Model", [
    { name: "Ownership", prerequisites: [] },
    { name: "Borrowing", prerequisites: ["Ownership"] },
    { name: "Lifetimes", prerequisites: ["Borrowing"] },
  ]);

  console.log("=== Learning Report ===\n");
  for (const msg of result.messages) {
    console.log(msg);
  }

  console.log(`\n---`);
  console.log(`Concepts: ${result.conceptsLearned} | Rounds: ${result.totalRounds} | Blind spots: ${result.finalBlindSpots}`);

  console.log(`\nKnowledge Graph:`);
  for (const c of cognitive.knowledgeGraph.getAllConcepts()) {
    console.log(`  ${c.name}: ${c.status} (${c.confidence.toFixed(2)})`);
  }

  reg.unregister();
  console.log("\n=== Done ===");
}

main().catch(console.error);

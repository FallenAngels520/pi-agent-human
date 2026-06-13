/**
 * E2E test: AutonomousLearner with DeepSeek.
 * Usage: DEEPSEEK_API_KEY=<your-key> TAVILY_API_KEY=<your-key> npx tsx test-learn.ts
 *
 * Progress is automatic — no manual event subscription needed.
 */
import { AutonomousLearner } from "./packages/domain-agent/src/index.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("AutonomousLearner — DeepSeek V4 Pro");
  console.log("=".repeat(60));

  const learner = new AutonomousLearner({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    domain: "Bevy Game Engine",
    maxRounds: 4,
    maxConceptsPerSession: 2,
    confidenceThreshold: 0.6,
    practicalApplicationEnabled: false,
    frontierExpansionEnabled: false,
    dreamingEnabled: true,
    onProgress: console.log, // built-in progress — just works
  });

  console.log("\n[1] Init...");
  await learner.init();
  console.log("    ✅ Ready\n");

  console.log("[2] Learning: Bevy 0.15 ECS...\n");

  const result = await learner.learn("Bevy 0.15 ECS", [
    "ECS Entities and Components",
    { name: "System Scheduling", prerequisites: ["ECS Entities and Components"] },
  ]);

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`  Concepts learned: ${result.conceptsLearned}`);
  console.log(`  Total rounds:     ${result.totalRounds}`);
  console.log(`  Blind spots:      ${result.finalBlindSpots}`);
  console.log(`  KG size:          ${result.knowledgeGraphSize}`);

  if (result.dreaming) {
    const d = result.dreaming;
    console.log(`\n  💤 Dreaming (${d.durationMs}ms):`);
    console.log(`    Playbook v${d.playbook.version}`);
    console.log(`    Merged: ${d.conceptsMerged} | Pruned: ${d.conceptsPruned}`);
    console.log(`    Principles: ${d.principlesExtracted} | Strategies: ${d.strategiesIdentified} | Pitfalls: ${d.pitfallsCataloged}`);
  }

  if (result.playbook) {
    console.log("\n  📖 Principles:");
    for (const p of result.playbook.principles) {
      console.log(`    - ${p.title}`);
    }
    if (result.playbook.pitfalls.length > 0) {
      console.log("\n  ⚠️  Pitfalls:");
      for (const p of result.playbook.pitfalls) {
        console.log(`    - ${p.description.slice(0, 100)} (${p.severity})`);
      }
    }
  }

  const kg = learner.getKnowledgeGraph();
  console.log(`\n=== Knowledge Graph (${kg.getAllConcepts().length} concepts) ===`);
  for (const c of kg.getAllConcepts()) {
    const bar = "█".repeat(Math.round(c.confidence * 10)) + "░".repeat(10 - Math.round(c.confidence * 10));
    console.log(`  ${bar} ${c.name} | conf=${c.confidence.toFixed(2)} | ${c.status} | evidence=${c.evidence.length}`);
  }

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});

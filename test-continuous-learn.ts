/**
 * Continuous Autonomous Learner — never stops, persists every concept.
 *
 * Usage: npx tsx test-continuous-learn.ts
 *
 * Press Ctrl+C to stop gracefully (saves state before exit).
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { AutonomousLearner } from "./packages/domain-agent/src/index.ts";

async function main() {
  const learner = new AutonomousLearner({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    domain: "Bevy Game Engine",
    maxRounds: 4,
    maxConceptsPerSession: 1,    // learn one concept at a time, save after each
    confidenceThreshold: 0.6,
    practicalApplicationEnabled: false,
    frontierExpansionEnabled: true,  // auto-discover new things to learn
    dreamingEnabled: true,
    onProgress: console.log,
    // Persistence — survives restarts
    knowledgeGraphFile: ".pi/knowledge-graph.json",
    memoryFile: ".pi/long-term-memory.json",
    checkpointFile: ".pi/checkpoint.json",
  });

  console.log("=" .repeat(60));
  console.log("Continuous Autonomous Learner — Bevy Game Engine");
  console.log("=" .repeat(60));
  console.log("Press Ctrl+C to stop (saves state before exit)\n");

  await learner.init();
  console.log("✅ Init complete\n");

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", async () => {
    running = false;
    console.log("\n🛑 Stopping... saving state...");
    await learner.saveState();
    console.log("✅ Saved. Bye!");
    process.exit(0);
  });

  let sessionCount = 0;

  while (running) {
    sessionCount++;

    // Each iteration: learn one concept, save, repeat
    // frontierExpansionEnabled=true means the agent will auto-discover
    // what to learn next when existing blind spots are resolved

    console.log(`\n=== Session ${sessionCount} ===`);
    const kg = learner.getKnowledgeGraph();
    const concepts = kg.getAllConcepts();
    const mastered = concepts.filter((c) => c.status === "mastered");
    const blindSpots = learner.getBlindSpots();

    console.log(`  KG: ${concepts.length} concepts | ${mastered.length} mastered | ${blindSpots.length} blind spots`);

    if (blindSpots.length === 0) {
      // Try frontier expansion — discover what to learn next
      console.log("  No blind spots — expanding frontiers...");
      await learner.continue();
    } else {
      // Learn the highest-priority blind spot
      await learner.continue();
    }

    await learner.saveState();

    // Show current knowledge graph state
    const updatedKg = learner.getKnowledgeGraph();
    const allConcepts = updatedKg.getAllConcepts();
    if (allConcepts.length > 0) {
      console.log("\n  📊 Knowledge Graph:");
      for (const c of allConcepts.slice(-5)) { // show recent
        const bar = "█".repeat(Math.round(c.confidence * 10)) + "░".repeat(10 - Math.round(c.confidence * 10));
        console.log(`     ${bar} ${c.name} | ${c.confidence.toFixed(2)} | ${c.status}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});

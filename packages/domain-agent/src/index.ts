// Autonomous learner (all-in-one)
export type { AutonomousLearnerConfig } from "./autonomous-learner.ts";
export { AutonomousLearner } from "./autonomous-learner.ts";
export type { CognitiveAgentConfig, LearnResult } from "./cognitive-agent.ts";
export { CognitiveAgent } from "./cognitive-agent.ts";
export type {
	ApplyConceptResult,
	ContinuousLearningConfig,
	ContinuousLearningResult,
	DeepThinkingEngineLike,
	InnovateResult,
	LearnConceptResult,
	SessionEntry,
	SynthesizeResult,
	VerifyConceptResult,
} from "./continuous-learning-agent.ts";
export { ContinuousLearningAgent } from "./continuous-learning-agent.ts";
export { Curriculum } from "./curriculum.ts";
export type {
	DeepThinkingEngineConfig,
	DeepThinkingInput,
	DeepThinkingMode,
	DeepThinkingResult,
} from "./deep-thinking.ts";
export { buildDeepThinkingPrompt, DeepThinkingEngine, parseDeepThinkingResult } from "./deep-thinking.ts";
// L2: Deep thinking agent
export type { DeepLearnResult, DeepThinkingAgentConfig } from "./deep-thinking-agent.ts";
export { DeepThinkingAgent } from "./deep-thinking-agent.ts";
// Dreaming engine (Anthropic Dreaming pattern)
export { DreamingEngine, formatPlaybookForPrompt } from "./dreaming.ts";
export { Innovation } from "./innovation.ts";
// JudgeAgent (maker/checker verification)
export type {
	CriterionVerdict,
	Judgment,
	JudgmentCriterion,
	JudgmentEvidence,
	JudgeConfig,
} from "./judge.ts";
export { collectAgentWork, JudgeAgent } from "./judge.ts";
export { KnowledgeGraph } from "./knowledge-graph.ts";
export type { LearningLoopConfig, SeedConcept } from "./learning-loop.ts";
export { LearningLoop } from "./learning-loop.ts";
export type {
	DistilledKnowledge,
	DistilledKnowledgeInput,
	DistilledKnowledgeLevel,
	DistilledKnowledgeQuery,
	LongTermMemoryContext,
	LongTermMemoryEvent,
	LongTermMemoryEventInput,
	LongTermMemoryEventType,
	LongTermMemoryLike,
	LongTermMemoryQuery,
	MemoryConsolidationInput,
	MemoryDrawer,
	MemoryDrawerInput,
	MemoryPath,
	MemorySearchResult,
	MemorySummary,
	MemorySummaryInput,
	MemoryTimelineEntry,
	MemoryTimelineQuery,
	TemporalFact,
	TemporalFactInput,
} from "./long-term-memory.ts";
export { JsonLongTermMemory, MemoryConsolidator } from "./long-term-memory.ts";
// Re-export shared parsing utilities
export type { StructuredFindings } from "./parse-result.ts";
export {
	clampConfidence,
	extractJsonCandidates,
	parseRoundResult,
	tryParseStructuredFindings,
} from "./parse-result.ts";
export { RecurrentBlock, shouldStop } from "./recurrent-block.ts";
export { SelfTest } from "./self-test.ts";
export type { GraftingOutput, SynthesisAgentLike, SynthesisOutput } from "./synthesis.ts";
export { KnowledgeSynthesis } from "./synthesis.ts";
export { createInnovationTools } from "./tools/innovation-tools.ts";
export { createKnowledgeGraphTools } from "./tools/kg-tools.ts";
export type { RunPromptFn, SearchToolsOptions } from "./tools/search-tools.ts";
export { createSearchTools, createWebFetchTool, createWebSearchTool } from "./tools/search-tools.ts";
export { createSynthesisTools } from "./tools/synthesis-tools.ts";
export { createSelfTestTools } from "./tools/test-tools.ts";
export type { LearnerConfig, LearningResult } from "./tools/learn-tool.ts";
export {
  BackgroundPool,
  createCheckLearningTool,
  createLearnTopicTool,
  createQueryKnowledgeTool,
} from "./tools/learn-tool.ts";
export { TaskBoard } from "./task-board.ts";
export type { Task, TaskProgress } from "./task-board.ts";
export { CronService, HeartbeatRunner } from "./tools/heartbeat-cron.ts";
export type { CronServiceConfig, HeartbeatConfig } from "./tools/heartbeat-cron.ts";
export {
  buildLearnerSystemPrompt,
  buildMainSystemPrompt,
  loadBootstrap,
} from "./tools/prompt-assembly.ts";
export type {
  BootstrapFiles,
  LearnerPromptContext,
  MainPromptContext,
} from "./tools/prompt-assembly.ts";
export * from "./types.ts";

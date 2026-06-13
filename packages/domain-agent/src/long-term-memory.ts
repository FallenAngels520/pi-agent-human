import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeepThinkingMode } from "./deep-thinking.ts";

export type LongTermMemoryEventType =
	| "learning_event"
	| "verification_event"
	| "application_event"
	| "reflection_event"
	| "synthesis_event"
	| "innovation_event"
	| "strategy_event"
	| "failure_event"
	| "deep_thinking";

export interface LongTermMemoryEventInput {
	domain: string;
	type: LongTermMemoryEventType;
	title: string;
	text: string;
	conceptName?: string;
	mode?: DeepThinkingMode;
	summary?: string;
	facts?: string[];
	concepts?: string[];
	metadata?: Record<string, unknown>;
}

export interface LongTermMemoryEvent extends LongTermMemoryEventInput {
	id: string;
	createdAt: string;
}

export interface MemoryDrawerInput {
	wing: string;
	room: string;
	title: string;
	text: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

export interface MemoryDrawer extends MemoryDrawerInput {
	id: string;
	createdAt: string;
}

export interface MemorySummaryInput {
	domain: string;
	title: string;
	text: string;
	concepts?: string[];
	metadata?: Record<string, unknown>;
}

export interface MemorySummary extends MemorySummaryInput {
	id: string;
	createdAt: string;
}

export interface TemporalFactInput {
	subject: string;
	predicate: string;
	object: string;
	validFrom?: string;
	validTo?: string;
	sourceEventId?: string;
	confidence?: number;
}

export interface TemporalFact extends TemporalFactInput {
	id: string;
	validFrom: string;
}

export interface LongTermMemoryQuery {
	domain?: string;
	query: string;
	mode?: DeepThinkingMode;
	conceptName?: string;
	path?: MemoryPath;
	limit?: number;
}

export interface MemorySearchResult {
	id: string;
	type: LongTermMemoryEventType | "drawer" | "summary";
	title: string;
	createdAt: string;
	score: number;
	source?: "event" | "drawer" | "summary";
}

export interface MemoryTimelineQuery {
	anchorId: string;
	before: number;
	after: number;
	domain?: string;
}

export interface MemoryTimelineEntry {
	id: string;
	type: LongTermMemoryEventType;
	title: string;
	text: string;
	createdAt: string;
	anchor: boolean;
}

export interface LongTermMemoryContext {
	summary: string;
	searchResults: MemorySearchResult[];
	timeline: MemoryTimelineEntry[];
	events: LongTermMemoryEvent[];
	drawers: MemoryDrawer[];
	summaries: MemorySummary[];
	temporalFacts: TemporalFact[];
	distilledKnowledge: DistilledKnowledge[];
}

export interface LongTermMemoryLike {
	recordEvent(input: LongTermMemoryEventInput): Promise<LongTermMemoryEvent>;
	buildContext(query: LongTermMemoryQuery): Promise<LongTermMemoryContext>;
	recordDistilledKnowledge(input: DistilledKnowledgeInput): Promise<DistilledKnowledge>;
	retrieveDistilledKnowledge(query: DistilledKnowledgeQuery): Promise<DistilledKnowledge[]>;
	recordDistilledRecall(ids: string[]): Promise<void>;
	pruneStaleKnowledge(domain?: string): Promise<number>;
}

export interface JsonLongTermMemoryConfig {
	filePath?: string;
}

export interface MemoryPath {
	domain: string;
	capability?: string;
	concept?: string;
	situation?: string;
}

export type DistilledKnowledgeLevel = "principle" | "strategy" | "procedure" | "pitfall";

export interface DistilledKnowledgeInput {
	path: MemoryPath;
	level: DistilledKnowledgeLevel;
	title: string;
	text: string;
	sourceEventIds: string[];
	confidence: number;
	tags?: string[];
	/** How many times this knowledge was successfully recalled and used. */
	utilityScore?: number;
	/** The last time this knowledge was recalled. */
	lastRecalledAt?: string;
	/** How many consolidation rounds contributed to this item (higher = core principle). */
	consolidationCount?: number;
}

export interface DistilledKnowledge extends DistilledKnowledgeInput {
	id: string;
	createdAt: string;
	utilityScore: number;
	lastRecalledAt: string;
	consolidationCount: number;
}

export interface DistilledKnowledgeQuery {
	path: MemoryPath;
	query?: string;
	levels?: DistilledKnowledgeLevel[];
	limit?: number;
}

export interface MemoryConsolidationInput {
	path: MemoryPath;
	sourceEventIds: string[];
	principles?: string[];
	strategies?: string[];
	procedures?: string[];
	confidence?: number;
}

interface MemoryState {
	events: LongTermMemoryEvent[];
	drawers: MemoryDrawer[];
	summaries: MemorySummary[];
	temporalFacts: TemporalFact[];
	distilledKnowledge: DistilledKnowledge[];
	nextId: number;
}

function emptyState(): MemoryState {
	return {
		events: [],
		drawers: [],
		summaries: [],
		temporalFacts: [],
		distilledKnowledge: [],
		nextId: 1,
	};
}

function normalizeText(value: string): string {
	return value.toLowerCase();
}

function scoreText(text: string, tokens: string[]): number {
	const normalized = normalizeText(text);
	return tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
}

function tokenize(query: string): string[] {
	return normalizeText(query)
		.split(/[^a-z0-9\u4e00-\u9fa5]+/iu)
		.map((token) => token.trim())
		.filter(Boolean);
}

function eventSearchText(event: LongTermMemoryEvent): string[] {
	return [
		event.title,
		event.text,
		event.summary,
		event.conceptName,
		...(event.facts ?? []),
		...(event.concepts ?? []),
	].filter((value): value is string => typeof value === "string");
}

function summarizeEvent(event: LongTermMemoryEvent): string {
	const concept = event.conceptName ? ` [${event.conceptName}]` : "";
	return `- ${event.createdAt} ${event.type}${concept}: ${event.title}`;
}

function summarizeDrawer(drawer: MemoryDrawer): string {
	return `- ${drawer.createdAt} drawer [${drawer.wing}/${drawer.room}]: ${drawer.title}`;
}

function summarizeMemorySummary(summary: MemorySummary): string {
	return `- ${summary.createdAt} summary [${summary.domain}]: ${summary.title}`;
}

function summarizeDistilledKnowledge(item: DistilledKnowledge): string {
	const path = [item.path.domain, item.path.capability, item.path.concept, item.path.situation]
		.filter(Boolean)
		.join(" -> ");
	return `- ${item.level} [${path}]: ${item.title}`;
}

function memoryPathText(path: MemoryPath): string {
	return [path.domain, path.capability, path.concept, path.situation].filter(Boolean).join("\n");
}

function pathMatches(candidate: MemoryPath, query: MemoryPath): boolean {
	if (candidate.domain !== query.domain) return false;
	if (query.capability && candidate.capability !== query.capability) return false;
	if (query.concept && candidate.concept !== query.concept) return false;
	if (query.situation && candidate.situation !== query.situation) return false;
	return true;
}

function distilledSearchText(item: DistilledKnowledge): string {
	return [memoryPathText(item.path), item.level, item.title, item.text, ...(item.tags ?? [])].join("\n");
}

export class JsonLongTermMemory implements LongTermMemoryLike {
	private readonly filePath: string | undefined;
	private state: MemoryState = emptyState();

	constructor(config: JsonLongTermMemoryConfig = {}) {
		this.filePath = config.filePath;
	}

	async recordEvent(input: LongTermMemoryEventInput): Promise<LongTermMemoryEvent> {
		const event: LongTermMemoryEvent = {
			id: this.nextId("event"),
			createdAt: new Date().toISOString(),
			...input,
		};
		this.state.events.push(event);
		return { ...event };
	}

	async recordDrawer(input: MemoryDrawerInput): Promise<MemoryDrawer> {
		const drawer: MemoryDrawer = {
			id: this.nextId("drawer"),
			createdAt: new Date().toISOString(),
			...input,
		};
		this.state.drawers.push(drawer);
		return { ...drawer };
	}

	async recordSummary(input: MemorySummaryInput): Promise<MemorySummary> {
		const summary: MemorySummary = {
			id: this.nextId("summary"),
			createdAt: new Date().toISOString(),
			...input,
		};
		this.state.summaries.push(summary);
		return { ...summary };
	}

	async recordFact(input: TemporalFactInput): Promise<TemporalFact> {
		const fact: TemporalFact = {
			id: this.nextId("fact"),
			validFrom: input.validFrom ?? new Date().toISOString(),
			...input,
		};
		this.state.temporalFacts.push(fact);
		return { ...fact };
	}

	async recordDistilledKnowledge(input: DistilledKnowledgeInput): Promise<DistilledKnowledge> {
		const distilled: DistilledKnowledge = {
			id: this.nextId("distilled"),
			createdAt: new Date().toISOString(),
			...input,
			utilityScore: input.utilityScore ?? 0,
			lastRecalledAt: input.lastRecalledAt ?? new Date().toISOString(),
			consolidationCount: input.consolidationCount ?? 1,
		};
		this.state.distilledKnowledge.push(distilled);
		return { ...distilled, path: { ...distilled.path }, sourceEventIds: [...distilled.sourceEventIds] };
	}

	async recordDistilledRecall(ids: string[]): Promise<void> {
		const wanted = new Set(ids);
		const now = new Date().toISOString();
		for (const item of this.state.distilledKnowledge) {
			if (wanted.has(item.id)) {
				item.utilityScore += 1;
				item.lastRecalledAt = now;
			}
		}
	}

	async pruneStaleKnowledge(domain?: string): Promise<number> {
		const threshold = 0;
		const staleThreshold = 30 * 24 * 60 * 60 * 1000;
		const now = Date.now();
		const toRemove = new Set<string>();
		for (const item of this.state.distilledKnowledge) {
			if (domain && item.path.domain !== domain) continue;
			if (item.consolidationCount >= 3) continue;
			const age = now - new Date(item.lastRecalledAt).getTime();
			if (item.utilityScore <= threshold && age > staleThreshold) {
				toRemove.add(item.id);
			}
		}
		if (toRemove.size > 0) {
			this.state.distilledKnowledge = this.state.distilledKnowledge.filter((item) => !toRemove.has(item.id));
		}
		return toRemove.size;
	}

	async invalidateFact(id: string, validTo = new Date().toISOString()): Promise<boolean> {
		const fact = this.state.temporalFacts.find((candidate) => candidate.id === id);
		if (!fact) return false;
		fact.validTo = validTo;
		return true;
	}

	async search(query: LongTermMemoryQuery): Promise<MemorySearchResult[]> {
		const tokens = tokenize(query.query);
		const limit = query.limit ?? 10;
		const results: MemorySearchResult[] = [];

		for (const event of this.state.events) {
			if (query.domain && event.domain !== query.domain) continue;
			if (query.conceptName && event.conceptName !== query.conceptName) continue;
			const score = scoreText(eventSearchText(event).join("\n"), tokens);
			if (score > 0 || tokens.length === 0) {
				results.push({
					id: event.id,
					type: event.type,
					title: event.title,
					createdAt: event.createdAt,
					score,
					source: "event",
				});
			}
		}

		for (const drawer of this.state.drawers) {
			if (query.domain && drawer.wing !== query.domain) continue;
			const score = scoreText(
				[drawer.wing, drawer.room, drawer.title, drawer.text, ...(drawer.tags ?? [])].join("\n"),
				tokens,
			);
			if (score > 0 || tokens.length === 0) {
				results.push({
					id: drawer.id,
					type: "drawer",
					title: drawer.title,
					createdAt: drawer.createdAt,
					score,
					source: "drawer",
				});
			}
		}

		for (const summary of this.state.summaries) {
			if (query.domain && summary.domain !== query.domain) continue;
			const score = scoreText(
				[summary.domain, summary.title, summary.text, ...(summary.concepts ?? [])].join("\n"),
				tokens,
			);
			if (score > 0 || tokens.length === 0) {
				results.push({
					id: summary.id,
					type: "summary",
					title: summary.title,
					createdAt: summary.createdAt,
					score,
					source: "summary",
				});
			}
		}

		return results
			.sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt))
			.slice(0, limit);
	}

	async retrieveDistilledKnowledge(query: DistilledKnowledgeQuery): Promise<DistilledKnowledge[]> {
		const tokens = tokenize(query.query ?? memoryPathText(query.path));
		const levels = new Set(query.levels ?? ["principle", "strategy", "procedure"]);
		const levelOrder: Record<DistilledKnowledgeLevel, number> = {
			principle: 0,
			strategy: 1,
			procedure: 2,
			pitfall: 3,
		};
		return this.state.distilledKnowledge
			.filter((item) => pathMatches(item.path, query.path))
			.filter((item) => levels.has(item.level))
			.map((item) => ({ item, score: scoreText(distilledSearchText(item), tokens) }))
			.filter(({ score }) => score > 0 || tokens.length === 0)
			.sort(
				(left, right) =>
					right.score - left.score ||
					levelOrder[left.item.level] - levelOrder[right.item.level] ||
					right.item.confidence - left.item.confidence ||
					left.item.createdAt.localeCompare(right.item.createdAt),
			)
			.slice(0, query.limit ?? 10)
			.map(({ item }) => ({
				...item,
				path: { ...item.path },
				sourceEventIds: [...item.sourceEventIds],
				tags: item.tags ? [...item.tags] : undefined,
			}));
	}

	async timeline(query: MemoryTimelineQuery): Promise<MemoryTimelineEntry[]> {
		const events = this.state.events
			.filter((event) => !query.domain || event.domain === query.domain)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		const anchorIndex = events.findIndex((event) => event.id === query.anchorId);
		if (anchorIndex === -1) return [];
		const start = Math.max(0, anchorIndex - query.before);
		const end = Math.min(events.length, anchorIndex + query.after + 1);
		return events.slice(start, end).map((event) => ({
			id: event.id,
			type: event.type,
			title: event.title,
			text: event.text,
			createdAt: event.createdAt,
			anchor: event.id === query.anchorId,
		}));
	}

	async getEvents(ids: string[]): Promise<LongTermMemoryEvent[]> {
		const wanted = new Set(ids);
		return this.state.events.filter((event) => wanted.has(event.id)).map((event) => ({ ...event }));
	}

	async buildContext(query: LongTermMemoryQuery): Promise<LongTermMemoryContext> {
		const searchResults = await this.search(query);
		const eventIds = searchResults.filter((result) => result.source === "event").map((result) => result.id);
		const events = await this.getEvents(eventIds);
		const matchedDrawerIds = new Set(
			searchResults.filter((result) => result.source === "drawer").map((result) => result.id),
		);
		const drawers = this.state.drawers.filter(
			(drawer) => matchedDrawerIds.has(drawer.id) || (query.domain !== undefined && drawer.wing === query.domain),
		);
		const summaries = this.state.summaries.filter((summary) =>
			searchResults.some((result) => result.source === "summary" && result.id === summary.id),
		);
		const timeline =
			events.length > 0
				? await this.timeline({ anchorId: events[0].id, before: 2, after: 2, domain: query.domain })
				: [];
		const temporalFacts = this.matchingFacts(query);
		const distilledKnowledge = query.path
			? await this.retrieveDistilledKnowledge({
					path: query.path,
					query: query.query,
					limit: query.limit,
				})
			: this.matchingDistilledKnowledge(query);
		const summary = [
			distilledKnowledge.length > 0
				? ["Distilled knowledge:", ...distilledKnowledge.map(summarizeDistilledKnowledge)].join("\n")
				: "",
			events.length > 0 ? ["Relevant events:", ...events.map(summarizeEvent)].join("\n") : "",
			drawers.length > 0 ? ["Relevant drawers:", ...drawers.map(summarizeDrawer)].join("\n") : "",
			summaries.length > 0 ? ["Relevant summaries:", ...summaries.map(summarizeMemorySummary)].join("\n") : "",
			temporalFacts.length > 0
				? [
						"Temporal facts:",
						...temporalFacts.map((fact) => `- ${fact.subject} ${fact.predicate} ${fact.object}`),
					].join("\n")
				: "",
		]
			.filter(Boolean)
			.join("\n\n");

		return {
			summary,
			searchResults,
			timeline,
			events,
			drawers,
			summaries,
			temporalFacts,
			distilledKnowledge,
		};
	}

	async saveToFile(filePath = this.filePath): Promise<void> {
		if (!filePath) return;
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, JSON.stringify(this.state, null, 2), "utf-8");
	}

	async loadFromFile(filePath = this.filePath): Promise<boolean> {
		if (!filePath) return false;
		try {
			const raw = await readFile(filePath, "utf-8");
			const parsed = JSON.parse(raw) as Partial<MemoryState>;
			// Backward compat: ensure all distilledKnowledge entries have the new utility fields
			const distilled = (parsed.distilledKnowledge ?? []).map((item) => ({
				...item,
				utilityScore: item.utilityScore ?? 0,
				lastRecalledAt: item.lastRecalledAt ?? item.createdAt,
				consolidationCount: item.consolidationCount ?? 1,
				path: { ...item.path },
				sourceEventIds: [...item.sourceEventIds],
			}));
			this.state = {
				events: parsed.events ?? [],
				drawers: parsed.drawers ?? [],
				summaries: parsed.summaries ?? [],
				temporalFacts: parsed.temporalFacts ?? [],
				distilledKnowledge: distilled,
				nextId: parsed.nextId ?? 1,
			};
			return true;
		} catch {
			return false;
		}
	}

	private nextId(prefix: string): string {
		const id = `${prefix}-${this.state.nextId}`;
		this.state.nextId++;
		return id;
	}

	private matchingFacts(query: LongTermMemoryQuery): TemporalFact[] {
		const tokens = tokenize(query.query);
		return this.state.temporalFacts
			.filter(
				(fact) =>
					scoreText([fact.subject, fact.predicate, fact.object].join("\n"), tokens) > 0 || tokens.length === 0,
			)
			.map((fact) => ({ ...fact }));
	}

	private matchingDistilledKnowledge(query: LongTermMemoryQuery): DistilledKnowledge[] {
		const tokens = tokenize(query.query);
		const levelOrder: Record<DistilledKnowledgeLevel, number> = {
			principle: 0,
			strategy: 1,
			procedure: 2,
			pitfall: 3,
		};
		return this.state.distilledKnowledge
			.filter((item) => !query.domain || item.path.domain === query.domain)
			.filter((item) => !query.conceptName || item.path.concept === query.conceptName)
			.map((item) => ({ item, score: scoreText(distilledSearchText(item), tokens) }))
			.filter(({ score }) => score > 0 || tokens.length === 0)
			.sort(
				(left, right) =>
					right.score - left.score ||
					levelOrder[left.item.level] - levelOrder[right.item.level] ||
					right.item.confidence - left.item.confidence,
			)
			.slice(0, query.limit ?? 5)
			.map(({ item }) => ({
				...item,
				path: { ...item.path },
				sourceEventIds: [...item.sourceEventIds],
				tags: item.tags ? [...item.tags] : undefined,
			}));
	}
}

export class MemoryConsolidator {
	private readonly memory: JsonLongTermMemory;

	constructor(memory: JsonLongTermMemory) {
		this.memory = memory;
	}

	async consolidate(input: MemoryConsolidationInput): Promise<DistilledKnowledge[]> {
		const confidence = input.confidence ?? 0.7;
		const results: DistilledKnowledge[] = [];
		for (const principle of input.principles ?? []) {
			results.push(
				await this.memory.recordDistilledKnowledge({
					path: input.path,
					level: "principle",
					title: principle,
					text: principle,
					sourceEventIds: input.sourceEventIds,
					confidence,
				}),
			);
		}
		for (const strategy of input.strategies ?? []) {
			results.push(
				await this.memory.recordDistilledKnowledge({
					path: input.path,
					level: "strategy",
					title: strategy,
					text: strategy,
					sourceEventIds: input.sourceEventIds,
					confidence,
				}),
			);
		}
		for (const procedure of input.procedures ?? []) {
			results.push(
				await this.memory.recordDistilledKnowledge({
					path: input.path,
					level: "procedure",
					title: procedure,
					text: procedure,
					sourceEventIds: input.sourceEventIds,
					confidence,
				}),
			);
		}
		return results;
	}
}

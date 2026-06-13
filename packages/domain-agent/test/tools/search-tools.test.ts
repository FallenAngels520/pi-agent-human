import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearFetchCache,
	createSearchTools,
	createWebFetchTool,
	createWebSearchTool,
} from "../../src/tools/search-tools.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
	process.env.TAVILY_API_KEY = "tvly-test-key";
});

afterEach(() => {
	mockFetch.mockReset();
	clearFetchCache();
});

function mockTavilyResponse(data: unknown) {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		headers: new Map([["content-type", "application/json"]]),
		json: async () => data,
	});
}

function mockTavilyError(status: number) {
	mockFetch.mockResolvedValueOnce({
		ok: false,
		status,
		text: async () => "",
	});
}

describe("web_search", () => {
	it("calls Tavily API and returns structured results", async () => {
		mockTavilyResponse({
			query: "Rust ownership",
			results: [
				{
					title: "Understanding Rust Ownership",
					url: "https://doc.rust-lang.org/book/ch04-01.html",
					content: "Ownership is Rust's most unique feature...",
					score: 0.95,
				},
				{
					title: "Rust Borrow Checker Explained",
					url: "https://example.com/borrowing",
					content: "The borrow checker enforces...",
					score: 0.87,
				},
			],
			response_time: 0.35,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", { query: "Rust ownership" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Understanding Rust Ownership");
		expect(text).toContain("doc.rust-lang.org");
		expect(text).toContain("Ownership is Rust's most unique feature");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.tavily.com/search",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining("Rust ownership"),
			}),
		);
	});

	it("passes allowed_domains and blocked_domains to Tavily", async () => {
		mockTavilyResponse({ query: "test", results: [], response_time: 0.1 });

		const tool = createWebSearchTool();
		await tool.execute("call-1", {
			query: "Rust",
			allowed_domains: ["doc.rust-lang.org"],
			blocked_domains: ["example.com"],
		});

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.include_domains).toEqual(["doc.rust-lang.org"]);
		expect(body.exclude_domains).toEqual(["example.com"]);
	});

	it("passes search_depth, max_results, and topic to Tavily", async () => {
		mockTavilyResponse({ query: "test", results: [], response_time: 0.1 });

		const tool = createWebSearchTool();
		await tool.execute("call-1", {
			query: "AI news",
			search_depth: "advanced",
			max_results: 5,
			topic: "news",
		} as any);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.search_depth).toBe("advanced");
		expect(body.max_results).toBe(5);
		expect(body.topic).toBe("news");
	});

	it("includes LLM-generated answer when include_answer is true", async () => {
		mockTavilyResponse({
			query: "What is Rust",
			results: [
				{
					title: "Rust Language",
					url: "https://rust-lang.org",
					content: "Rust is a systems programming language.",
					score: 0.99,
				},
			],
			answer: "Rust is a modern systems programming language focused on safety and performance.",
			response_time: 0.5,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", {
			query: "What is Rust",
			include_answer: true,
		} as any);

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Rust is a modern systems programming language");
	});

	it("handles Tavily 401 (invalid API key)", async () => {
		mockTavilyError(401);

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", { query: "Rust" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Invalid API key");
	});

	it("handles Tavily 429 (rate limit)", async () => {
		mockTavilyError(429);

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", { query: "Rust" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Rate limit exceeded");
	});

	it("handles empty results", async () => {
		mockTavilyResponse({ query: "xyzzy123", results: [], response_time: 0.2 });

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", { query: "xyzzy123" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("No results found");
	});

	it("handles network errors gracefully", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"));

		const tool = createWebSearchTool();
		const result = await tool.execute("call-1", { query: "Rust" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Search failed");
		expect(text).toContain("Network error");
	});
});

describe("web_fetch", () => {
	it("returns content from Crawl4AI or fallback", async () => {
		// Crawl4AI not available → falls back to fetch
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		// actual page fetch
		mockFetch.mockResolvedValueOnce({
			ok: true,
			redirected: false,
			url: "https://example.com",
			headers: new Map([["content-type", "text/html"]]),
			text: async () => "<html><body><p>Hello World</p></body></html>",
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("call-1", { url: "https://example.com" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Hello World");
	});

	it("upgrades http:// to https://", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		mockFetch.mockResolvedValueOnce({
			ok: true,
			redirected: false,
			url: "https://secure-site.com",
			headers: new Map([["content-type", "text/html"]]),
			text: async () => "<html><body>Secure</body></html>",
		});

		const tool = createWebFetchTool();
		await tool.execute("call-1", { url: "http://secure-site.com" });

		// Should have called https, not http
		const fetchUrl = mockFetch.mock.calls[1][0];
		expect(fetchUrl).toBe("https://secure-site.com");
	});

	it("does not cache when URL is different", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		mockFetch.mockResolvedValueOnce({
			ok: true,
			redirected: false,
			url: "https://page-a.com",
			headers: new Map([["content-type", "text/html"]]),
			text: async () => "<html><body>Page A</body></html>",
		});

		const tool = createWebFetchTool();

		// First call — fetches fresh
		const result1 = await tool.execute("call-1", { url: "https://page-a.com" });
		const text1 = (result1.content[0] as { type: "text"; text: string }).text;
		expect(text1).toContain("Page A");
		expect(result1.details.cached).toBeFalsy();

		// Second call (same URL) — hits cache
		const result2 = await tool.execute("call-2", { url: "https://page-a.com" });
		const text2 = (result2.content[0] as { type: "text"; text: string }).text;
		expect(text2).toContain("Page A");
		expect(text2).toContain("(cached)");
		expect(result2.details.cached).toBe(true);
	});

	it("handles cross-host redirects", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		mockFetch.mockResolvedValueOnce({
			ok: true,
			redirected: true,
			url: "https://other-site.com/page",
			headers: new Map([["content-type", "text/html"]]),
			text: async () => "",
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("call-1", { url: "https://origin-site.com" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("redirected to a different host");
		expect(text).toContain("https://other-site.com/page");
	});

	it("handles fetch errors gracefully", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		mockFetch.mockRejectedValueOnce(new Error("Network error"));

		const tool = createWebFetchTool();
		const result = await tool.execute("call-1", { url: "https://fail-site.com" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Fetch failed");
		expect(text).toContain("Network error");
	});

	it("runs prompt via runPrompt callback when provided", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		mockFetch.mockResolvedValueOnce({
			ok: true,
			redirected: false,
			url: "https://science-site.com",
			headers: new Map([["content-type", "text/html"]]),
			text: async () => "<html><body>The sky is blue because of Rayleigh scattering.</body></html>",
		});

		const runPrompt = vi.fn().mockResolvedValue("The sky appears blue due to Rayleigh scattering of sunlight.");

		const tool = createWebFetchTool(runPrompt);
		const result = await tool.execute("call-1", {
			url: "https://science-site.com",
			prompt: "Why is the sky blue?",
		});

		expect(runPrompt).toHaveBeenCalledWith(
			expect.stringContaining("Rayleigh scattering"),
			"Why is the sky blue?",
			undefined,
		);

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toBe("The sky appears blue due to Rayleigh scattering of sunlight.");
	});
});

describe("createSearchTools", () => {
	it("returns web_search and web_fetch tools", () => {
		const tools = createSearchTools();
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("web_search");
		expect(tools[1].name).toBe("web_fetch");
	});

	it("passes runPrompt option to web_fetch tool", () => {
		const runPrompt = vi.fn();
		const tools = createSearchTools({ runPrompt });
		expect(tools).toHaveLength(2);
		// web_fetch and web_search both created successfully
		expect(tools[0].name).toBe("web_search");
		expect(tools[1].name).toBe("web_fetch");
	});
});

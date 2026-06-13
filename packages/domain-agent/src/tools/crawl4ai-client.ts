/**
 * Thin HTTP client for Crawl4AI's Docker API.
 *
 * Crawl4AI is a Python-based web crawler that runs as a Docker service.
 * It exposes a REST API at port 11235 by default.
 *
 * Usage:
 *   1. Start Crawl4AI: docker run -d -p 11235:11235 --shm-size=1g unclecode/crawl4ai:latest
 *   2. Set env: CRAWL4AI_BASE_URL=http://localhost:11235 (optional, this is the default)
 *   3. Call fetchMarkdown(url) — returns clean, LLM-ready markdown
 *
 * @see https://github.com/unclecode/crawl4ai
 */

const DEFAULT_BASE_URL = "http://localhost:11235";

function getBaseUrl(): string {
	return process.env.CRAWL4AI_BASE_URL ?? DEFAULT_BASE_URL;
}

/** Result from Crawl4AI's /crawl endpoint. */
interface Crawl4AIPage {
	url: string;
	final_url?: string;
	status_code?: number;
	markdown?: string;
	html?: string;
	title?: string;
	error?: string;
}

interface Crawl4AIResponse {
	pages?: Crawl4AIPage[];
	// Some versions return the page directly
	url?: string;
	markdown?: string;
	html?: string;
	title?: string;
	error?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Check whether the Crawl4AI service is reachable.
 * Returns false quickly on connection refused (no hanging).
 */
export async function isCrawl4AIAvailable(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		const response = await fetch(`${getBaseUrl()}/health`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Fetch a web page and return its clean markdown content via Crawl4AI.
 * Falls back to null if the service is unavailable or the crawl fails —
 * callers should have a fallback path.
 *
 * @param url - The URL to fetch and convert to markdown
 * @returns Clean markdown string, or null on failure
 */
export async function fetchMarkdown(url: string): Promise<string | null> {
	const baseUrl = getBaseUrl();

	let response: Response;
	try {
		response = await fetch(`${baseUrl}/crawl`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ urls: [url] }),
		});
	} catch {
		return null;
	}

	if (!response.ok) {
		return null;
	}

	try {
		const data = (await response.json()) as Crawl4AIResponse;
		return extractMarkdown(data);
	} catch {
		return null;
	}
}

/**
 * Fetch multiple URLs in one call. Returns results in the same order as input.
 * URLs that fail will have markdown set to null.
 */
export async function fetchMarkdownBatch(urls: string[]): Promise<Array<{ url: string; markdown: string | null }>> {
	const baseUrl = getBaseUrl();

	try {
		const response = await fetch(`${baseUrl}/crawl`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ urls }),
		});

		if (!response.ok) {
			return urls.map((url) => ({ url, markdown: null }));
		}

		const data = (await response.json()) as Crawl4AIResponse;
		const pages = normalizePages(data);

		return urls.map((url) => {
			const page = pages.find((p) => p.url === url);
			return { url, markdown: page?.markdown ?? null };
		});
	} catch {
		return urls.map((url) => ({ url, markdown: null }));
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function normalizePages(data: Crawl4AIResponse): Crawl4AIPage[] {
	// Some versions wrap in { pages: [...] }
	if (data.pages && data.pages.length > 0) {
		return data.pages;
	}
	// Some versions return the page object directly
	if (data.url) {
		return [{ url: data.url, markdown: data.markdown, html: data.html, title: data.title, error: data.error }];
	}
	return [];
}

function extractMarkdown(data: Crawl4AIResponse): string | null {
	const pages = normalizePages(data);
	if (pages.length === 0) return null;

	const page = pages[0];
	if (page.error) return null;

	return page.markdown ?? null;
}

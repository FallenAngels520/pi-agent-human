import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import { fetchMarkdown } from "./crawl4ai-client.js";

// ── Tavily API ─────────────────────────────────────────────────────────────────

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilySearchParams {
  query: string;
  search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
  max_results?: number;
  topic?: "general" | "news" | "finance";
  time_range?: "day" | "week" | "month" | "year";
  include_domains?: string[];
  exclude_domains?: string[];
  include_answer?: boolean | "basic" | "advanced";
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  results: TavilyResult[];
  answer?: string;
  response_time: number;
}

// ── Web Search Schema ──────────────────────────────────────────────────────────

const webSearchSchema = Type.Object({
  query: Type.String({ description: "The search query to execute" }),
  allowed_domains: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Only include search results from these domains. Maps to Tavily include_domains (max 300).",
    }),
  ),
  blocked_domains: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Never include search results from these domains. Maps to Tavily exclude_domains (max 150).",
    }),
  ),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (default: 10, max: 20)",
      minimum: 0,
      maximum: 20,
    }),
  ),
  search_depth: Type.Optional(
    Type.String({
      description:
        "Search depth: basic (fast, 1 credit), advanced (higher relevance, 2 credits), fast, ultra-fast",
    }),
  ),
  topic: Type.Optional(
    Type.String({
      description: "Search topic: general, news (real-time updates), finance",
    }),
  ),
  time_range: Type.Optional(
    Type.String({
      description: "Time range filter: day, week, month, year",
    }),
  ),
  include_answer: Type.Optional(
    Type.Boolean({
      description:
        "Include an LLM-generated answer summarizing the search results",
    }),
  ),
});

// ── Web Search Tool ────────────────────────────────────────────────────────────

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Tavily API. Returns structured results with titles, URLs, and content snippets. " +
      "Supports domain filtering (allowed_domains/blocked_domains), custom search depth, topic filtering, " +
      "and optional LLM-generated answers. Free tier: 1000 queries/month.",
    parameters: webSearchSchema,
    execute: async (
      _toolCallId,
      params: Static<typeof webSearchSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<any>> => {
      const apiKey = process.env.TAVILY_API_KEY ?? "";
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Web search is not configured. Set TAVILY_API_KEY environment variable.",
            },
          ],
          details: {
            results: [],
            query: params.query,
            error: "TAVILY_API_KEY not set",
          },
        };
      }

      const body: TavilySearchParams = {
        query: params.query,
        search_depth: (params.search_depth as TavilySearchParams["search_depth"]) ?? "basic",
        max_results: params.max_results ?? 10,
        topic: (params.topic as TavilySearchParams["topic"]) ?? "general",
        include_domains: params.allowed_domains,
        exclude_domains: params.blocked_domains,
      };

      if (params.include_answer) {
        body.include_answer = "basic";
      }
      if (params.time_range) {
        body.time_range = params.time_range as TavilySearchParams["time_range"];
      }

      try {
        const response = await fetch(TAVILY_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          let errorDetail = `HTTP ${response.status}`;

          if (response.status === 401) errorDetail = "Invalid API key";
          else if (response.status === 429) errorDetail = "Rate limit exceeded";
          else if (response.status === 432)
            errorDetail = "Monthly quota exceeded (1000 requests)";

          return {
            content: [
              {
                type: "text",
                text: `Search failed: ${errorDetail}`,
              },
            ],
            details: { results: [], query: params.query, error: errorDetail },
          };
        }

        const data = (await response.json()) as TavilyResponse;

        if (!data.results || data.results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No results found for "${params.query}". Try different search terms.`,
              },
            ],
            details: { results: [], query: params.query },
          };
        }

        let text = `Search results for "${params.query}":\n\n`;

        for (let i = 0; i < data.results.length; i++) {
          const r = data.results[i];
          text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content}\n\n`;
        }

        if (data.answer) {
          text += `---\n**Summary:** ${data.answer}\n`;
        }

        return {
          content: [{ type: "text", text }],
          details: {
            results: data.results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content,
              score: r.score,
            })),
            query: params.query,
            answer: data.answer,
            responseTime: data.response_time,
          },
        };
      } catch (error) {
        if (signal?.aborted) {
          return {
            content: [
              {
                type: "text",
                text: `Search aborted for "${params.query}".`,
              },
            ],
            details: { results: [], query: params.query, error: "aborted" },
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text", text: `Search failed: ${message}` },
          ],
          details: { results: [], query: params.query, error: message },
        };
      }
    },
  };
}

// ── Web Fetch ──────────────────────────────────────────────────────────────────

const webFetchSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch and extract text from" }),
  prompt: Type.Optional(
    Type.String({
      description:
        "A question or instruction to run against the fetched content. " +
        "When provided, the content is processed by a model and only the answer " +
        "is returned instead of the full page text. Use this to extract specific " +
        "information from a page without consuming context window.",
    }),
  ),
});

/**
 * Callback to run a prompt against fetched content and return the answer.
 * Implemented by the caller (e.g. CognitiveAgent) using the agent's model.
 */
export type RunPromptFn = (
  content: string,
  prompt: string,
  signal?: AbortSignal,
) => Promise<string>;

// ── Caching ────────────────────────────────────────────────────────────────────

/** In-memory response cache. TTL = 15 minutes. */
const fetchCache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(url: string): string | null {
  const entry = fetchCache.get(url);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.content;
  }
  // Expired entries are left to be overwritten — small map, no leak concern.
  return null;
}

function setCache(url: string, content: string): void {
  fetchCache.set(url, { content, timestamp: Date.now() });
}

/** Clear the fetch cache. Exported for testing. */
export function clearFetchCache(): void {
  fetchCache.clear();
}

// ── URL safety ─────────────────────────────────────────────────────────────────

/**
 * Upgrade http:// to https://. Same-host upgrade is transparent;
 * cross-host scenarios are noted in the result.
 */
function upgradeToHttps(url: string): { url: string; upgraded: boolean } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:") {
      return { url: url.replace(/^http:\/\//, "https://"), upgraded: true };
    }
    return { url, upgraded: false };
  } catch {
    return { url, upgraded: false };
  }
}

/**
 * Returns true when the fetch response was redirected to a different host.
 * Since `fetch` follows redirects by default, we compare the final URL.
 */
function isCrossHostRedirect(originalUrl: string, finalUrl: string): boolean {
  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    return orig.host !== final.host;
  } catch {
    return false;
  }
}

// ── HTML extraction (fallback) ─────────────────────────────────────────────────

/**
 * Strip HTML tags and extract readable text.
 * Removes non-content elements (script, style, nav, footer, header, aside),
 * decodes common HTML entities, and collapses whitespace.
 */
function extractTextFromHtml(html: string, maxLength = 12000): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  text = text.replace(/<[^>]*>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

// ── Web Fetch Tool ─────────────────────────────────────────────────────────────

export function createWebFetchTool(runPrompt?: RunPromptFn): AgentTool<typeof webFetchSchema> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a web page by URL and extract its readable content. " +
      "When Crawl4AI is available, returns clean, LLM-ready markdown (handles JS-rendered pages, anti-bot, etc.). " +
      "Falls back to basic HTML extraction otherwise. " +
      "HTTP URLs are automatically upgraded to HTTPS. " +
      "Results are cached for 15 minutes. " +
      "When a prompt is provided, the content is processed by a model and only the answer is returned.",
    parameters: webFetchSchema,
    execute: async (
      _toolCallId,
      params: Static<typeof webFetchSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<any>> => {
      // ── HTTP → HTTPS upgrade ──
      const { url, upgraded } = upgradeToHttps(params.url);

      // ── Check cache ──
      const cachedContent = getCached(url);
      if (cachedContent !== null) {
        if (params.prompt && runPrompt) {
          try {
            const answer = await runPrompt(cachedContent, params.prompt, signal);
            return {
              content: [{ type: "text", text: answer }],
              details: { url, backend: "cache", cached: true, prompt: params.prompt },
            };
          } catch {
            // Prompt processing failed — return cached content directly.
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Content from ${url} (cached):\n\n${cachedContent}`,
            },
          ],
          details: { url, length: cachedContent.length, backend: "cache", cached: true },
        };
      }

      // ── Try Crawl4AI first ──
      const markdown = await fetchMarkdown(url);

      let content: string;
      let backend: string;

      if (markdown) {
        content = markdown;
        backend = "crawl4ai";
      } else {
        // ── Fallback: raw fetch + HTML extraction ──
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; domain-agent/1.0)",
              Accept: "text/html,application/xhtml+xml,text/plain",
            },
            signal,
            // Don't follow redirects — we want to detect cross-host redirects.
            redirect: "follow",
          });

          // Detect cross-host redirect (compare original vs final URL)
          if (
            response.redirected &&
            isCrossHostRedirect(url, response.url)
          ) {
            return {
              content: [
                {
                  type: "text",
                  text: `This URL redirected to a different host: ${response.url}. Fetch the redirect target directly if needed.`,
                },
              ],
              details: {
                url,
                redirectedTo: response.url,
                backend: "redirect",
              },
            };
          }

          if (!response.ok) {
            const reason =
              response.status === 403
                ? "Access denied (403). The page may require authentication or block automated requests."
                : response.status === 404
                  ? "Page not found (404)."
                  : `HTTP ${response.status}`;

            return {
              content: [
                {
                  type: "text",
                  text: `Fetch failed: ${reason} for ${url}`,
                },
              ],
              details: { url, status: response.status },
            };
          }

          const contentType = response.headers.get("content-type") ?? "";
          const raw = await response.text();

          if (contentType.includes("json")) {
            content = JSON.stringify(JSON.parse(raw), null, 2).slice(0, 8000);
          } else if (contentType.includes("html") || contentType.includes("text")) {
            content = extractTextFromHtml(raw);
          } else {
            content = raw.slice(0, 8000);
          }
          backend = "fetch";

          if (!content) {
            return {
              content: [
                {
                  type: "text",
                  text: `No readable text extracted from ${url}`,
                },
              ],
              details: { url },
            };
          }
        } catch (error) {
          if (signal?.aborted) {
            return {
              content: [
                { type: "text", text: `Fetch aborted for ${url}` },
              ],
              details: { url, error: "aborted" },
            };
          }
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Fetch failed: ${message}` }],
            details: { url, error: message },
          };
        }
      }

      // ── Cache the content ──
      setCache(url, content);

      // ── Run prompt if requested ──
      if (params.prompt && runPrompt) {
        try {
          const answer = await runPrompt(content, params.prompt, signal);
          return {
            content: [{ type: "text", text: answer }],
            details: { url, backend, prompt: params.prompt },
          };
        } catch {
          // Prompt processing failed — return full content instead.
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Content from ${url}:\n\n${content}`,
          },
        ],
        details: { url, length: content.length, backend },
      };
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export interface SearchToolsOptions {
  /** Callback to run a prompt against fetched content using an LLM. */
  runPrompt?: RunPromptFn;
}

export function createSearchTools(options?: SearchToolsOptions): AgentTool[] {
  return [createWebSearchTool(), createWebFetchTool(options?.runPrompt)];
}

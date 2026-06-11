// Provider types and pricing information

export type Provider = "claude" | "gemini" | "codex" | "cursor" | "wiki";

export interface ProviderConfig {
  name: string;
  supportsCache: boolean;
  supportsTools: boolean;
  tokenPricing: TokenPricing;
  jsonlFormat: JsonlFormat;
}

export interface TokenPricing {
  inputPricePer1k: number;  // USD
  outputPricePer1k: number; // USD
  currency: string;
}

export interface JsonlFormat {
  // Provider-specific JSONL structure differences
  hasCacheFields: boolean;
  hasToolUseStructure: boolean;
  usageFieldNames: {
    input: string;
    output: string;
    cacheRead?: string;
    cacheCreation?: string;
  };
  contentBlockTypes: string[];
}

// Provider configurations
export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  claude: {
    name: "Claude",
    supportsCache: true,
    supportsTools: true,
    tokenPricing: {
      inputPricePer1k: 0.003,   // Sonnet 4.6
      outputPricePer1k: 0.015,
      currency: "USD",
    },
    jsonlFormat: {
      hasCacheFields: true,
      hasToolUseStructure: true,
      usageFieldNames: {
        input: "input_tokens",
        output: "output_tokens",
        cacheRead: "cache_read_input_tokens",
        cacheCreation: "cache_creation_input_tokens",
      },
      contentBlockTypes: ["text", "tool_use", "tool_result", "thinking"],
    },
  },
  gemini: {
    name: "Gemini",
    supportsCache: true, // Gemini 1.5는 캐시 지원
    supportsTools: true,
    tokenPricing: {
      inputPricePer1k: 0.00125, // Gemini 1.5 Pro 기준
      outputPricePer1k: 0.00375,
      currency: "USD",
    },
    jsonlFormat: {
      hasCacheFields: true,
      hasToolUseStructure: true,
      usageFieldNames: {
        input: "input_tokens",
        output: "output_tokens",
        cacheRead: "cache_read_input_tokens",
        cacheCreation: "cache_creation_input_tokens",
      },
      contentBlockTypes: ["text", "tool_use", "tool_result", "thinking"],
    },
  },
  codex: {
    name: "Codex",
    supportsCache: false,
    supportsTools: true,
    tokenPricing: {
      inputPricePer1k: 0.01,
      outputPricePer1k: 0.03,
      currency: "USD",
    },
    jsonlFormat: {
      hasCacheFields: false,
      hasToolUseStructure: true,
      usageFieldNames: {
        input: "prompt_tokens", // OpenAI/Codex 스타일 필드명 대응 가능성
        output: "completion_tokens",
      },
      contentBlockTypes: ["text", "tool_use", "tool_result"],
    },
  },
  cursor: {
    name: "Cursor",
    supportsCache: false,
    supportsTools: true,
    tokenPricing: {
      inputPricePer1k: 0.003,
      outputPricePer1k: 0.015,
      currency: "USD",
    },
    jsonlFormat: {
      hasCacheFields: false,
      hasToolUseStructure: true,
      usageFieldNames: {
        input: "input_tokens",
        output: "output_tokens",
      },
      contentBlockTypes: ["text", "tool-call", "tool-result", "reasoning"],
    },
  },
  wiki: {
    name: "Wiki",
    supportsCache: false,
    supportsTools: false,
    tokenPricing: {
      inputPricePer1k: 0,
      outputPricePer1k: 0,
      currency: "USD",
    },
    jsonlFormat: {
      hasCacheFields: false,
      hasToolUseStructure: false,
      usageFieldNames: {
        input: "input_tokens",
        output: "output_tokens",
      },
      contentBlockTypes: ["text"],
    },
  },
};

// Detect provider from model name
export function detectProvider(model: string): Provider {
  const lower = model.toLowerCase();

  if (lower.includes("claude") || lower.includes("anthropic")) {
    return "claude";
  }
  if (lower.includes("gemini") || lower.includes("google")) {
    return "gemini";
  }
  if (lower.includes("codex") || lower.includes("openai")) {
    return "codex";
  }
  if (lower.includes("cursor") || lower.includes("composer")) {
    return "cursor";
  }
  if (lower.includes("ollama") || lower.includes("wiki") || lower.includes("qwen")) {
    return "wiki";
  }

  // Default to claude for unknown models
  return "claude";
}

// Calculate cost from token usage
export function calculateCost(
  provider: Provider,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0
): number {
  const config = PROVIDER_CONFIGS[provider];
  const pricing = config.tokenPricing;

  const inputCost = (inputTokens / 1000) * pricing.inputPricePer1k;
  const outputCost = (outputTokens / 1000) * pricing.outputPricePer1k;

  // Cache read tokens are typically cheaper (50% discount for Claude)
  const cacheCost = config.supportsCache
    ? (cacheReadTokens / 1000) * (pricing.inputPricePer1k * 0.5)
    : 0;

  return inputCost + outputCost + cacheCost;
}

// Format cost as currency string
export function formatCost(cost: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(cost);
}

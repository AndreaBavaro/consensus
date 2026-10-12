function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  get openRouterKey() {
    return required("OPENROUTER_API_KEY");
  },
  get llmModel() {
    return process.env.LLM_MODEL ?? "deepseek/deepseek-v4.1-flash";
  },
  get llmProviders() {
    return list("LLM_PROVIDERS");
  },
  get classifierModel() {
    return process.env.CLASSIFIER_MODEL ?? this.llmModel;
  },
  get twitterKey() {
    return process.env.TWITTERAPI_IO_KEY;
  },
  get serpApiKey() {
    return required("SERPAPI_KEY");
  },
  get serperKey() {
    return process.env.SERPER_API_KEY;
  },
  /** Fresh (uncached) searches allowed per visitor IP per hour. */
  get rateLimitPerHour() {
    return Number(process.env.RATE_LIMIT_PER_HOUR ?? 30);
  },
  /** Fresh searches stop for the day once this much has been spent (USD, measured per search). */
  get dailySpendCapUsd() {
    return Number(process.env.DAILY_SPEND_CAP_USD ?? 25);
  },
  get cacheTtlHours() {
    return Number(process.env.CACHE_TTL_HOURS ?? 6);
  },
  get oxylabsUsername() {
    return required("OXYLABS_USERNAME");
  },
  get oxylabsPassword() {
    return required("OXYLABS_PASSWORD");
  },
};

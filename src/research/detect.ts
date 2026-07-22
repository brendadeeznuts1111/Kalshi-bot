import type { CodeSearchHit, ResearchConfig } from "./types.ts";
import {
  AUTH_MARKERS,
  DEFAULT_STRATEGY_TAG,
  DRY_RUN_MARKERS,
  ORDER_MARKERS,
  PORTFOLIO_ORDERS_MARKER,
  RSA_PSS_MARKERS,
  SDK_MARKERS,
  SDK_ONLY_TAG,
  V2_API_MARKER,
} from "./constants.ts";

type RootEntry = { name: string };

export function detectTestsAndCi(entries: RootEntry[], text: string) {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  return {
    hasTests:
      names.has("tests") ||
      names.has("test") ||
      names.has("__tests__") ||
      /\.test\.|\.spec\.|pytest|unittest|vitest|jest/i.test(text),
    hasCi: names.has(".github") || /github\/workflows|\.gitlab-ci|circleci/i.test(text),
  };
}

export function detectStrategyTags(text: string, config: ResearchConfig): string[] {
  const tags = Object.entries(config.keywords.strategyTags)
    .filter(([, keywords]) => keywords.some((k) => text.includes(k.toLowerCase())))
    .map(([tag]) => tag);
  return tags.length ? tags : [DEFAULT_STRATEGY_TAG];
}

export function detectReadmeSections(readme: string) {
  return {
    hasSetupSection: /##?\s*(setup|install|getting started|quick start)/i.test(readme),
    hasStrategySection: /##?\s*(strateg|architecture|how it works)/i.test(readme),
  };
}

export function primaryLanguage(languages: Record<string, number>): string | null {
  const entries = Object.entries(languages);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0]![0];
}

export function deriveCodeSignals(
  readme: string,
  authHits: CodeSearchHit[],
  orderHits: CodeSearchHit[],
  config: ResearchConfig,
) {
  const readmeLower = readme.toLowerCase();
  const combinedText = `${readmeLower}\n${[...authHits, ...orderHits].flatMap((h) => h.paths).join(" ").toLowerCase()}`;

  const usesOfficialSdk = SDK_MARKERS.some((m) => combinedText.includes(m.toLowerCase()));
  const hasAuthInCode = authHits.some((h) => AUTH_MARKERS.some((k) => h.query.includes(k)));
  const hasV2Api =
    authHits.some((h) => h.query.includes(V2_API_MARKER)) || combinedText.includes(V2_API_MARKER);
  const hasRsaPss = RSA_PSS_MARKERS.some((m) => combinedText.includes(m));
  const hasLiveOrderPath =
    orderHits.some((h) => ORDER_MARKERS.some((k) => h.query.includes(k))) ||
    combinedText.includes(PORTFOLIO_ORDERS_MARKER);
  const hasDryRunDefault = DRY_RUN_MARKERS.some((k) => combinedText.includes(k));

  return {
    combinedText,
    usesOfficialSdk,
    hasAuthInCode,
    hasV2Api,
    hasRsaPss,
    hasLiveOrderPath,
    hasDryRunDefault,
    riskKeywordHits: config.keywords.riskKeywords.filter((k) => combinedText.includes(k.toLowerCase())),
  };
}

export function isSdkOnlyRepo(
  strategyTags: string[],
  usesOfficialSdk: boolean,
  hasLiveOrderPath: boolean,
  readme: string,
): boolean {
  const readmeLower = readme.toLowerCase();
  return (
    strategyTags.includes(SDK_ONLY_TAG) ||
    (usesOfficialSdk && !hasLiveOrderPath && readmeLower.includes("client") && readme.length < 2500)
  );
}

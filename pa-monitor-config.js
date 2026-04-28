// pa-monitor-config.js
// CommonJS — readable by GitHub Actions `node -e "require('./pa-monitor-config.js')"` and Playwright specs via require().
// Keep tier1Locales aligned with pa-monitor-config.yml → tiers.tier1 for anyone still reading the YAML.
//
// Phase 2 (post ROW migration): add osiCodes per locale

/** PA / offer codes: PA-scoped monitors only exercise merch-cards whose checkout CTAs reference one of these. */
const offerCodes = [
  { pa: 'ccsn_direct_individual',   label: 'CC Pro' },
  { pa: 'ccle_direct_indirect_team', label: 'CC Pro Business' },
  { pa: 'phsp_direct_individual',    label: 'Photoshop' },
  { pa: 'apcc_direct_individual',    label: 'Acrobat Pro' },
  { pa: 'PA-128', label: 'Photography' },
];

/**
 * Pages available to monitors and CI.
 * `path` is the path after the locale segment (see buildAdobePlansUrl).
 */
const monitorPages = {
  plans: {
    id: 'plans',
    path: 'creativecloud/plans.html',
    spec: 'plans/pa-core-monitor.spec.js',
    /** Until ROW parity is proven, point ROW at a different spec here. */
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
  catalog: {
    id: 'catalog',
    path: 'products/catalog.html',
    spec: 'plans/pa-core-monitor.spec.js',
    rowSpec: 'plans/pa-core-monitor.spec.js',
  },
};

/**
 * Default pages per locale row when `pageKeys` is omitted.
 * ROW catalog-only: use pageKeys: ['catalog'] — URLs are `{locale}/products/catalog.html`.
 */
const paCoreMonitorPageKeys = ['plans', 'catalog'];

/**
 * Tier 1 locales for the scheduled PA core monitor (see .github/workflows/pa-core-monitor.yml).
 * `region`: `us` vs `row` selects monitorPages.*.spec vs rowSpec in workflow.
 * `pageKeys` (optional): subset of `plans` / `catalog`; defaults to paCoreMonitorPageKeys for that row.
 */
const tier1Locales = [
  { locale: '', label: 'US', region: 'us' },
  { locale: 'uk', label: 'UK', region: 'row', pageKeys: ['catalog'] },
  { locale: 'fr', label: 'FR', region: 'row', pageKeys: ['catalog'] },
  { locale: 'de', label: 'DE', region: 'row', pageKeys: ['catalog'] },
  { locale: 'au', label: 'AU', region: 'row', pageKeys: ['catalog'] },
  { locale: 'jp', label: 'JP', region: 'row', pageKeys: ['catalog'] },
  { locale: 'in', label: 'IN', region: 'row', pageKeys: ['catalog'] },
];

const ADOBE_ORIGIN = 'https://www.adobe.com';

/**
 * @param {string} locale - '' for US
 * @param {string} [pagePath] - defaults to monitorPages.plans.path
 */
function buildAdobePlansUrl(locale, pagePath = monitorPages.plans.path) {
  const prefix = locale ? `${locale}/` : '';
  return `${ADOBE_ORIGIN}/${prefix}${pagePath}`;
}

/** Matrix rows for GitHub Actions `strategy.matrix.include` (locale × configured pageKeys). */
const tier1GithubActionsMatrix = tier1Locales.flatMap(row => {
  const keys = row.pageKeys || paCoreMonitorPageKeys;
  return keys.map(pageKey => ({
    locale: row.locale,
    label: row.label,
    region: row.region,
    pageKey,
    pageLabel: pageKey === 'plans' ? 'Plans' : 'Catalog',
  }));
});

module.exports = {
  offerCodes,
  monitorPages,
  paCoreMonitorPageKeys,
  tier1Locales,
  tier1GithubActionsMatrix,
  buildAdobePlansUrl,
};

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
};

/**
 * Tier 1 locales for the scheduled PA core monitor (see .github/workflows/pa-core-monitor.yml).
 * `region`: `us` vs `row` selects monitorPages.plans.spec vs rowSpec in workflow.
 */
const tier1Locales = [
  { locale: '', label: 'US', region: 'us' },
  // { locale: 'uk', label: 'UK', region: 'row' },
  // { locale: 'de', label: 'DE', region: 'row' },
  // { locale: 'fr', label: 'FR', region: 'row' },
  // { locale: 'jp', label: 'JP', region: 'row' },
  // { locale: 'au', label: 'AU', region: 'row' },
  // { locale: 'in', label: 'IN', region: 'row' },
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

/** Matrix rows for GitHub Actions `strategy.matrix.include`. */
const tier1GithubActionsMatrix = tier1Locales.map(row => ({
  locale: row.locale,
  label: row.label,
  region: row.region,
}));

module.exports = {
  offerCodes,
  monitorPages,
  tier1Locales,
  tier1GithubActionsMatrix,
  buildAdobePlansUrl,
};

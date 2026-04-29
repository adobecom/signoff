// jira-routing.js
// CommonJS — called from GitHub Actions via `node -e "require('./jira-routing.js')"`.
// Maps a test URL + locale to Jira routing fields (assignee, cc, team, project).

const rules = require('./poc-rules.json');

// Locale code → which regional POC field to use for CC
const LOCALE_REGION_FIELD = {
  // Japan (own field)
  jp: 'japanWebProductionPOC',

  // APAC
  au: 'apacWebProductionPOC',
  nz: 'apacWebProductionPOC',
  in: 'apacWebProductionPOC',
  in_hi: 'apacWebProductionPOC',
  sg: 'apacWebProductionPOC',
  hk_en: 'apacWebProductionPOC',
  hk_zh: 'apacWebProductionPOC',
  tw: 'apacWebProductionPOC',
  kr: 'apacWebProductionPOC',
  th_en: 'apacWebProductionPOC',
  th_th: 'apacWebProductionPOC',
  id_en: 'apacWebProductionPOC',
  id_id: 'apacWebProductionPOC',
  my_en: 'apacWebProductionPOC',
  my_ms: 'apacWebProductionPOC',
  ph_en: 'apacWebProductionPOC',
  ph_fil: 'apacWebProductionPOC',
  vn_en: 'apacWebProductionPOC',
  vn_vi: 'apacWebProductionPOC',
  cn: 'apacWebProductionPOC',

  // Americas
  br: 'americasWebProductionPOC',
  mx: 'americasWebProductionPOC',
  ar: 'americasWebProductionPOC',
  cl: 'americasWebProductionPOC',
  co: 'americasWebProductionPOC',
  cr: 'americasWebProductionPOC',
  ec: 'americasWebProductionPOC',
  gt: 'americasWebProductionPOC',
  la: 'americasWebProductionPOC',
  pe: 'americasWebProductionPOC',
  ca: 'americasWebProductionPOC',
  ca_fr: 'americasWebProductionPOC',
  pr: 'americasWebProductionPOC',

  // EMEA
  uk: 'emeaWebProductionPOC',
  fr: 'emeaWebProductionPOC',
  de: 'emeaWebProductionPOC',
  es: 'emeaWebProductionPOC',
  it: 'emeaWebProductionPOC',
  nl: 'emeaWebProductionPOC',
  be_en: 'emeaWebProductionPOC',
  be_fr: 'emeaWebProductionPOC',
  be_nl: 'emeaWebProductionPOC',
  at: 'emeaWebProductionPOC',
  ch_de: 'emeaWebProductionPOC',
  ch_fr: 'emeaWebProductionPOC',
  ch_it: 'emeaWebProductionPOC',
  dk: 'emeaWebProductionPOC',
  fi: 'emeaWebProductionPOC',
  no: 'emeaWebProductionPOC',
  se: 'emeaWebProductionPOC',
  pl: 'emeaWebProductionPOC',
  pt: 'emeaWebProductionPOC',
  cz: 'emeaWebProductionPOC',
  sk: 'emeaWebProductionPOC',
  hu: 'emeaWebProductionPOC',
  ro: 'emeaWebProductionPOC',
  bg: 'emeaWebProductionPOC',
  gr_el: 'emeaWebProductionPOC',
  gr_en: 'emeaWebProductionPOC',
  ee: 'emeaWebProductionPOC',
  lv: 'emeaWebProductionPOC',
  lt: 'emeaWebProductionPOC',
  si: 'emeaWebProductionPOC',
  ie: 'emeaWebProductionPOC',
  lu_de: 'emeaWebProductionPOC',
  lu_en: 'emeaWebProductionPOC',
  lu_fr: 'emeaWebProductionPOC',
  africa: 'emeaWebProductionPOC',
  ng: 'emeaWebProductionPOC',
  za: 'emeaWebProductionPOC',
  eg_ar: 'emeaWebProductionPOC',
  eg_en: 'emeaWebProductionPOC',
  mena_ar: 'emeaWebProductionPOC',
  mena_en: 'emeaWebProductionPOC',
  ae_ar: 'emeaWebProductionPOC',
  ae_en: 'emeaWebProductionPOC',
  kw_ar: 'emeaWebProductionPOC',
  kw_en: 'emeaWebProductionPOC',
  qa_ar: 'emeaWebProductionPOC',
  qa_en: 'emeaWebProductionPOC',
  sa_ar: 'emeaWebProductionPOC',
  sa_en: 'emeaWebProductionPOC',
  il_en: 'emeaWebProductionPOC',
  il_he: 'emeaWebProductionPOC',
  tr: 'emeaWebProductionPOC',
  ua: 'emeaWebProductionPOC',
  ru: 'emeaWebProductionPOC',
};

/**
 * Converts a glob pattern (using * and **) to a RegExp.
 * ** matches any path segment(s), * matches within a single segment.
 */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * ?
    .replace(/\*\*/g, '.+')               // ** → one or more chars (any path)
    .replace(/\*/g, '[^/]+');             // *  → non-slash chars
  return new RegExp('^' + escaped + '(/.*)?$');
}

/**
 * Find the first active rule whose urlPattern matches the given URL path.
 */
function matchRule(url) {
  const path = url.replace(/^https?:\/\/[^/]+/, ''); // strip origin
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (globToRegex(rule.urlPattern).test(path)) return rule;
  }
  return null;
}

/**
 * Split a comma-separated POC string into a trimmed array, filtering empties.
 */
function splitPOC(value) {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Returns Jira routing fields for the given test URL and locale.
 *
 * @param {string} url    - Full test URL, e.g. "https://www.adobe.com/in/creativecloud/plans.html"
 * @param {string} locale - Locale code, e.g. "in", "uk", "" (US)
 * @returns {{ assignee: string, cc: string, team: string, project: string } | null}
 */
function getJiraRouting(url, locale) {
  const rule = matchRule(url);
  if (!rule) return null;

  const isUS = !locale || locale === '';
  const assignee = isUS ? rule.USLeadPOC : rule.IntlLeadPOC;

  const regionalField = LOCALE_REGION_FIELD[locale] || null;
  const regionalPOCs = regionalField ? splitPOC(rule[regionalField]) : [];

  const cc = [
    ...regionalPOCs,
    ...splitPOC(rule.engineeringPOC),
    ...splitPOC(rule.productManagerPOC),
    ...splitPOC(rule.programManagerPOC),
  ].filter(poc => poc !== assignee); // don't CC the assignee

  const uniqueCC = [...new Set(cc)].join(',');

  return {
    assignee,
    cc: uniqueCC,
    team: rule.webProductionTeam,
    project: 'DOTCOM',
  };
}

module.exports = { getJiraRouting };

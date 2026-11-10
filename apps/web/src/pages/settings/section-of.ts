/**
 * The section of the Settings page a setting is edited in, by its path (`workflow.tdd`). Most groups of the settings
 * file sit in one section; a few settings are edited beside their neighbours in another (the investigation limits
 * under Models & limits, the skill packs under Skills, the delivery defaults under New goal defaults). The count of
 * unsaved changes beside each section's name comes from this.
 */
const SECTION_OF_GROUP: Record<string, string> = {
  workflow: 'goals',
  reviews: 'goals',
  models: 'models',
  sessions: 'models',
  delivery: 'git',
  sync: 'git',
  tools: 'tools',
  preview: 'preview',
  checks: 'preview',
  notifications: 'notifications',
  safety: 'safety',
  beta: 'beta',
  engine: 'engine',
};
const SECTION_OF_PATH: Record<string, string> = {
  'workflow.investigationMaxCostUsd': 'models',
  'workflow.investigationMaxMinutes': 'models',
  'engine.maxConcurrent': 'models',
  'delivery.defaultMode': 'goals',
  'delivery.defaultUnit': 'goals',
  'delivery.defaultRemote': 'goals',
  ...Object.fromEntries(['settingSources', 'mcpDynamicTools', 'autoskills', 'designPack', 'imagePack', 'videoPack', 'figurePack', 'diagramPack', 'deckPack'].map((k) => [`workflow.${k}`, 'skills'])),
};

/** the id of the section (a Card's id on the page) where `path` is edited; null for a setting the page has no control for */
export function sectionOf(path: string): string | null {
  return SECTION_OF_PATH[path] ?? SECTION_OF_GROUP[path.split('.')[0]!] ?? null;
}

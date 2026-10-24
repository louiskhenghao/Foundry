/**
 * The projects behind the Extensions catalog (catalog/skills.json and catalog/mcp.json), keyed as catalogProject in
 * credits.ts names them: `owner/repo` on GitHub, the home page elsewhere. Each one is credited with its license or left
 * out with the reason; credits.test.ts fails when the catalog gains a project this file does not name. Licenses were read
 * from each project's repository. Goals clone these projects when they install them, so none is in the Docker image.
 */
/** `featured`: on the page's cards, so not repeated in the catalog list */
export type CatalogCredit = { license: string; name?: string; url?: string; featured?: true } | { excluded: string };

export const CATALOG: Record<string, CatalogCredit> = {
  'mattpocock/skills': { license: 'MIT', featured: true },
  'michael-denyer/pstack-claude': { license: 'MIT', featured: true },
  'safishamsi/graphify': { license: 'Apache-2.0', featured: true },
  'DietrichGebert/ponytail': { license: 'MIT' },
  // the repository holds proprietary document skills too; the catalog lists only Apache-2.0 ones
  'anthropics/skills': { license: 'Apache-2.0' },
  'openai/skills': { license: 'Apache-2.0' },
  'nextlevelbuilder/ui-ux-pro-max-skill': { license: 'MIT' },
  'pbakaus/impeccable': { license: 'Apache-2.0' },
  'bencium/bencium-marketplace': { license: 'MIT' },
  'ConardLi/garden-skills': { license: 'MIT' },
  'guinacio/claude-image-gen': { license: 'MIT' },
  'Leonxlnx/taste-skill': { license: 'MIT' },
  // the kit is MIT; its hyperframes, hyperframes-cli and gsap skills carry HyperFrames' Apache-2.0, its pipeline skills
  // (motion-showreel, short-form-edit, video-beats) the kit's own use permission (licenses/PIPELINE-USE-PERMISSION.txt)
  'nateherkai/hyperframes-student-kit': { name: 'Herk Edit Kit (hyperframes-student-kit)', license: 'MIT, Apache-2.0 and the kit\'s use permission' },
  'morluto/rea': { license: 'MIT' },
  'earthtojake/text-to-cad': { license: 'MIT' },
  'https://ffmpeg.org': { name: 'FFmpeg', license: 'LGPL-2.1-or-later', url: 'https://ffmpeg.org' },
  'upstash/context7': { license: 'MIT' },
  'microsoft/playwright-mcp': { license: 'Apache-2.0' },
  'exa-labs/exa-mcp-server': { license: 'MIT' },
  'brave/brave-search-mcp-server': { license: 'MIT' },
  'midudev/autoskills': { excluded: 'CC BY-NC 4.0: a non-commercial license, not an open-source one' },
  'https://www.npmjs.com/package/mmx-cli': { excluded: 'publishes no license' },
};

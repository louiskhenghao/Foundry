/** The shape of credits.json, which scripts/gen-credits.ts writes (see scripts/credits/credits.ts). */
export type PackageCredit = { name: string; version: string; license: string; url: string; copyright: string | null; text: string; notice?: string };
export type ToolCredit = { id: string; name: string; version: string | null; license: string; url: string; copyright: string | null; text?: string; notice?: string; note?: string };
export type CatalogKind = 'Skills' | 'MCP server' | 'Tool';
/** `ref`: the release the catalog pins it to; `featured`: on the page's cards, so not repeated in the catalog list */
export type CatalogCredit = { project: string; name: string; url: string; license: string; kinds: CatalogKind[]; ref: string | null; featured: boolean };
/** `text` and `notice` are keys of `texts`, which holds one copy of each distinct license text */
export type Credits = { packages: PackageCredit[]; tools: ToolCredit[]; catalog: CatalogCredit[]; texts: Record<string, string> };

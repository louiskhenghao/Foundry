/** Native plugin metadata safe to send to the browser; no paths, tokens or raw CLI output. */
export interface CodexPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: string;
  authPolicy: string;
}
export type CodexPluginsView =
  | { state: 'available'; plugins: CodexPlugin[]; checkedAt: string }
  | { state: 'unavailable'; message: string; checkedAt: string };

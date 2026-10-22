import { zodToJsonSchema } from 'zod-to-json-schema';
import { Theme } from '../schema/theme.ts';

/** The JSON Schema of a theme file: an editor that reads a file's `$schema` checks it and explains every setting while typing. */
export const themeJsonSchema = () => ({ title: 'Foundry theme', ...zodToJsonSchema(Theme, { $refStrategy: 'none' }) });

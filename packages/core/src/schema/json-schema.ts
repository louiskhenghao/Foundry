import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * The JSON schema a role's structured output is asked in. Properties the schema does not name are allowed at every
 * level: the coding agent checks the whole output against this schema and sends it back to be written again
 * otherwise, and a model that echoes a field it was given (the planner, the Brief skeleton's) or adds a note of its
 * own would pay for the whole output twice. The engine reads the output with the zod schema, which drops what it does
 * not name (ADR-0071).
 */
export function jsonSchemaFor(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { $refStrategy: 'none', removeAdditionalStrategy: 'strict' }) as Record<string, unknown>;
}

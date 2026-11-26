/** Deterministic JSON: object keys sorted recursively, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const entry = (input as Record<string, unknown>)[key];
        if (entry !== undefined) result[key] = normalize(entry);
      }
      return result;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('repository foundation', () => {
  it('keeps strict TypeScript enabled in the shared base', () => {
    const config: unknown = JSON.parse(
      readFileSync(new URL('../tsconfig.base.json', import.meta.url), 'utf8'),
    );

    expect(config).toMatchObject({ compilerOptions: { strict: true } });
  });
});

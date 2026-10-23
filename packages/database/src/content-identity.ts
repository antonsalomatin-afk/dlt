import { createHash } from 'node:crypto';

/** Sorted object keys, preserved array order and JSON scalar semantics; no file-byte hashing. */
export function canonicalJsonSha256(input: unknown): string {
  function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
      return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
    }
    throw new Error('Invalid JSON value.');
  }
  return createHash('sha256').update(canonical(input), 'utf8').digest('hex');
}

export function candidateQuestionId(version: 1, batchId: string, externalId: string): string {
  return candidateUuid(`thaidlt-candidate:v${version}:batch:${batchId}:question:${externalId}`);
}

export function candidateChoiceId(questionId: string, choiceKey: 'A' | 'B' | 'C' | 'D'): string {
  return candidateUuid(`thaidlt-candidate:choice:${questionId}:${choiceKey}`);
}

function candidateUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

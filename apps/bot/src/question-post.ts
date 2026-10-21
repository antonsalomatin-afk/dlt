import { z } from 'zod';
import { assignDailyPresentation } from '../../../packages/database/src/daily-practice.ts';
import { parsePresentationSnapshot } from '../../../packages/database/src/presentation.ts';
import type { PrismaClient } from '../../../packages/database/src/index.ts';
import type { QuestionPostConfig } from './config.ts';

const canonicalUuid = z.uuid().refine((value) => value === value.toLowerCase());
const safeStem = z.string().refine((value) => value.trim().length > 0
  && !/[\uD800-\uDFFF]/u.test(value)
  && !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/gu, '')));

/** A reference is passed to Telegram only; the bot never fetches it. */
export function publishableImageReference(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048 || /[\s\p{Cc}\p{Cf}\\]/u.test(input)) return null;
  try {
    const url = new URL(input);
    const hostname = url.hostname.replace(/\.$/u, '');
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash
      || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
      || url.hostname.includes(':') || /^\d+(?:\.\d+){3}$/u.test(url.hostname)) return null;
    if (/[\p{Cc}\p{Cf}]/u.test(decodeURIComponent(input))) return null;
    return url.toString();
  } catch { return null; }
}

export function buildQuestionPost(input: unknown, imageInput: unknown, config: Extract<QuestionPostConfig, { enabled: true }>) {
  const data = z.object({ presentationId: canonicalUuid, question: z.object({ textEnglish: safeStem, textRussian: safeStem }) }).parse(input);
  const text = `English\n${data.question.textEnglish}\n\nРусский\n${data.question.textRussian}`;
  // UTF-16 length is conservative for Telegram's character limits, including emoji.
  if (text.length > 4096) return null;
  const image = publishableImageReference(imageInput);
  const url = new URL(`https://t.me/${config.botUsername}${config.shortName ? `/${config.shortName}` : ''}`);
  url.searchParams.set('startapp', `question_${data.presentationId}`);
  return { text, image: image && text.length <= 1024 ? image : null, url: url.toString() };
}

export async function prepareQuestionPost(
  database: Pick<PrismaClient, '$transaction' | 'user' | 'questionPresentation'>,
  userId: string,
  instant: Date,
  config: Extract<QuestionPostConfig, { enabled: true }>,
) {
  const user = await database.user.findUnique({ where: { id: userId }, select: { id: true, selectedVehicleType: true } });
  if (!user?.selectedVehicleType) return null;
  const assigned = await assignDailyPresentation(database, user, instant);
  if (assigned.kind !== 'presentation') return null;
  const presentation = await database.questionPresentation.findFirst({
    where: { id: assigned.response.presentationId, userId, question: { active: true, verificationStatus: 'VERIFIED' } },
    select: { snapshot: true },
  });
  if (!presentation) return null;
  const snapshot = parsePresentationSnapshot(presentation.snapshot);
  return buildQuestionPost(assigned.response, snapshot.imageReference, config);
}

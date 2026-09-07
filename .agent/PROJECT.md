# ThaiDLT — Product Definition

## Product

**ThaiDLT** is a Telegram-first driving-theory learning product for foreigners preparing for Thailand's Department of Land Transport theory examination.

The product is inspired by the learning mechanics of successful driving-theory trainers such as `pravila.es`, but implementation, design, content organization and code must be original.

## Primary users

Initial target users:

- foreigners in Thailand;
- Russian-speaking users;
- English-speaking users;
- people preparing for Thai car or motorcycle theory exams.

## Product promise

ThaiDLT should make confusing DLT-style questions understandable.

For each question, the system should eventually support:

1. original Thai wording;
2. exam-style/official English wording when available;
3. normalized natural English;
4. Russian translation;
5. answer choices;
6. correct answer;
7. concise explanation;
8. trap/misunderstanding explanation;
9. source/legal reference;
10. concept/variant grouping.

## Initial vehicle types

- `CAR`
- `MOTORCYCLE`

## Initial languages

- Thai
- English
- Russian

## Core user flow

```text
Telegram /start
  -> Open Mini App
  -> authenticate via Telegram Mini App signed initData
  -> choose vehicle type
  -> receive question
  -> select one of four answers
  -> submit
  -> see correct/incorrect result
  -> see explanation
  -> continue
```

## MVP capabilities

The MVP should include:

- Telegram bot entry point;
- Telegram Mini App;
- server-side Telegram authentication validation;
- user creation/loading;
- car/motorcycle selection;
- question bank;
- exactly one submitted answer per presented attempt;
- immediate answer validation;
- explanation view;
- persisted answer history;
- progress;
- mistakes;
- category practice;
- mock exam;
- review of mock-exam mistakes;
- fixture/import pipeline;
- admin-ready content model.

## Later capabilities

Not part of the first implementation slice:

- paid access;
- Telegram Stars;
- affiliates/referrals;
- push/reminder campaigns;
- question of the day;
- sophisticated readiness scoring;
- spaced repetition;
- AI-generated explanations at request time;
- native iOS/Android applications;
- multi-country support.

## Content strategy

Do not assume that any scraped or third-party question bank is legally safe to republish.

Production content should be traceable.

Question records must be able to store:

- source type;
- source URL/reference;
- source date;
- legal/reference citation;
- review status;
- reviewer;
- last review date.

AI may later help with offline enrichment:

- normalization;
- translation drafts;
- explanation drafts;
- tagging;
- variant suggestions.

AI output must not automatically become verified production content.

## Product principles

### 1. Teach concepts, not answer positions

Users should learn the underlying rule rather than memorize "answer B".

Question variants can belong to one `concept` or `variantGroup`.

### 2. Confusing English should be decoded

A question may show both:

- DLT/exam-style English;
- normalized English.

### 3. Errors are valuable training material

Mistakes must be easy to revisit.

### 4. Progress should ultimately be concept-aware

Long term, learning state should be attached to concepts as well as individual questions.

### 5. Fast, simple Telegram entry

No email/password registration for Telegram users.

## Product owner intervention

Do not stop for minor UI wording, naming or implementation details.

Escalate only when a decision materially changes:

- user-visible scope;
- pricing;
- paid providers;
- production data;
- content/legal approach;
- credentials;
- architecture with high switching cost.

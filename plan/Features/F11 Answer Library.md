---
type: feature
phase: 2
status: planned
tags:
  - easyapply
  - feature
---

# F11 Answer Library

**Phase 2 - AI** · back to [[00 Home]] · [[Roadmap]]

## Problem
The same long questions come up on almost every application ("Why this company?",
"Describe a challenge you overcame", "Tell us about a time you led a team"). Writing or
generating them from scratch each time is slow, costs AI tokens, and gives inconsistent
answers.

## What it does
Every answer you **accept** (AI draft or hand-written) can be saved to your library. When a
similar question appears on a later application, the extension offers your saved answers
first - instant and free - and only calls AI if you ask for a fresh or adapted version.

```
"Why do you want to work at Acme?"   ->  Library match: "Why this company" (used 4x)
   [Use as-is]  [Adapt to Acme with AI]  [New draft]  [Write my own]
```

## Built with
- [[ai-svc]] (adapt + categorise), [[answers-svc]] (CRUD + match)
- [[DynamoDB]] (`ANSWER#<id>` items)
- [[Bedrock]] only for "Adapt" and auto-categorising

## Flows
- [[Flow - Answer from library]]

## Design
**Data** - one item per saved answer:

| Field | Example |
|---|---|
| `sk` | `ANSWER#<id>` |
| `category` | `why-company`, `why-role`, `challenge`, `leadership`, `teamwork`, `conflict`, `strength`, `weakness`, `career-goals`, `custom` |
| `question` | the original question text |
| `text` | the approved answer |
| `charCount`, `wordCount` | for length matching |
| `tags` | company type, role family (e.g. `utility`, `data-analyst`) |
| `uses`, `lastUsedAt` | ranking |

**Matching, cheapest first** (no vector database needed at this scale):
1. **Category rules** in the extension: keyword patterns map a question to a category
   ("why ... (work|join) ... (us|company|<company name>)" -> `why-company`). Free and instant.
2. **Fallback categoriser**: if no rule matches, one tiny AI call (fast model, ~20 output
   tokens) picks the category. Its result is cached per question text.
3. **Rank** saved answers in that category by: fits the character limit -> same role family
   -> most used -> most recent.

**Adapt with AI**: sends the saved answer + the new question + company + job description,
with the instruction "keep the substance and the facts, change company-specific details,
fit within N characters". Shorter prompt than a fresh draft, and more consistent.

**Placeholders**: saved answers can contain `{company}` and `{role}`; "Use as-is" fills
them in locally, with no AI call at all.

## Rules
- Nothing is saved automatically - saving is a checkbox on the Insert button
  ("Save to library"), on by default only after you've opted in once.
- Answers are the user's own text, so they sync like profiles and are deleted with the
  account ([[Flow - Delete account]]). Listed in [[Security and Privacy]] / `PRIVACY_POLICY.md`.
- The same self-ID refusal as profiles applies: answers are scanned for self-ID key names
  in structured fields (free text is the user's choice).
- Library hits do not count against the daily AI quota; "Adapt" and "New draft" do.

## Why it's a good portfolio item
It's a cost-optimisation pattern - **cache by meaning before calling the model** - built
from cheap parts (rules, then a tiny classifier, then the big model only when needed).
Measure it: log library-hit rate and AI calls avoided per week, and show the saving on the
[[F10 Insights]] dashboard.

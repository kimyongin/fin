---
name: news-research
description: Research and record Korea and U.S. market news for this portfolio app. Use when analyzing recent news, choosing concise primary sources, forming fact-versus-opinion records, or saving news through the portfolio MCP.
---

# News Research

Create compact, source-grounded Markdown news records that improve through review rather than accumulate commentary.

## Workflow

1. Define the date window, country (`KR` or `US`), and affected portfolio tags.
2. Read only relevant primary releases. Use one market-wire summary only for material events not covered by a release.
3. Separate confirmed facts from the portfolio-specific opinion. Do not present the opinion as a fact.
4. Skip days with no material change. Prefer 1–3 factual bullets and 1–2 opinion bullets.
5. Before saving, check for a duplicate record for the same country and event. Update the existing record when appropriate.
6. Use the portfolio MCP tools when connected:
   - `get_news_state` before deduplication or updates.
   - `save_news_record` for a new Markdown fact and optional Markdown opinion.
   - `get_strategy_state` before connecting an opinion to strategy buckets.
   - `save_strategy` only when the user explicitly asks to change the strategy.

## Source discipline

Read [references/sources.md](references/sources.md) before selecting sources. Use its smallest relevant source set; do not sweep generic news pages or chase related links.

## Record format

Use Markdown. Keep sources in the fact text when they materially support a claim.

```md
## Growth

- [BLS](https://www.bls.gov/) reported …
- Consensus changed from … to …

## Opinion

- Signal: neutral. This supports keeping the current U.S. equity target.
```

Use `fact` for the first section(s) only. Put the `Opinion` section in the MCP `opinion` field, not the fact field.

## Guardrails

- Do not use social posts, unsourced summaries, or a headline alone as a strategy signal.
- Do not change a strategy or execute trades merely because a news record was saved.
- State uncertainty and contradictory evidence briefly when material.
- Keep direct quotes short; summarize instead.

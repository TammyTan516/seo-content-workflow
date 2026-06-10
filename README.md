# SEO Workflow

This project runs the V2Fun SEO automation workflow against the Feishu spreadsheet.

## Setup

Create a local `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill the Feishu spreadsheet token and sheet IDs in `.env`. Do not commit `.env`.

The public sheet structure is documented in:

```txt
docs/feishu-sheet-template.md
```

Default AI provider is local Codex CLI login:

```env
AI_PROVIDER=codex
```

No API key is needed in this project when using Codex.

To configure a third-party OpenAI-compatible provider instead:

```bash
npm run setup:key
```

For third-party OpenAI-compatible providers, enter their base URL and model when prompted. The workflow calls:

```txt
POST {AI_BASE_URL}/chat/completions
```

Expected `.env` fields:

```env
AI_PROVIDER=compatible
AI_API_KEY=your_provider_key
AI_BASE_URL=https://your-provider.example.com/v1
AI_MODEL=your-model-name
```

Check Feishu auth:

```bash
npm run feishu:status
```

If needed, configure Feishu auth:

```bash
npm run feishu:config
```

## Run

```bash
npm run workflow
```

The workflow processes rows where:

- `Blog每日热点稿` has `Status` = `待评估`, and `Target Audience`, `Primary Keyword`, `Search Intent` are filled
- or `Blog每日热点稿` has `Status` = `不适合` after human review, and `Validation Issues` is not `信息来源不足`
- `SEO Status` is `待读取`
- or `Article Status` is `重新生成`

For `Blog每日热点稿`, the workflow searches current industry sources from the web, writes source metadata back to the row, generates a publish-ready SEO document, and syncs the final fields into `SEO配置`.

For `Blog审核`, it reads the source Feishu doc, validates required inputs, reads `SEO基础策略逻辑`, writes metadata to `SEO配置`, and creates an SEO revised document through Codex or a compatible AI provider.

## Blog每日热点稿

Human-filled fields:

- `Target Audience`
- `Primary Keyword`
- `Search Intent`
- `Status` = `待评估`

Workflow-filled fields:

- `Date`
- `Content ID`
- `Trending Keyword`
- `Topic`
- `Title`
- `Product Fit`
- `Validation Issues`
- `SEO Config Synced`
- `SEO Revised Doc URL`
- `SEO Revised Doc Token`
- `Source`
- `Source URL`
- `Source Title`
- `Source Summary`
- `Source Published Date`

Status flow:

```txt
待评估 -> 评估中 -> 生成中 -> 已同步
```

Failure or skip states:

```txt
不适合
生成失败
```

If a reviewer marks a generated hot-topic article as `不适合`, the next workflow run treats it as a regeneration request and overwrites the row with a new generated document/config. If the workflow itself marks the row as `不适合` because `Validation Issues` is `信息来源不足`, it will not retry automatically.

The current no-key source fetcher uses Product Hunt, Hacker News search, GDELT, and arXiv. Google News RSS can be enabled with `SEO_ENABLE_GOOGLE_NEWS=true`, but it is disabled by default because it may time out on some networks. `SEO_HOT_SOURCE_LIMIT` controls how many source items are passed into the article generator.

## Publishing Publicly

This repository is intended to be safe to publish as a reusable workflow template.

Before pushing to GitHub:

- Keep real spreadsheet tokens and sheet IDs only in `.env`.
- Keep `.env`, local screenshots, generated temp files, and logs out of git.
- Do not commit Feishu document URLs, generated article URLs, user mentions, or company-private strategy values.
- Share only the sheet headers/template in `docs/feishu-sheet-template.md`.

Each teammate should create their own `.env` with their Feishu spreadsheet token, sheet IDs, and local CLI settings.

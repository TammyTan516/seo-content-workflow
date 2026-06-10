# SEO Content Workflow

An automation workflow for managing SEO content production in Feishu/Lark spreadsheets.

It supports two common SEO content operations:

- **Hot-topic content generation**: start from a target audience, keyword, and search intent, then generate a new SEO-ready article.
- **Existing draft optimization**: start from an existing Feishu/Lark document, then rewrite and package it for SEO publishing.

The workflow writes all final publishing metadata into a central SEO configuration sheet, so teams can review, copy, and publish consistently.

---

## 中文说明

这是一个基于飞书/Lark 表格的 SEO 内容流程化自动更新项目。

它适合解决两类常见工作：

- **每日热点稿**：根据目标受众、主关键词、搜索意图，自动抓取近期行业信息并生成新的 SEO 文章。
- **已有稿件润色**：读取已有飞书文档或 PR 稿，对文章进行 SEO 优化、生成发布格式，并同步配置字段。

最终产出的 SEO 标题、Meta Description、关键词、发布路径、LLM Summary、文章文档链接等都会统一写入 `SEO配置` 页面，方便团队复制到网站后台。

---

## Features

- Feishu/Lark spreadsheet based workflow queue
- Hot-topic SEO article generation
- Existing blog/PR draft SEO optimization
- Publish-ready Feishu/Lark document creation
- Centralized SEO configuration output
- Regeneration flow for rejected content
- Local `.env` based private configuration
- No hardcoded spreadsheet tokens in the public repo
- Works with local Codex CLI auth by default
- Supports OpenAI-compatible API providers as an alternative

---

## Workflow Overview / 流程总览

| Sheet | Purpose | Use Case |
| --- | --- | --- |
| `Blog每日热点稿` | Generate new SEO articles from keywords and current sources | No existing article; create a fresh SEO post |
| `Blog审核` | Rewrite existing articles for SEO | Existing draft, blog post, or PR article |
| `SEO配置` | Collect final publishing fields | Copy fields into a CMS/backend |
| `SEO基础策略逻辑` | Store global SEO strategy | Brand rules, keyword rules, product positioning |
| `使用规则` | Team SOP | Human-readable operating guide |

---

## Repository Safety / 公开仓库安全说明

This repository is designed to be published as a reusable template.

Do **not** commit:

- `.env`
- Real Feishu/Lark spreadsheet tokens
- Real sheet IDs
- Private Feishu/Lark document links
- Generated article links
- User mentions or personal account identifiers
- Company-private SEO strategy values

The public sheet structure is documented here:

```txt
docs/feishu-sheet-template.md
```

真实的飞书表格 token、sheet id、内部文档链接只应该保存在本地 `.env` 中，不要提交到 GitHub。

---

## Requirements

- Node.js 18+
- Feishu/Lark CLI access via `@larksuite/cli`
- A Feishu/Lark spreadsheet matching the required sheet headers
- Codex CLI login, or an OpenAI-compatible API provider

---

## Installation / 安装

Clone the repository:

```bash
git clone https://github.com/TammyTan516/seo-content-workflow.git
cd seo-content-workflow
```

Install dependencies:

```bash
npm install
```

Create local config:

```bash
cp .env.example .env
```

Fill in your own Feishu/Lark spreadsheet settings in `.env`:

```env
SEO_SPREADSHEET_TOKEN=your_feishu_spreadsheet_token
SEO_HOT_SHEET_ID=your_hot_topic_sheet_id
SEO_BLOG_SHEET_ID=your_blog_review_sheet_id
SEO_CONFIG_SHEET_ID=your_seo_config_sheet_id
SEO_STRATEGY_SHEET_ID=your_strategy_sheet_id
```

---

## Feishu/Lark Setup / 飞书授权

Check auth status:

```bash
npm run feishu:status
```

Configure or refresh auth:

```bash
npm run feishu:config
```

Your Feishu/Lark user must have permission to read and write the target spreadsheet and create documents.

---

## AI Provider Setup / AI 配置

Default mode uses local Codex CLI auth:

```env
AI_PROVIDER=codex
```

No API key is needed when using Codex CLI.

To use an OpenAI-compatible provider instead:

```bash
npm run setup:key
```

Expected fields:

```env
AI_PROVIDER=compatible
AI_API_KEY=your_provider_key
AI_BASE_URL=https://your-provider.example.com/v1
AI_MODEL=your-model-name
```

---

## Run the Workflow / 运行工作流

```bash
npm run workflow
```

The workflow processes:

- `Blog每日热点稿` rows where `Status = 待评估` and `Target Audience`, `Primary Keyword`, `Search Intent` are filled
- `Blog每日热点稿` rows where `Status = 不适合`, if the row was manually rejected and should be regenerated
- `Blog审核` rows where `SEO Status = 待读取`
- `Blog审核` rows where `Article Status = 重新生成`

---

## Blog Daily Hot Topics / Blog每日热点稿

Use this sheet when you want to generate a new SEO article from a keyword idea.

Human-maintained fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `Target Audience` | Dropdown | Yes | Target reader segment |
| `Primary Keyword` | Text | Yes | Main SEO keyword |
| `Search Intent` | Dropdown | Yes | Comparative, Informational, Commercial, Tutorial, etc. |
| `Status` | Dropdown | Yes | Set to `待评估` to start |

Workflow-filled fields include:

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

Status flow:

```txt
待评估 -> 评估中 -> 生成中 -> 已同步
```

If the generated article is not suitable:

```txt
Set Status = 不适合, then run npm run workflow again.
```

---

## Blog Review / Blog审核

Use this sheet when you already have a draft article or PR content.

Human-maintained fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `Blog Doc URL` | Feishu/Lark doc link | Yes | Source article |
| `Primary Keyword` | Text | Yes | Main SEO keyword |
| `Search Intent` | Dropdown | Yes | Search intent |
| `Reviewer` | Mention/name | Recommended | Reviewer |
| `Review note` | Text | Optional | Special instructions |
| `SEO Status` | Dropdown | Yes | Set to `待读取` to start |

Regeneration:

```txt
Set Article Status = 重新生成, then run npm run workflow again.
```

Completion:

```txt
SEO Status = 已同步
Article Status = 已通过
Final Approved = 通过 / 已通过
SEO Revised Doc URL is filled
```

---

## SEO Config / SEO配置

This is the final publishing output sheet.

The workflow writes:

- `SEO URL`
- `SEO Title`
- `Meta Description`
- `Keywords`
- `Secondary Keywords`
- `LLM Summary`
- `Source Title`
- `Source Content Snapshot`
- `Last Source Sync Time`
- `Last SEO Generated Time`
- `Blog Doc Token`

After copying fields into your CMS/backend, manually set:

```txt
Status = 已配置
```

That marks the case as finished.

---

## Source Fetching / 热点来源

The no-key source fetcher currently uses:

- Product Hunt
- Hacker News Search
- GDELT
- arXiv

Google News RSS can be enabled:

```env
SEO_ENABLE_GOOGLE_NEWS=true
```

It is disabled by default because it may time out on some networks.

Control how many sources are passed to the generator:

```env
SEO_HOT_SOURCE_LIMIT=6
```

---

## Team Usage SOP / 团队使用 SOP

1. Choose the right sheet:
   - New hot-topic article: `Blog每日热点稿`
   - Existing draft optimization: `Blog审核`
2. Fill the required human fields.
3. Set the trigger status:
   - `Blog每日热点稿`: `Status = 待评估`
   - `Blog审核`: `SEO Status = 待读取`
4. Run:

```bash
npm run workflow
```

5. Review the generated `SEO Revised Doc URL`.
6. If the result is not suitable:
   - Hot-topic article: set `Status = 不适合`
   - Existing draft: set `Article Status = 重新生成`
7. Run the workflow again.
8. When approved, copy fields from `SEO配置` into your CMS/backend.
9. Set `SEO配置 Status = 已配置`.

---

## Privacy Checklist Before Publishing / 发布前隐私检查

Before pushing changes to a public repository:

```bash
git status --short --ignored
```

Make sure these are not staged:

- `.env`
- `tmp/`
- screenshots
- private Feishu/Lark links
- real spreadsheet tokens or sheet IDs

Optional scan:

```bash
rg -n \"feishu.cn|larksuite|SEO_SPREADSHEET_TOKEN|your_company_domain\" .
```

---

## License

Add a license before wider public adoption if you want others to reuse, fork, or contribute formally.

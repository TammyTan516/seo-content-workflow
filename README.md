<div align="center">

# SEO Content Workflow

**Feishu/Lark based SEO content automation for hot-topic articles, manuscript review, and publishing metadata.**

**基于飞书/Lark 表格的 SEO 内容自动化工作流：热点稿生成、稿件审核润色、发布配置汇总。**

[中文](#中文) · [English](#english)

</div>

---

## 中文

### 项目简介

SEO Content Workflow 是一个面向内容团队的本地自动化项目。它用飞书/Lark 表格作为任务队列和审核台，通过 Codex CLI 或 OpenAI-compatible API 生成中英双语 SEO 内容，并将最终可发布字段同步到统一的 `SEO配置` 页面。

它适合两类内容流程：

- **Blog每日热点稿**：从目标受众、主关键词、搜索意图出发，自动抓取近期行业信息，并生成新的 SEO 文章。
- **稿件审核**：读取已有飞书文档、Blog 草稿或 PR 稿，进行 SEO 润色和发布格式整理。

最终产出包括 SEO URL、SEO Title、Meta Description、关键词、LLM Summary、可发布飞书文档链接等。`SEO Revised Doc URL` 会生成一个双语发布包，里面分别包含英文 CMS 正文和中文 CMS 正文，方便团队复制到对应语言的网站后台。

> 本项目是公开模板。真实飞书 token、sheet id、内部文档链接和公司策略必须放在本地 `.env`，不要提交到 GitHub。

[安装](#安装) · [表格结构](#表格结构) · [运行流程](#运行流程) · [团队-sop](#团队-sop) · [隐私安全](#隐私安全)

---

### 核心能力

| 能力 | 说明 |
| --- | --- |
| 热点稿生成 | 根据 `Target Audience`、`Primary Keyword`、`Search Intent` 自动生成中英双语 SEO 稿 |
| 稿件审核润色 | 读取已有飞书文档，输出中英双语 SEO 优化发布文档 |
| 统一 SEO 配置 | 自动写入 SEO URL、标题、描述、关键词、摘要等字段 |
| 可重生成 | 对不满意的热点稿或审核稿，可通过状态字段触发重新生成 |
| 自动文档权限 | 生成的飞书文档可自动设置为链接可编辑，取决于租户策略 |
| 本地私有配置 | 所有真实 token 和 sheet id 都保存在 `.env` |

---

### 安装

克隆仓库：

```bash
git clone https://github.com/TammyTan516/seo-content-workflow.git
cd seo-content-workflow
```

安装依赖：

```bash
npm install
```

创建本地配置：

```bash
cp .env.example .env
```

在 `.env` 中填入你自己的飞书表格配置：

```env
SEO_SPREADSHEET_TOKEN=your_feishu_spreadsheet_token
SEO_HOT_SHEET_ID=your_hot_topic_sheet_id
SEO_BLOG_SHEET_ID=your_manuscript_review_sheet_id
SEO_CONFIG_SHEET_ID=your_seo_config_sheet_id
SEO_STRATEGY_SHEET_ID=your_strategy_sheet_id
```

如果你是从旧版本升级，且运行时报 `Missing required config SEO_HOT_SHEET_ID`，说明本地 `.env` 少了新增的热点稿 sheet id。请从 `.env.example` 复制这一行到自己的 `.env`，并填入你自己的 `Blog每日热点稿` sheet id：

```env
SEO_HOT_SHEET_ID=your_hot_topic_sheet_id
```

表头模板见：

```txt
docs/feishu-sheet-template.md
```

---

### 飞书授权

检查授权状态：

```bash
npm run feishu:status
```

配置或刷新授权：

```bash
npm run feishu:config
```

当前飞书账号需要具备以下权限：

- 读取和写入目标飞书表格
- 读取已有飞书文档
- 创建新的飞书文档
- 如需自动设置生成文档的分享权限，需要文档权限设置能力

生成文档默认可配置为“获得链接的人可编辑”：

```env
SEO_REVISED_DOC_PUBLIC_ACCESS=true
SEO_REVISED_DOC_LINK_SHARE_ENTITY=anyone_editable
```

可选分享权限：

```txt
tenant_readable
tenant_editable
anyone_readable
anyone_editable
closed
```

如果组织安全策略禁止对外分享，飞书 API 会拒绝更新权限；这种情况需要租户管理员调整组织策略，代码无法绕过。

---

### AI 配置

默认使用本地 Codex CLI 登录：

```env
AI_PROVIDER=codex
```

使用 Codex CLI 时不需要在项目里写 API key。

如需改用 OpenAI-compatible API：

```bash
npm run setup:key
```

对应配置：

```env
AI_PROVIDER=compatible
AI_API_KEY=your_provider_key
AI_BASE_URL=https://your-provider.example.com/v1
AI_MODEL=your-model-name
```

---

### 表格结构

| Sheet | 作用 | 适用场景 |
| --- | --- | --- |
| `Blog每日热点稿` | 从关键词和行业来源生成新 SEO 稿 | 没有现成文章，需要从 0 生成 |
| `稿件审核` | 对已有稿件做 SEO 润色 | 已有 Blog、PR 稿、同事草稿 |
| `SEO配置` | 汇总最终可发布字段 | 复制到 CMS 或网站后台 |
| `SEO基础策略逻辑` | 维护全局 SEO 策略 | 品牌表述、关键词规则、产品边界 |
| `使用规则` | 团队内部 SOP | 告诉团队如何填写、审核、结束 case |

详细字段模板见 [docs/feishu-sheet-template.md](docs/feishu-sheet-template.md)。

---

### 运行流程

运行工作流：

```bash
npm run workflow
```

工作流会处理以下行：

- `Blog每日热点稿` 中 `Status = 待评估`，且 `Target Audience`、`Primary Keyword`、`Search Intent` 已填写
- `Blog每日热点稿` 中人工标记为 `Status = 不适合` 的行，用于重新生成
- `稿件审核` 中 `SEO Status = 待读取` 的行
- `稿件审核` 中 `Article Status = 重新生成` 的行

生成的 `SEO Revised Doc URL` 默认是双语发布包：

- `COPY TO CMS - English Blog Body Only`：复制到英文站正文
- `复制到 CMS - 中文正文 Only`：复制到中文站正文
- `CONFIG TABLE - English CMS Fields`：英文站 SEO 配置
- `配置表 - 中文 CMS 字段`：中文站 SEO 配置

---

### Blog每日热点稿

人工填写：

| 字段 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `Target Audience` | 下拉 | 必填 | 目标用户群体 |
| `Primary Keyword` | 文本 | 必填 | 主关键词，建议 1-2 个 |
| `Search Intent` | 下拉 | 必填 | 搜索意图，如 Comparative、Informational、Tutorial |
| `Status` | 下拉 | 必填 | 设置为 `待评估` 后开始生成 |

系统输出：

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

状态流转：

```txt
待评估 -> 评估中 -> 生成中 -> 已同步
```

如果结果不合适：

```txt
把 Status 改成 不适合，然后重新运行 npm run workflow
```

---

### 稿件审核

人工填写：

| 字段 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `Blog Doc URL` | 飞书文档链接 | 必填 | 原始文章 |
| `Primary Keyword` | 文本 | 必填 | 主关键词 |
| `Search Intent` | 下拉 | 必填 | 搜索意图 |
| `Reviewer` | 人员或文本 | 建议填写 | 审核人 |
| `Review note` | 文本 | 可选 | 特殊修改要求 |
| `SEO Status` | 下拉 | 必填 | 设置为 `待读取` 后开始处理 |

如果需要重新生成：

```txt
把 Article Status 改成 重新生成，然后重新运行 npm run workflow
```

结束标准：

```txt
SEO Status = 已同步
Article Status = 已通过
Final Approved = 通过 / 已通过
SEO Revised Doc URL 已生成
SEO配置 页面已出现对应内容
```

---

### SEO配置

`SEO配置` 是最终发布配置汇总页。工作流会写入：

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

当你已经把字段复制到网站后台后，手动设置：

```txt
Status = 已配置
```

这代表该 case 结束。

---

### 热点来源

当前无 key 来源包括：

- Product Hunt
- Hacker News Search
- GDELT
- arXiv

可选开启 Google News RSS：

```env
SEO_ENABLE_GOOGLE_NEWS=true
```

控制传入生成器的来源数量：

```env
SEO_HOT_SOURCE_LIMIT=6
```

---

### 团队 SOP

1. 选择入口：
   - 没有现成文章：使用 `Blog每日热点稿`
   - 已有稿件：使用 `稿件审核`
2. 填写黄色字段。
3. 设置启动状态：
   - `Blog每日热点稿`：`Status = 待评估`
   - `稿件审核`：`SEO Status = 待读取`
4. 运行：

```bash
npm run workflow
```

5. 打开生成的 `SEO Revised Doc URL` 审核文章。
6. 如果不满意：
   - 热点稿：`Status = 不适合`
   - 稿件审核：`Article Status = 重新生成`
7. 再次运行工作流。
8. 审核通过后，到 `SEO配置` 复制字段到网站后台。
9. 后台配置完成后，将 `SEO配置 Status` 改成 `已配置`。

---

### 隐私安全

推送到公开仓库前检查：

```bash
git status --short --ignored
```

不要提交：

- `.env`
- `tmp/`
- 截图
- 真实飞书表格 token
- 真实 sheet id
- 私有飞书文档链接
- 公司内部 SEO 策略

可选扫描：

```bash
rg -n "feishu.cn|larksuite|SEO_SPREADSHEET_TOKEN|your_company_domain" .
```

---

## English

### Overview

SEO Content Workflow is a local automation project for content teams. It uses Feishu/Lark spreadsheets as the workflow queue and review surface, then uses Codex CLI or an OpenAI-compatible API to generate bilingual English/Chinese SEO content and sync publishing fields into a central SEO configuration sheet.

It supports two main workflows:

- **Daily hot-topic articles**: generate new SEO posts from a target audience, primary keyword, and search intent.
- **Manuscript review**: rewrite existing Feishu/Lark documents, blog drafts, or PR articles into SEO-ready content.

The final output includes SEO URL, SEO title, meta description, keywords, LLM summary, and a publish-ready Feishu/Lark document link. `SEO Revised Doc URL` contains a bilingual publishing package with separate English and Chinese CMS body sections.

> This is a public template. Keep real Feishu/Lark tokens, sheet IDs, private document links, and company strategy in your local `.env`.

[Install](#install) · [Sheet Structure](#sheet-structure) · [Run](#run) · [Team SOP](#team-sop) · [Privacy](#privacy)

---

### Features

| Feature | Description |
| --- | --- |
| Hot-topic generation | Create new bilingual SEO articles from audience, keyword, and intent |
| Manuscript optimization | Rewrite existing drafts into bilingual SEO-ready publishing packages |
| Central SEO config | Sync SEO URL, title, description, keywords, and summary |
| Regeneration flow | Regenerate rejected articles through spreadsheet status fields |
| Document permission update | Optionally make generated docs editable by anyone with the link |
| Local private config | Keep all real tokens and sheet IDs in `.env` |

---

### Install

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

Fill your Feishu/Lark spreadsheet settings in `.env`:

```env
SEO_SPREADSHEET_TOKEN=your_feishu_spreadsheet_token
SEO_HOT_SHEET_ID=your_hot_topic_sheet_id
SEO_BLOG_SHEET_ID=your_manuscript_review_sheet_id
SEO_CONFIG_SHEET_ID=your_seo_config_sheet_id
SEO_STRATEGY_SHEET_ID=your_strategy_sheet_id
```

If you are upgrading from an older version and see `Missing required config SEO_HOT_SHEET_ID`, your local `.env` is missing the newly added hot-topic sheet id. Copy this line from `.env.example` into your own `.env` and fill it with your `Blog每日热点稿` sheet id:

```env
SEO_HOT_SHEET_ID=your_hot_topic_sheet_id
```

See the public sheet template:

```txt
docs/feishu-sheet-template.md
```

---

### Feishu/Lark Authorization

Check auth status:

```bash
npm run feishu:status
```

Configure or refresh auth:

```bash
npm run feishu:config
```

Your Feishu/Lark user needs permission to read and write the target spreadsheet, read source documents, create new documents, and optionally update document sharing settings.

Generated document permission settings:

```env
SEO_REVISED_DOC_PUBLIC_ACCESS=true
SEO_REVISED_DOC_LINK_SHARE_ENTITY=anyone_editable
```

Supported link sharing values:

```txt
tenant_readable
tenant_editable
anyone_readable
anyone_editable
closed
```

`anyone_editable` means anyone with the link can edit, if your tenant security policy allows external sharing.

---

### AI Provider

Default mode uses local Codex CLI auth:

```env
AI_PROVIDER=codex
```

No API key is needed for Codex CLI mode.

To use an OpenAI-compatible provider:

```bash
npm run setup:key
```

Expected config:

```env
AI_PROVIDER=compatible
AI_API_KEY=your_provider_key
AI_BASE_URL=https://your-provider.example.com/v1
AI_MODEL=your-model-name
```

---

### Sheet Structure

| Sheet | Purpose | Use case |
| --- | --- | --- |
| `Blog每日热点稿` | Generate new SEO articles | No existing article; start from keyword ideas |
| `稿件审核` | Optimize existing drafts | Existing blog, PR article, or teammate draft |
| `SEO配置` | Collect final publishing fields | Copy into CMS/backend |
| `SEO基础策略逻辑` | Store global SEO strategy | Brand rules, keyword rules, product boundaries |
| `使用规则` | Team SOP | Explain how to operate the workflow |

Detailed headers are listed in [docs/feishu-sheet-template.md](docs/feishu-sheet-template.md).

---

### Run

```bash
npm run workflow
```

The workflow processes:

- `Blog每日热点稿` rows with `Status = 待评估` and filled `Target Audience`, `Primary Keyword`, `Search Intent`
- `Blog每日热点稿` rows manually marked as `Status = 不适合`, for regeneration
- `稿件审核` rows with `SEO Status = 待读取`
- `稿件审核` rows with `Article Status = 重新生成`

The generated `SEO Revised Doc URL` is a bilingual publishing package:

- `COPY TO CMS - English Blog Body Only`: paste into the English CMS page
- `复制到 CMS - 中文正文 Only`: paste into the Chinese CMS page
- `CONFIG TABLE - English CMS Fields`: English SEO metadata
- `配置表 - 中文 CMS 字段`: Chinese SEO metadata

---

### Daily Hot Topics

Human-maintained fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `Target Audience` | Dropdown | Yes | Target reader segment |
| `Primary Keyword` | Text | Yes | Main SEO keyword |
| `Search Intent` | Dropdown | Yes | Comparative, Informational, Tutorial, etc. |
| `Status` | Dropdown | Yes | Set to `待评估` to start |

Status flow:

```txt
待评估 -> 评估中 -> 生成中 -> 已同步
```

To regenerate:

```txt
Set Status = 不适合, then run npm run workflow again.
```

---

### Manuscript Review

Human-maintained fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `Blog Doc URL` | Feishu/Lark doc link | Yes | Source article |
| `Primary Keyword` | Text | Yes | Main SEO keyword |
| `Search Intent` | Dropdown | Yes | Search intent |
| `Reviewer` | Mention/name | Recommended | Reviewer |
| `Review note` | Text | Optional | Special instructions |
| `SEO Status` | Dropdown | Yes | Set to `待读取` to start |

To regenerate:

```txt
Set Article Status = 重新生成, then run npm run workflow again.
```

Completion:

```txt
SEO Status = 已同步
Article Status = 已通过
Final Approved = 通过 / 已通过 / Approved
SEO Revised Doc URL is filled
SEO配置 has the matching row
```

---

### SEO Config

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

After copying fields into your CMS/backend:

```txt
Set Status = 已配置
```

---

### Source Fetching

No-key sources:

- Product Hunt
- Hacker News Search
- GDELT
- arXiv

Enable Google News RSS:

```env
SEO_ENABLE_GOOGLE_NEWS=true
```

Limit source count:

```env
SEO_HOT_SOURCE_LIMIT=6
```

---

### Team SOP

1. Choose a sheet:
   - New article: `Blog每日热点稿`
   - Existing draft: `稿件审核`
2. Fill the human-maintained fields.
3. Set the trigger status.
4. Run:

```bash
npm run workflow
```

5. Review the generated `SEO Revised Doc URL`.
6. If the result is not suitable, mark it for regeneration.
7. Run the workflow again.
8. Copy final fields from `SEO配置` into your CMS/backend.
9. Set `SEO配置 Status = 已配置`.

---

### Privacy

Before pushing to a public repository:

```bash
git status --short --ignored
```

Do not commit:

- `.env`
- `tmp/`
- screenshots
- real Feishu/Lark spreadsheet tokens
- real sheet IDs
- private Feishu/Lark document links
- company-private SEO strategy

Optional scan:

```bash
rg -n "feishu.cn|larksuite|SEO_SPREADSHEET_TOKEN|your_company_domain" .
```

---

## License

Add a license before wider public adoption if you want others to reuse, fork, or contribute formally.

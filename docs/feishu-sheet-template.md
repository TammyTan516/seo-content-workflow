# Feishu Sheet Template

Create one Feishu spreadsheet with these sheets and headers. Sheet IDs are private to each workspace; after creating the sheets, put each sheet ID in `.env`.

## Blog Daily Hot Topics

Sheet name suggestion: `Blog每日热点稿`

| Column | Header | Maintained by | Notes |
| --- | --- | --- | --- |
| A | Date | Workflow | Current date. |
| B | Content ID | Workflow | Stable content key. |
| C | Target Audience | Human | Required. Dropdown recommended. |
| D | Primary Keyword | Human | Required. One or two primary keywords. |
| E | Search Intent | Human | Required. Dropdown recommended. |
| F | Status | Human / Workflow | Set to `待评估` to start. Set to `不适合` to regenerate after review. |
| G | Trending Keyword | Workflow | Source keyword or generated trend keyword. |
| H | Topic | Workflow | Generated topic angle. |
| I | Title | Workflow | Generated article title. |
| J | Product Fit | Workflow | Why this topic fits the product. |
| K | Validation Issues | Workflow | `无问题`, `信息来源不足`, or failure details. |
| L | SEO Config Synced | Workflow | `未同步`, `同步中`, `已同步`, `同步失败`, `无需同步`. |
| M | SEO Revised Doc URL | Workflow | Generated publish-ready Feishu doc. |
| N | SEO Revised Doc Token | Workflow | Generated doc token. |
| O | Source | Workflow | Source names. |
| P | Source URL | Workflow | Source links. |
| Q | Source Title | Workflow | Source titles. |
| R | Source Summary | Workflow | Source summaries for quick review. |

Recommended `Status` dropdown:

```txt
待评估
评估中
待生成
生成中
已生成
已同步
不适合
生成失败
```

## Blog Review

Sheet name suggestion: `Blog审核`

| Column | Header | Maintained by | Notes |
| --- | --- | --- | --- |
| A | Date | Workflow | Current date. |
| B | Content ID | Workflow | Stable content key. |
| C | Blog Doc URL | Human | Required source Feishu document. |
| D | Primary Keyword | Human | Required. |
| E | Search Intent | Human | Required. Dropdown recommended. |
| F | Reviewer | Human | Reviewer mention/name. |
| G | Review note | Human | Optional editing instruction. |
| H | SEO Status | Human / Workflow | Set to `待读取` to start. |
| I | Article Status | Human / Workflow | Set to `重新生成` to regenerate. |
| J | Validation Status | Workflow | Validation result. |
| K | Validation Issues | Workflow | Validation details. |
| L | Final Approved | Human | Final approval state. |
| M | SEO Revised Doc URL | Workflow | Generated publish-ready Feishu doc. |
| N | SEO Revised Doc Token | Workflow | Generated doc token. |
| O | Blog Doc Token | Workflow | Source document token. |

Recommended `SEO Status` dropdown:

```txt
待读取
读取中
待生成
生成中
已同步
生成失败
```

Recommended `Article Status` dropdown:

```txt
未生成
待审核
重新生成
已通过
```

## SEO Config

Sheet name suggestion: `SEO配置`

| Column | Header | Maintained by | Notes |
| --- | --- | --- | --- |
| A | Date | Workflow | Current date. |
| B | Content ID | Workflow | Stable content key. |
| C | Blog Doc URL | Workflow | Source or generated doc URL. |
| D | Status | Human / Workflow | Workflow writes `待配置`; human changes to `已配置` after CMS work. |
| E | SEO URL | Workflow | Suggested URL path. |
| F | SEO Title | Workflow | SEO title. |
| G | Meta Description | Workflow | Meta description. |
| H | Keywords | Workflow | Primary and related keywords. |
| I | Secondary Keywords | Workflow | Secondary keywords. |
| J | LLM Summary | Workflow | LLM-facing summary. |
| K | Source Title | Workflow | Source or generated title. |
| L | SEO Revised Article | Workflow | Placeholder pointing to generated doc. |
| M | Publish Format Output | Workflow | Placeholder pointing to generated doc. |
| N | Source Content Snapshot | Workflow | Source brief or source article snapshot. |
| O | Last Source Sync Time | Workflow | ISO timestamp. |
| P | Last SEO Generated Time | Workflow | ISO timestamp. |
| Q | Blog Doc Token | Workflow | Source or generated doc token. |

Recommended `Status` dropdown:

```txt
待配置
已配置
无需配置
配置失败
```

## SEO Strategy

Sheet name suggestion: `SEO基础策略逻辑`

| Column | Header | Maintained by | Notes |
| --- | --- | --- | --- |
| A | Strategy Key | Human | Strategy item name. |
| B | Value | Human | Strategy content. |
| C | Applies To | Human | Where this rule applies. |
| D | Editable By | Human | Owner or role. |
| E | AI Usage | Human | How AI should use this rule. |
| F | Notes | Human | Extra notes. |

## Usage Rules

Sheet name suggestion: `使用规则`

This sheet is optional but recommended. Use it to document your team's SOP, human fields, workflow fields, dropdown states, and terminal commands.

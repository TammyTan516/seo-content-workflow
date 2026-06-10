import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const env = readDotEnv(path.join(rootDir, ".env"));

const SPREADSHEET_TOKEN = requiredConfig("SEO_SPREADSHEET_TOKEN");
const HOT_SHEET_ID = requiredConfig("SEO_HOT_SHEET_ID");
const BLOG_SHEET_ID = requiredConfig("SEO_BLOG_SHEET_ID");
const SEO_SHEET_ID = requiredConfig("SEO_CONFIG_SHEET_ID");
const STRATEGY_SHEET_ID = requiredConfig("SEO_STRATEGY_SHEET_ID");
const MAX_ROWS = Number(process.env.SEO_MAX_ROWS || env.SEO_MAX_ROWS || 200);
const HOT_SOURCE_LIMIT = Number(process.env.SEO_HOT_SOURCE_LIMIT || env.SEO_HOT_SOURCE_LIMIT || 6);
const ENABLE_GOOGLE_NEWS = (process.env.SEO_ENABLE_GOOGLE_NEWS || env.SEO_ENABLE_GOOGLE_NEWS || "false").toLowerCase() === "true";
const AI_PROVIDER = (process.env.AI_PROVIDER || env.AI_PROVIDER || "codex").toLowerCase();
const AI_BASE_URL = normalizeBaseUrl(process.env.AI_BASE_URL || env.AI_BASE_URL || process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1");
const AI_MODEL = process.env.AI_MODEL || env.AI_MODEL || process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_API_KEY = process.env.AI_API_KEY || env.AI_API_KEY || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
const CODEX_MODEL = process.env.CODEX_MODEL || env.CODEX_MODEL || "";
const REVISED_DOC_PARENT_TOKEN = process.env.SEO_REVISED_DOC_PARENT_TOKEN || env.SEO_REVISED_DOC_PARENT_TOKEN || "";
const FEISHU_DOC_BASE_URL = (process.env.FEISHU_DOC_BASE_URL || env.FEISHU_DOC_BASE_URL || "https://www.feishu.cn/docx").replace(/\/+$/, "");
const REVISED_DOC_PUBLIC_ACCESS = (process.env.SEO_REVISED_DOC_PUBLIC_ACCESS || env.SEO_REVISED_DOC_PUBLIC_ACCESS || "true").toLowerCase() === "true";
const REVISED_DOC_LINK_SHARE_ENTITY = process.env.SEO_REVISED_DOC_LINK_SHARE_ENTITY || env.SEO_REVISED_DOC_LINK_SHARE_ENTITY || "anyone_editable";

const larkCli = await resolveLarkCli();

const hotRows = await readRange(`${HOT_SHEET_ID}!A1:AB${MAX_ROWS}`);
const hotHeader = headerMap(hotRows[0] || []);
const blogRows = await readRange(`${BLOG_SHEET_ID}!A1:AB${MAX_ROWS}`);
const blogHeader = headerMap(blogRows[0] || []);
let seoRows = await readRange(`${SEO_SHEET_ID}!A1:AB${MAX_ROWS}`);
const seoHeader = headerMap(seoRows[0] || []);
const strategyRows = await readRange(`${STRATEGY_SHEET_ID}!A1:F${MAX_ROWS}`);
const strategy = parseStrategy(strategyRows);

const resetRowArg = process.argv.find((arg) => arg.startsWith("--reset-row="));
if (resetRowArg) {
  const rowNumber = Number(resetRowArg.split("=")[1]);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("--reset-row must be a row number >= 2");
  }
  await writeFields(BLOG_SHEET_ID, blogHeader, rowNumber, {
    "SEO Status": "待读取",
    "Article Status": "未生成",
    "Validation Status": "未校验",
    "Validation Issues": "",
  });
  console.log(`Reset row ${rowNumber} to SEO Status=待读取.`);
  process.exit(0);
}

const updates = [];

for (let index = 1; index < hotRows.length; index += 1) {
  const rowNumber = index + 1;
  const row = hotRows[index] || [];
  const status = cellText(row, hotHeader, "Status");
  const targetAudience = cellInlineText(row, hotHeader, "Target Audience");
  const primaryKeyword = cellInlineText(row, hotHeader, "Primary Keyword");
  const searchIntent = cellInlineText(row, hotHeader, "Search Intent");
  const validationIssues = cellInlineText(row, hotHeader, "Validation Issues");

  if (!shouldProcessHotStatus(status, validationIssues)) continue;
  if (!targetAudience || !primaryKeyword || !searchIntent) continue;

  updates.push(await processHotRow(rowNumber, row));
}

for (let index = 1; index < blogRows.length; index += 1) {
  const rowNumber = index + 1;
  const row = blogRows[index] || [];
  const seoStatus = cellText(row, blogHeader, "SEO Status");
  const articleStatus = cellText(row, blogHeader, "Article Status");

  if (seoStatus !== "待读取" && articleStatus !== "重新生成") continue;

  updates.push(await processRow(rowNumber, row));
}

if (updates.length === 0) {
  console.log("No rows matched Blog每日热点稿 Status=待评估/不适合 with required inputs, or 稿件审核 SEO Status=待读取 / Article Status=重新生成.");
} else {
  console.log(`Processed ${updates.length} row(s):`);
  for (const update of updates) console.log(`- Row ${update.rowNumber}: ${update.summary}`);
}

async function processHotRow(rowNumber, row) {
  const targetAudience = cellInlineText(row, hotHeader, "Target Audience");
  const primaryKeyword = cellInlineText(row, hotHeader, "Primary Keyword");
  const searchIntent = cellInlineText(row, hotHeader, "Search Intent");
  const existingDate = cellText(row, hotHeader, "Date");
  const currentDate = existingDate || todayShanghai();

  await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
    "Date": currentDate,
    "Status": "评估中",
    "SEO Config Synced": "未同步",
    "Validation Issues": "",
  });

  try {
    const sources = await searchHotSources({
      targetAudience,
      primaryKeyword,
      searchIntent,
      date: currentDate,
    });

    if (sources.length === 0) {
      await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
        "Status": "不适合",
        "Validation Issues": "信息来源不足",
        "SEO Config Synced": "无需同步",
      });
      return {
        rowNumber,
        summary: "hot topic skipped: no usable current sources",
      };
    }

    const sourceMarkdown = buildHotSourceMarkdown({ targetAudience, primaryKeyword, searchIntent, sources, date: currentDate });
    const sourceTitle = cellText(row, hotHeader, "Title") || `${primaryKeyword} trends for ${targetAudience}`;

    await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
      "Trending Keyword": cellText(row, hotHeader, "Trending Keyword") || sources[0]?.keyword || primaryKeyword,
      "Topic": cellText(row, hotHeader, "Topic") || sources[0]?.topic || primaryKeyword,
      "Title": sourceTitle,
      "Product Fit": "待生成后确认",
      "Validation Issues": "无问题",
      "Status": "生成中",
      "Source": summarizeSources(sources, "source"),
      "Source URL": summarizeSources(sources, "url"),
      "Source Title": summarizeSources(sources, "title"),
      "Source Summary": summarizeSources(sources, "summary"),
      "Source Published Date": summarizeSources(sources, "publishedAt"),
    });

    if (AI_PROVIDER !== "codex" && !AI_API_KEY) {
      await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
        "Status": "待生成",
        "Validation Issues": "AI_API_KEY 未配置",
      });
      return {
        rowNumber,
        summary: "hot topic evaluated; AI_API_KEY is not set",
      };
    }

    const generatedRaw = await generateSeoPackage({
      strategy,
      sourceMarkdown,
      sourceTitle,
      primaryKeyword,
      searchIntent,
      reviewNote: `Create a fresh SEO blog article for target audience: ${targetAudience}. Use only the provided current source notes and the global V2Fun SEO strategy. Include product fit naturally; do not invent unsupported claims.`,
      seoUrl: "",
    });
    const finalSeoUrl = resolveSeoUrl(generatedRaw);
    const generated = {
      ...generatedRaw,
      seo_url: finalSeoUrl,
      suggested_url: generatedRaw.suggested_url || finalSeoUrl,
      suggested_slug: generatedRaw.suggested_slug || slugFromUrl(finalSeoUrl),
      target_audience: generatedRaw.target_audience || targetAudience,
      primary_keyword: generatedRaw.primary_keyword || primaryKeyword,
      search_intent: generatedRaw.search_intent || searchIntent,
    };
    const contentId = cellText(row, hotHeader, "Content ID") || buildContentId({ seoUrl: finalSeoUrl, docToken: "", sourceTitle: generated.source_title || sourceTitle });

    const revisedDoc = await createRevisedDoc({
      title: `SEO Blog Ready - ${generated.source_title || sourceTitle || contentId}`,
      markdown: buildPublishReadyMarkdown(generated),
    });

    const seoRowNumber = nextSeoRowForContent(contentId);
    await writeFields(SEO_SHEET_ID, seoHeader, seoRowNumber, {
      "Date": currentDate,
      "Content ID": contentId,
      "Blog Doc URL": revisedDoc.url,
      "Status": "待配置",
      "SEO URL": finalSeoUrl,
      "Source Title": generated.source_title || sourceTitle,
      "Secondary Keywords": generated.secondary_keywords || "",
      "Source Content Snapshot": sourceSnapshotPreview(sourceMarkdown),
      "SEO Title": generated.seo_title || "",
      "Meta Description": generated.meta_description || "",
      "Keywords": generated.keywords || "",
      "LLM Summary": generated.llm_summary || "",
      "SEO Revised Article": "[Generated. See Blog Doc URL / SEO Revised Doc URL for publish-ready document.]",
      "Publish Format Output": "[Generated. See Blog Doc URL / SEO Revised Doc URL for publish-ready document.]",
      "Last Source Sync Time": new Date().toISOString(),
      "Last SEO Generated Time": new Date().toISOString(),
      "Blog Doc Token": revisedDoc.token,
    });
    updateLocalSeoRow(seoRowNumber, {
      "Date": currentDate,
      "Content ID": contentId,
      "Blog Doc URL": revisedDoc.url,
    });

    await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
      "Content ID": contentId,
      "Title": generated.source_title || sourceTitle,
      "Product Fit": generated.source_notes || "Generated from current industry sources and V2Fun SEO strategy.",
      "Validation Issues": normalizeValidationIssues(generated.validation_issues),
      "Status": "已同步",
      "SEO Config Synced": "已同步",
      "SEO Revised Doc URL": revisedDoc.url,
      "SEO Revised Doc Token": revisedDoc.token,
    });

    return {
      rowNumber,
      summary: `generated hot-topic SEO article and synced SEO config row ${seoRowNumber}`,
    };
  } catch (error) {
    const message = truncateCell(error.message || String(error));
    await writeFields(HOT_SHEET_ID, hotHeader, rowNumber, {
      "Status": "生成失败",
      "SEO Config Synced": "同步失败",
      "Validation Issues": `需要人工确认; ${message.slice(0, 300)}`,
    });
    return {
      rowNumber,
      summary: `hot-topic generation failed: ${message.slice(0, 160)}`,
    };
  }
}

async function processRow(rowNumber, row) {
  const docRef = extractDocRef(cell(row, blogHeader, "Blog Doc URL"));
  const blogDocCellValue = docRef.url || docRef.title || cellText(row, blogHeader, "Blog Doc URL");
  const primaryKeyword = cellInlineText(row, blogHeader, "Primary Keyword");
  const searchIntent = cellInlineText(row, blogHeader, "Search Intent");
  const reviewNote = cellText(row, blogHeader, "Review note");
  const existingDate = cellText(row, blogHeader, "Date");
  const currentDate = existingDate || todayShanghai();
  const issues = [];

  if (!docRef.url && !docRef.token) issues.push("缺少 Blog Doc URL");
  if (!primaryKeyword) issues.push("缺少 Primary Keyword");
  if (!searchIntent) issues.push("缺少 Search Intent");

  await writeField(BLOG_SHEET_ID, blogHeader, rowNumber, "SEO Status", "读取中");

  let sourceTitle = docRef.title || "";
  let sourceMarkdown = "";
  let documentId = "";
  let fetchIssue = "";

  if (docRef.url || docRef.token) {
    try {
      const fetched = await fetchDocMarkdown(docRef.url || docRef.token);
      sourceMarkdown = fetched.content;
      documentId = fetched.documentId;
      sourceTitle = firstMarkdownHeading(sourceMarkdown) || sourceTitle;
    } catch (error) {
      fetchIssue = "文档读取失败";
      issues.push(fetchIssue);
    }
  }

  const contentId = cellText(row, blogHeader, "Content ID") || buildContentId({ seoUrl: "", docToken: docRef.token || documentId, sourceTitle });
  const validationStatus = issues.length === 0 ? "校验通过" : "校验失败";
  const validationIssues = issues.length === 0 ? "无问题" : issues.join("; ");
  const nextSeoStatus = fetchIssue ? "生成失败" : issues.length === 0 ? "待生成" : "已读取";
  const nextArticleStatus = issues.length === 0 ? "未生成" : "未生成";

  await writeFields(BLOG_SHEET_ID, blogHeader, rowNumber, {
    "Date": currentDate,
    "Content ID": contentId,
    "SEO Status": nextSeoStatus,
    "Article Status": nextArticleStatus,
    "Validation Status": validationStatus,
    "Validation Issues": validationIssues,
    "Blog Doc Token": docRef.token || documentId,
  });

  await writeFields(SEO_SHEET_ID, seoHeader, rowNumber, {
    "Date": currentDate,
    "Content ID": contentId,
    "Blog Doc URL": blogDocCellValue,
    "Status": "待配置",
    "Source Title": sourceTitle,
    "Secondary Keywords": "",
    "Source Content Snapshot": sourceSnapshotPreview(sourceMarkdown),
    "SEO Title": "",
    "Meta Description": "",
    "Keywords": "",
    "LLM Summary": "",
    "SEO Revised Article": "",
    "Publish Format Output": "",
    "Last Source Sync Time": new Date().toISOString(),
    "Last SEO Generated Time": "",
    "Blog Doc Token": docRef.token || documentId,
  });

  if (issues.length === 0) {
    if (AI_PROVIDER !== "codex" && !AI_API_KEY) {
      return {
        rowNumber,
        summary: "validation passed; AI_API_KEY is not set, left row at SEO Status=待生成",
      };
    }

    await writeRange(`${BLOG_SHEET_ID}!H${rowNumber}:I${rowNumber}`, [["生成中", "未生成"]]);

    try {
      const generatedRaw = await generateSeoPackage({
        strategy,
        sourceMarkdown,
        sourceTitle,
        primaryKeyword,
        searchIntent,
        reviewNote,
        seoUrl: "",
      });
      const finalSeoUrl = resolveSeoUrl(generatedRaw);
      const generated = {
        ...generatedRaw,
        seo_url: finalSeoUrl,
        suggested_url: generatedRaw.suggested_url || finalSeoUrl,
        suggested_slug: generatedRaw.suggested_slug || slugFromUrl(finalSeoUrl),
      };

      await writeFields(SEO_SHEET_ID, seoHeader, rowNumber, {
        "Date": currentDate,
        "Content ID": contentId,
        "Blog Doc URL": blogDocCellValue,
        "Status": "待配置",
        "SEO URL": finalSeoUrl,
        "Source Title": generated.source_title || sourceTitle,
        "Secondary Keywords": generated.secondary_keywords || "",
        "Source Content Snapshot": sourceSnapshotPreview(sourceMarkdown),
        "SEO Title": generated.seo_title || "",
        "Meta Description": generated.meta_description || "",
        "Keywords": generated.keywords || "",
        "LLM Summary": generated.llm_summary || "",
        "SEO Revised Article": "[Generated. See SEO Revised Doc URL after document sync succeeds.]",
        "Publish Format Output": "[Generated. See SEO Revised Doc URL after document sync succeeds.]",
        "Last Source Sync Time": new Date().toISOString(),
        "Last SEO Generated Time": new Date().toISOString(),
        "Blog Doc Token": docRef.token || documentId,
      });

      const revisedDoc = await createRevisedDoc({
        title: `SEO Blog Ready - ${generated.source_title || sourceTitle || contentId}`,
        markdown: buildPublishReadyMarkdown(generated),
      });

      await writeFields(BLOG_SHEET_ID, blogHeader, rowNumber, {
        "SEO Status": "已同步",
        "Article Status": "待审核",
        "Validation Status": normalizeValidationStatus(generated.validation_status),
        "Validation Issues": normalizeValidationIssues(generated.validation_issues),
        "Final Approved": cellText(row, blogHeader, "Final Approved") || "未审核",
        "SEO Revised Doc URL": revisedDoc.url,
        "SEO Revised Doc Token": revisedDoc.token,
        "Blog Doc Token": docRef.token || documentId,
      });
      return {
        rowNumber,
        summary: "generated SEO article and synced revised doc",
      };
    } catch (error) {
      const message = truncateCell(error.message || String(error));
      await writeFields(BLOG_SHEET_ID, blogHeader, rowNumber, {
        "SEO Status": "生成失败",
        "Article Status": "未生成",
        "Validation Status": "校验失败",
        "Validation Issues": `需要人工确认; ${message.slice(0, 300)}`,
      });
      return {
        rowNumber,
        summary: `generation failed: ${message.slice(0, 160)}`,
      };
    }
  }

  return {
    rowNumber,
    summary: issues.length ? `${validationStatus}: ${validationIssues}` : "ready for SEO generation",
  };
}

async function readRange(range) {
  const result = await runJson([
    "sheets",
    "+read",
    "--as",
    "user",
    "--spreadsheet-token",
    SPREADSHEET_TOKEN,
    "--range",
    range,
  ]);
  return result.data?.valueRange?.values || [];
}

async function writeRange(range, values) {
  await runJson([
    "sheets",
    "+write",
    "--as",
    "user",
    "--spreadsheet-token",
    SPREADSHEET_TOKEN,
    "--range",
    range,
    "--values",
    JSON.stringify(values),
  ]);
}

async function writeField(sheetId, map, rowNumber, headerName, value) {
  const colIndex = map[normalizeHeader(headerName)];
  if (!colIndex) return;
  await writeRange(`${sheetId}!${columnName(colIndex)}${rowNumber}:${columnName(colIndex)}${rowNumber}`, [[value]]);
}

async function writeFields(sheetId, map, rowNumber, fields) {
  for (const [headerName, value] of Object.entries(fields)) {
    await writeField(sheetId, map, rowNumber, headerName, value);
  }
}

function headerMap(headers) {
  const map = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(text(header));
    if (normalized) map[normalized] = index + 1;
  });
  return map;
}

function cell(row, map, headerName) {
  const colIndex = map[normalizeHeader(headerName)];
  if (!colIndex) return undefined;
  return row[colIndex - 1];
}

function cellText(row, map, headerName) {
  return text(cell(row, map, headerName));
}

function cellInlineText(row, map, headerName) {
  return inlineText(cell(row, map, headerName));
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

async function fetchDocMarkdown(doc) {
  const result = await runJson([
    "docs",
    "+fetch",
    "--api-version",
    "v2",
    "--as",
    "user",
    "--doc",
    doc,
    "--doc-format",
    "markdown",
    "--format",
    "json",
  ]);
  return {
    content: result.data?.document?.content || "",
    documentId: result.data?.document?.document_id || "",
  };
}

async function generateSeoPackage({ strategy, sourceMarkdown, sourceTitle, primaryKeyword, searchIntent, reviewNote, seoUrl }) {
  const prompt = buildGenerationPrompt({ strategy, sourceMarkdown, sourceTitle, primaryKeyword, searchIntent, reviewNote, seoUrl });
  if (AI_PROVIDER === "codex") return generateSeoPackageWithCodex(prompt);
  return generateSeoPackageWithCompatibleApi(prompt);
}

async function generateSeoPackageWithCompatibleApi(prompt) {
  let response;
  try {
    response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are an SEO editor for V2Fun. Return only valid JSON matching the requested schema. Do not include markdown fences.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
      }),
    });
  } catch (error) {
    throw new Error(`Cannot connect to AI API at ${AI_BASE_URL}: ${error.message || error}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI API error ${response.status}: ${body}`);
  }

  const body = await response.json();
  const output = body.choices?.[0]?.message?.content || body.output_text || body.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("") || "";
  if (!output) throw new Error("AI response did not include output text.");

  const parsed = JSON.parse(output);
  const required = ["seo_title", "meta_description", "keywords", "llm_summary", "seo_revised_article", "publish_format_output", "section_breakdown", "keyword_mapping", "publish_checklist"];
  for (const key of required) {
    if (!parsed[key]) throw new Error(`Generated JSON missing required field: ${key}`);
  }
  return parsed;
}

async function generateSeoPackageWithCodex(prompt) {
  const codexBin = await resolveCodexCli();
  const tmpDir = path.join(os.tmpdir(), `seo-workflow-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const outputPath = path.join(tmpDir, "output.json");
  const schemaPath = path.join(rootDir, "scripts", "seo_output_schema.json");

  const codexPrompt = [
    "You are generating SEO workflow output for an automation script.",
    "Return only the final JSON object matching the provided schema.",
    "Do not edit files. Do not run commands. Do not include markdown fences.",
    "",
    prompt,
  ].join("\n");

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
  ];
  if (CODEX_MODEL) args.push("--model", CODEX_MODEL);
  args.push(codexPrompt);

  await runCommand(codexBin, args, { cwd: rootDir, timeoutMs: 10 * 60 * 1000 });
  const output = fs.readFileSync(outputPath, "utf8").trim();
  const parsed = JSON.parse(stripJsonFences(output));
  const required = ["seo_title", "meta_description", "keywords", "llm_summary", "seo_revised_article", "publish_format_output", "section_breakdown", "keyword_mapping", "publish_checklist"];
  for (const key of required) {
    if (!parsed[key]) throw new Error(`Codex output missing required field: ${key}`);
  }
  return parsed;
}

function buildGenerationPrompt({ strategy, sourceMarkdown, sourceTitle, primaryKeyword, searchIntent, reviewNote, seoUrl }) {
  return [
    "Use the following global SEO strategy:",
    JSON.stringify(strategy, null, 2),
    "",
    "Row-level inputs:",
    JSON.stringify({ sourceTitle, primaryKeyword, searchIntent, reviewNote, seoUrl }, null, 2),
    "",
    "Original article markdown:",
    sourceMarkdown,
    "",
    "Rewrite and optimize the article for SEO while preserving factual meaning.",
    "Return strict JSON matching the schema. This output will be converted into a publish-ready Feishu document with the same framework as the uploaded Excel template.",
    "",
    "Required top-level string fields:",
    "- source_title",
    "- seo_url",
    "- secondary_keywords",
    "- seo_title",
    "- suggested_slug",
    "- suggested_url",
    "- meta_description",
    "- primary_keyword",
    "- keywords",
    "- search_intent",
    "- target_audience",
    "- excerpt",
    "- recommended_cta",
    "- internal_link_suggestions",
    "- llm_summary",
    "- seo_revised_article",
    "- publish_format_output",
    "- faq_schema_jsonld",
    "- source_notes",
    "- validation_status",
    "- validation_issues",
    "",
    "Required array fields:",
    "- section_breakdown: objects with order, section_type, heading, target_keywords, purpose_notes",
    "- keyword_mapping: objects with priority, keyword, keyword_role, recommended_placement, notes",
    "- publish_checklist: objects with checklist_item, status, owner_note",
    "",
    "Rules:",
    "- Keep output in English.",
    "- Do not invent unsupported product capabilities.",
    "- Keep SEO title clear and aligned to the primary keyword.",
    "- Keep meta description concise and useful.",
    "- Preserve Markdown headings and produce a complete publish-ready article.",
    "- Add FAQ only when it improves search usefulness.",
    "- The SEO Revised Doc must be easy to copy into the CMS/backend. Fill the publish package fields carefully.",
    "- suggested_slug should be lowercase kebab-case without /blog/.",
    "- suggested_url should be /blog/{suggested_slug}.",
  ].join("\n");
}

function normalizeBaseUrl(input) {
  return String(input || "").replace(/\/+$/, "");
}

function requiredConfig(key) {
  const value = process.env[key] || env[key] || "";
  if (!value || value.startsWith("your_")) {
    throw new Error(`Missing required config ${key}. Copy .env.example to .env and fill your own Feishu spreadsheet settings.`);
  }
  return value;
}

async function createRevisedDoc({ title, markdown }) {
  const content = `# ${title.replace(/^#+\s*/, "")}\n\n${markdown.replace(/^#\s+.+\n+/, "")}`;
  const tmpDir = path.join(rootDir, "tmp", `seo-workflow-doc-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const contentPath = path.join(tmpDir, "revised.md");
  const contentPathForCli = path.relative(rootDir, contentPath);
  fs.writeFileSync(contentPath, content, "utf8");
  const args = [
    "docs",
    "+create",
    "--api-version",
    "v2",
    "--as",
    "user",
    "--doc-format",
    "markdown",
    "--content",
    `@${contentPathForCli}`,
  ];
  if (REVISED_DOC_PARENT_TOKEN) {
    args.push("--parent-token", REVISED_DOC_PARENT_TOKEN);
  }

  const result = await runJson(args);
  const doc = result.data?.document || result.data || {};
  const token = doc.document_id || doc.token || doc.obj_token || "";
  const url = doc.url || (token ? `${FEISHU_DOC_BASE_URL}/${token}` : "");
  if (!url && !token) throw new Error(`Could not resolve created revised doc URL: ${JSON.stringify(result)}`);
  if (token && REVISED_DOC_PUBLIC_ACCESS) {
    await updateRevisedDocPermission(token);
  }
  return { token, url };
}

async function updateRevisedDocPermission(token) {
  const editable = REVISED_DOC_LINK_SHARE_ENTITY === "anyone_editable" || REVISED_DOC_LINK_SHARE_ENTITY === "tenant_editable";
  try {
    await runJson([
      "drive",
      "permission.public",
      "patch",
      "--as",
      "user",
      "--params",
      JSON.stringify({ token, type: "docx" }),
      "--data",
      JSON.stringify({
        external_access: REVISED_DOC_LINK_SHARE_ENTITY.startsWith("anyone_"),
        link_share_entity: REVISED_DOC_LINK_SHARE_ENTITY,
        share_entity: "anyone",
        comment_entity: editable ? "anyone_can_edit" : "anyone_can_view",
        security_entity: editable ? "anyone_can_edit" : "anyone_can_view",
      }),
      "--yes",
    ]);
  } catch (error) {
    throw new Error(`Created revised doc, but failed to update public link permission: ${error.message || error}`);
  }
}

function buildPublishReadyMarkdown(generated) {
  const publishingRows = [
    ["Publish Status", "Ready for SEO blog publishing", "Fixed config"],
    ["Recommended Blog Title / H1", generated.source_title || "", "Review"],
    ["SEO Title", generated.seo_title || "", "Review / copy to SEO title field"],
    ["Suggested Slug", generated.suggested_slug || slugFromUrl(generated.seo_url || generated.suggested_url || ""), "Copy to slug field"],
    ["Suggested URL", generated.suggested_url || generated.seo_url || "", "Reference"],
    ["Meta Description", generated.meta_description || "", "Review / copy to meta description field"],
    ["Primary Keyword", generated.primary_keyword || "", "Fixed config"],
    ["Secondary Keywords", generated.secondary_keywords || "", "Fixed config"],
    ["Search Intent", generated.search_intent || "", "Fixed config"],
    ["Target Audience", generated.target_audience || "", "Reference"],
    ["Excerpt", generated.excerpt || "", "Review / copy if CMS has excerpt field"],
    ["Recommended CTA", generated.recommended_cta || "", "Review"],
    ["Internal Link Suggestions", generated.internal_link_suggestions || "", "Reference"],
  ];

  return [
    "# SEO Blog Publishing Package",
    "",
    "## MANUAL REVIEW - Read This First",
    "",
    "Review the title, meta description, excerpt, CTA, and the full blog body before publishing. Configuration/reference sections below should not be pasted into the visible article body unless your CMS has matching fields.",
    "",
    "## CONFIG TABLE - Copy Fields To CMS",
    markdownTable(["Field", "Final Content / Notes", "Action"], publishingRows),
    "",
    "## COPY TO CMS - Blog Body Only",
    "",
    "Copy the content below into the CMS article body. Do not include the config tables, JSON-LD block, source notes, section breakdown, keyword mapping, or checklist unless the CMS has a dedicated field for them.",
    "",
    generated.seo_revised_article || "",
    "",
    "## OPTIONAL SEO SCHEMA - Do Not Paste Into Visible Body",
    "",
    "Use this only if the CMS has a custom JSON-LD / structured data field. Otherwise ignore this section.",
    "",
    "```json",
    generated.faq_schema_jsonld || "{}",
    "```",
    "",
    "## REFERENCE TABLE - Source Notes",
    "",
    generated.source_notes || "Optimized from the source Feishu blog draft and SEO strategy sheet.",
    "",
    "## REFERENCE TABLE - Section Breakdown",
    markdownTable(
      ["Order", "Section Type", "Heading", "Target Keyword(s)", "Purpose / Notes"],
      arrayValue(generated.section_breakdown).map((item) => [
        item.order ?? "",
        item.section_type ?? "",
        item.heading ?? "",
        item.target_keywords ?? "",
        item.purpose_notes ?? "",
      ]),
    ),
    "",
    "## REFERENCE TABLE - Keyword Mapping",
    markdownTable(
      ["Priority", "Keyword", "Keyword Role", "Recommended Placement", "Notes"],
      arrayValue(generated.keyword_mapping).map((item) => [
        item.priority ?? "",
        item.keyword ?? "",
        item.keyword_role ?? "",
        item.recommended_placement ?? "",
        item.notes ?? "",
      ]),
    ),
    "",
    "## REVIEW TABLE - Publish Checklist",
    markdownTable(
      ["Checklist Item", "Status", "Owner Note"],
      arrayValue(generated.publish_checklist).map((item) => [
        item.checklist_item ?? "",
        item.status ?? "",
        item.owner_note ?? "",
      ]),
    ),
  ].join("\n");
}

function markdownTable(headers, rows) {
  const safeHeaders = headers.map(escapeTableCell);
  const safeRows = rows.length ? rows : [headers.map(() => "")];
  return [
    `| ${safeHeaders.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...safeRows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
  ].join("\n");
}

function escapeTableCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function shouldProcessHotStatus(status, validationIssues) {
  if (status === "待评估") return true;
  if (status !== "不适合") return false;
  return validationIssues !== "信息来源不足";
}

async function searchHotSources({ targetAudience, primaryKeyword, searchIntent, date }) {
  const queries = [
    `${primaryKeyword} ${targetAudience} ${searchIntent} AI 3D game development when:7d`,
    `${primaryKeyword} AI tools game assets animation Unity Unreal when:7d`,
    `${primaryKeyword} V2Fun 3D model AI tool when:30d`,
  ];
  const allSources = [];

  if (ENABLE_GOOGLE_NEWS) {
    for (const query of queries) {
      allSources.push(...await fetchGoogleNewsSources(query, primaryKeyword));
    }
  }

  allSources.push(...await fetchHackerNewsSources(`${primaryKeyword} AI 3D`, primaryKeyword));
  allSources.push(...await fetchProductHuntSources(primaryKeyword));
  allSources.push(...await fetchGdeltSources(`${primaryKeyword} AI 3D game animation`, primaryKeyword));
  allSources.push(...await fetchArxivSources(primaryKeyword));

  return dedupeSources(allSources)
    .filter((source) => isRelevantHotSource(source, { primaryKeyword, targetAudience }))
    .sort((a, b) => Date.parse(b.publishedAt || date) - Date.parse(a.publishedAt || date))
    .slice(0, HOT_SOURCE_LIMIT);
}

async function fetchGoogleNewsSources(query, primaryKeyword) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const xml = await fetchText(url);
    return parseRssItems(xml).map((item) => ({
      source: "Google News",
      keyword: primaryKeyword,
      topic: item.title,
      title: item.title,
      url: cleanGoogleNewsUrl(item.link),
      publishedAt: item.pubDate ? dateOnly(item.pubDate) : "",
      summary: item.description,
    }));
  } catch {
    return [];
  }
}

async function fetchHackerNewsSources(query, primaryKeyword) {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
  try {
    const json = await fetchJson(url);
    return arrayValue(json.hits).map((hit) => ({
      source: "Hacker News",
      keyword: primaryKeyword,
      topic: text(hit.title || hit.story_title),
      title: text(hit.title || hit.story_title),
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      publishedAt: hit.created_at ? dateOnly(hit.created_at) : "",
      summary: text(hit.title || hit.story_title),
    }));
  } catch {
    return [];
  }
}

async function fetchProductHuntSources(primaryKeyword) {
  const url = "https://www.producthunt.com/feed";
  try {
    const xml = await fetchText(url);
    return parseAtomEntries(xml).map((item) => ({
      source: "Product Hunt",
      keyword: primaryKeyword,
      topic: item.title,
      title: item.title,
      url: item.link,
      publishedAt: item.updated ? dateOnly(item.updated) : "",
      summary: item.summary,
    }));
  } catch {
    return [];
  }
}

async function fetchGdeltSources(query, primaryKeyword) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=10&sort=HybridRel`;
  try {
    const json = await fetchJson(url);
    return arrayValue(json.articles).map((article) => ({
      source: "GDELT",
      keyword: primaryKeyword,
      topic: text(article.title),
      title: text(article.title),
      url: article.url || "",
      publishedAt: article.seendate ? dateOnly(article.seendate) : "",
      summary: text(article.sourceCountry ? `${article.sourceCountry} source` : article.domain || ""),
    }));
  } catch {
    return [];
  }
}

async function fetchArxivSources(primaryKeyword) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(`"${primaryKeyword}"`)}&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending`;
  try {
    const xml = await fetchText(url);
    return parseAtomEntries(xml).map((item) => ({
      source: "arXiv",
      keyword: primaryKeyword,
      topic: item.title,
      title: item.title,
      url: item.link,
      publishedAt: item.updated ? dateOnly(item.updated) : "",
      summary: item.summary,
    }));
  } catch {
    return [];
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SEO-Workflow/0.1 (+https://v2fun.ai)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function parseRssItems(xml) {
  const matches = [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return matches.map((match) => {
    const item = match[1];
    return {
      title: decodeXml(extractXml(item, "title")),
      link: decodeXml(extractXml(item, "link")),
      pubDate: decodeXml(extractXml(item, "pubDate")),
      description: stripHtml(decodeXml(extractXml(item, "description"))),
    };
  }).filter((item) => item.title && item.link);
}

function parseAtomEntries(xml) {
  const matches = [...String(xml || "").matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return matches.map((match) => {
    const entry = match[1];
    const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i);
    return {
      title: decodeXml(extractXml(entry, "title")),
      link: decodeXml(linkMatch?.[1] || extractXml(entry, "link")),
      updated: decodeXml(extractXml(entry, "updated") || extractXml(entry, "published")),
      summary: stripHtml(decodeXml(extractXml(entry, "summary") || extractXml(entry, "content"))),
    };
  }).filter((item) => item.title && item.link);
}

function extractXml(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() || "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanGoogleNewsUrl(url) {
  return String(url || "").trim();
}

function dedupeSources(sources) {
  const seen = new Set();
  const deduped = [];
  for (const source of sources) {
    const key = (source.url || source.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function isRelevantHotSource(source, { primaryKeyword, targetAudience }) {
  const haystack = `${source.title || ""} ${source.summary || ""}`.toLowerCase();
  const keywords = `${primaryKeyword} ${targetAudience}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !["with", "that", "users"].includes(word));
  const domainWords = ["3d", "model", "print", "printing", "game", "animation", "asset", "unity", "unreal", "mocap", "rigging"];
  const keywordHits = keywords.filter((word) => haystack.includes(word)).length;
  const domainHits = domainWords.filter((word) => haystack.includes(word)).length;
  return keywordHits >= 1 || domainHits >= 2;
}

function buildHotSourceMarkdown({ targetAudience, primaryKeyword, searchIntent, sources, date }) {
  return [
    `# Current source brief for ${primaryKeyword}`,
    "",
    `Date: ${date}`,
    `Target audience: ${targetAudience}`,
    `Primary keyword: ${primaryKeyword}`,
    `Search intent: ${searchIntent}`,
    "",
    "Use these current source notes as directional industry context. Do not copy text verbatim. Do not treat a source as proof of V2Fun product capabilities unless the global strategy explicitly supports the claim.",
    "",
    ...sources.map((source, index) => [
      `## Source ${index + 1}: ${source.title}`,
      "",
      `Source: ${source.source}`,
      `URL: ${source.url}`,
      `Published date: ${source.publishedAt || "Unknown"}`,
      source.summary ? `Summary: ${source.summary}` : "",
      "",
    ].filter(Boolean).join("\n")),
  ].join("\n");
}

function summarizeSources(sources, field) {
  return sources.map((source, index) => `${index + 1}. ${source[field] || ""}`.trim()).filter(Boolean).join("\n").slice(0, 5000);
}

function dateOnly(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || "").slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function nextSeoRowForContent(contentId) {
  const contentColumn = seoHeader[normalizeHeader("Content ID")];
  if (!contentColumn) return seoRows.length + 1;

  for (let index = 1; index < seoRows.length; index += 1) {
    if (text(seoRows[index]?.[contentColumn - 1]) === contentId) return index + 1;
  }

  for (let index = 1; index < MAX_ROWS; index += 1) {
    if (!text(seoRows[index]?.[contentColumn - 1])) return index + 1;
  }

  return seoRows.length + 1;
}

function updateLocalSeoRow(rowNumber, fields) {
  while (seoRows.length < rowNumber) seoRows.push([]);
  const row = seoRows[rowNumber - 1] || [];
  for (const [headerName, value] of Object.entries(fields)) {
    const colIndex = seoHeader[normalizeHeader(headerName)];
    if (!colIndex) continue;
    row[colIndex - 1] = value;
  }
  seoRows[rowNumber - 1] = row;
}

function parseStrategy(rows) {
  const strategy = {};
  for (const row of rows.slice(1)) {
    const key = text(row?.[0]);
    const value = text(row?.[1]);
    if (!key || !value) continue;
    strategy[key] = {
      value,
      appliesTo: text(row?.[2]),
      editableBy: text(row?.[3]),
      aiUsage: text(row?.[4]),
      notes: text(row?.[5]),
    };
  }
  return strategy;
}

function extractDocRef(value) {
  if (Array.isArray(value)) {
    const mention = value.find((item) => item?.link || item?.token);
    const title = value.map((item) => item?.text || "").join("").trim();
    return {
      url: mention?.link || "",
      token: mention?.token || tokenFromUrl(mention?.link || ""),
      title,
    };
  }

  const raw = text(value);
  return {
    url: raw.startsWith("http") ? raw : "",
    token: tokenFromUrl(raw),
    title: raw.startsWith("http") ? "" : raw,
  };
}

function buildContentId({ seoUrl, docToken, sourceTitle }) {
  const urlSlug = slugFromUrl(seoUrl);
  if (urlSlug) return `blog/${urlSlug}`;
  if (docToken) return `blogdoc/${docToken}`;
  const titleSlug = slugify(sourceTitle);
  return titleSlug ? `blog/${titleSlug}` : "";
}

function resolveSeoUrl(generated) {
  const fromGenerated = generated?.suggested_url || generated?.seo_url || "";
  if (fromGenerated) {
    if (fromGenerated.startsWith("/")) return fromGenerated;
    const slug = slugFromUrl(fromGenerated) || slugify(fromGenerated);
    return slug ? `/blog/${slug}` : "";
  }

  const slug = generated?.suggested_slug || slugify(generated?.seo_title || generated?.source_title || "");
  return slug ? `/blog/${slug}` : "";
}

function slugFromUrl(input) {
  if (!input) return "";
  try {
    const parsed = new URL(input);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return slugify(parts.at(-1) || "");
  } catch {
    return "";
  }
}

function tokenFromUrl(input) {
  if (!input) return "";
  const match = String(input).match(/\/(?:wiki|docx?)\/([^/?#]+)/);
  return match?.[1] || "";
}

function firstMarkdownHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "";
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function truncateCell(value) {
  return String(value || "").slice(0, 45000);
}

function sourceSnapshotPreview(markdown) {
  const source = String(markdown || "");
  if (!source) return "";

  const headings = source
    .split(/\r?\n/)
    .filter((line) => /^#{1,3}\s+/.test(line))
    .slice(0, 12)
    .join("\n");

  const firstParagraph = source
    .replace(/^#\s+.+\n+/, "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean) || "";

  return [
    "[Source synced. Full article remains in Blog Doc URL.]",
    headings ? `\nOutline:\n${headings}` : "",
    firstParagraph ? `\nPreview:\n${firstParagraph.slice(0, 800)}` : "",
  ].join("").slice(0, 1800);
}

function normalizeValidationStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "校验通过";
  if (["passed", "pass", "ok", "success", "校验通过"].includes(raw)) return "校验通过";
  if (["failed", "fail", "error", "校验失败"].includes(raw)) return "校验失败";
  if (raw.includes("human") || raw.includes("manual") || raw.includes("人工")) return "需人工确认";
  return "需人工确认";
}

function normalizeValidationIssues(value) {
  const raw = String(value || "").trim();
  if (!raw) return "无问题";
  const lower = raw.toLowerCase();
  if (lower.includes("no blocking") || lower === "none" || lower === "no issues" || raw === "无问题") {
    return "无问题";
  }
  return raw.slice(0, 500);
}

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => item?.text || "").join("").trim();
  return String(value).trim();
}

function inlineText(value) {
  return text(value).replace(/\s+/g, " ").trim();
}

async function resolveLarkCli() {
  const configured = process.env.LARK_CLI_BIN || env.LARK_CLI_BIN;
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
    return { command: resolved, argsPrefix: [] };
  }

  const cached = findCachedLarkCliBin();
  if (cached) return { command: cached, argsPrefix: [] };

  return { command: "npx", argsPrefix: ["-y", "@larksuite/cli"] };
}

async function resolveCodexCli() {
  const configured = process.env.CODEX_CLI_BIN || env.CODEX_CLI_BIN;
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
  const candidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
  ];
  for (const candidate of candidates) {
    if (candidate === "codex") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "codex";
}

function findCachedLarkCliBin() {
  try {
    const npxRoot = path.join(os.homedir(), ".npm", "_npx");
    const candidates = fs
      .readdirSync(npxRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(npxRoot, entry.name, "node_modules", "@larksuite", "cli", "bin", "lark-cli"))
      .filter((candidate) => fs.existsSync(candidate));
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function runJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(larkCli.command, [...larkCli.argsPrefix, ...args], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${larkCli.command} ${args.join(" ")} exited with code ${code}\n${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse CLI JSON output: ${error.message}\n${stdout}`));
      }
    });
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

function stripJsonFences(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

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
const GEO_POST_SHEET_ID = requiredConfig("GEO_POST_SHEET_ID");
const MAX_ROWS = Number(process.env.GEO_POST_MAX_ROWS || env.GEO_POST_MAX_ROWS || process.env.SEO_MAX_ROWS || env.SEO_MAX_ROWS || 200);
const AI_PROVIDER = (process.env.AI_PROVIDER || env.AI_PROVIDER || "codex").toLowerCase();
const AI_BASE_URL = normalizeBaseUrl(process.env.AI_BASE_URL || env.AI_BASE_URL || process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1");
const AI_MODEL = process.env.AI_MODEL || env.AI_MODEL || process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_API_KEY = process.env.AI_API_KEY || env.AI_API_KEY || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
const CODEX_MODEL = process.env.CODEX_MODEL || env.CODEX_MODEL || "";

const larkCli = await resolveLarkCli();
const rows = await readRange(`${GEO_POST_SHEET_ID}!A1:M${MAX_ROWS}`);
const header = headerMap(rows[0] || []);
const onlyRowArg = process.argv.find((arg) => arg.startsWith("--geo-row="));
const onlyRowNumber = onlyRowArg ? Number(onlyRowArg.split("=")[1]) : 0;

if (onlyRowArg && (!Number.isInteger(onlyRowNumber) || onlyRowNumber < 2)) {
  throw new Error("--geo-row must be a row number >= 2");
}

const updates = [];
for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = rows[index] || [];
  if (onlyRowNumber && rowNumber !== onlyRowNumber) continue;

  const status = readCellText(row, ["Content Status", "Content Staus", "Status"]);
  const blogDocUrl = readCellText(row, ["Blog Doc URL"]);
  const platform = readCellText(row, ["发布平台"]);

  if (!["待读取", "重新生成"].includes(status)) continue;
  if (!blogDocUrl || !platform) continue;

  updates.push(await processGeoPostRow(rowNumber, row));
}

if (updates.length === 0) {
  console.log("No rows matched 社媒稿件 Content Status=待读取/重新生成 with Blog Doc URL and 发布平台.");
} else {
  console.log(`Processed ${updates.length} row(s):`);
  for (const update of updates) console.log(`- Row ${update.rowNumber}: ${update.summary}`);
}

async function processGeoPostRow(rowNumber, row) {
  await writeCompatibleStatus(rowNumber, "读取中");

  try {
    const docRef = extractDocRef(cell(row, header, "Blog Doc URL"));
    const promptInput = readCellText(row, ["Prompt"]);
    const platform = readCellText(row, ["发布平台"]);
    const existingPersona = readCellText(row, ["人群画像"]);
    const existingUseCase = readCellText(row, ["使用场景"]);
    const existingSearchIntent = readCellText(row, ["搜索意图"]);
    const sourceDoc = await fetchDocMarkdown(docRef.url || docRef.token || docRef.localPath || docRef.title);
    const sourceMarkdown = sourceDoc.content || "";
    const sourceTitle = docRef.title || firstMarkdownHeading(sourceMarkdown) || promptInput || `Row ${rowNumber}`;

    if (!sourceMarkdown.trim()) {
      throw new Error("文档内容为空");
    }

    const result = await generateGeoPostClassification({
      sourceTitle,
      sourceMarkdown,
      promptInput,
      platform,
      existingPersona,
      existingUseCase,
      existingSearchIntent,
    });

    await writeFields(GEO_POST_SHEET_ID, header, rowNumber, {
      "人群画像": result.persona,
      "使用场景": result.use_case,
      "搜索意图": result.search_intent,
      "发布分区": result.reddit_communities,
    });
    await writeCompatibleStatus(rowNumber, "已读取");

    return {
      rowNumber,
      summary: `matched persona/use case/search intent and ${platform} communities`,
    };
  } catch (error) {
    await writeCompatibleStatus(rowNumber, "读取失败");
    await writeFields(GEO_POST_SHEET_ID, header, rowNumber, {
      "发布分区": `需要人工确认：${shortErrorMessage(error)}`,
    });
    return {
      rowNumber,
      summary: `failed: ${shortErrorMessage(error)}`,
    };
  }
}

async function generateGeoPostClassification(input) {
  const prompt = buildGeoPostPrompt(input);
  if (AI_PROVIDER === "codex") return generateWithCodex(prompt);
  if (!AI_API_KEY) throw new Error("AI_API_KEY 未配置");
  return generateWithCompatibleApi(prompt);
}

function buildGeoPostPrompt({
  sourceTitle,
  sourceMarkdown,
  promptInput,
  platform,
  existingPersona,
  existingUseCase,
  existingSearchIntent,
}) {
  return [
    "You are a GEO/social content operations assistant for V2Fun.",
    "Read the supplied post/article content and classify it for a Feishu workflow.",
    "Return strict JSON only. Do not include markdown fences.",
    "",
    "Fields to generate:",
    "- persona: concise Chinese audience persona label. Prefer existing label if it is already accurate.",
    "- use_case: concise Chinese use-case label. Prefer existing label if it is already accurate.",
    "- search_intent: concise bilingual label in the same style as existing workflow options.",
    "- reddit_communities: if platform is Reddit, output 3-6 relevant subreddits as comma-separated names. If not Reddit, output recommended platform sections or 待人工确认.",
    "- reasoning: one short sentence explaining the match.",
    "- confidence: 高 / 中 / 低.",
    "",
    "Allowed persona examples:",
    "电商 / 商品设计用户, 3D 创作者 / 设计师, 游戏开发者 / 技术美术, 动画师 / 角色创作者, 3D 打印用户, AI 工具探索者, 品牌 / 市场团队, 教育 / 培训用户",
    "",
    "Allowed use-case examples:",
    "商品3D展示资产, 图片/创意/可打印模型, 游戏资产 / 角色动画, AI 3D工具评测 / 成本对比, 工作流教程 / 生产效率, 角色绑定 / 动作捕捉, 文件格式 / 导出转换",
    "",
    "Search intent examples:",
    "Product to 3D / 商品建模 / 电商3D展示, Image to 3D / 3D打印 / STL / Printable Model, AI 3D Generator / 工具对比 / 成本评估, Game Assets / Unity Unreal / 角色动画, Rigging / Mocap / Animation Workflow, File Formats / Export / Integration, Brand / Product Navigation",
    "",
    "Reddit matching guidance:",
    "- Product/ecommerce: r/ecommerce, r/shopify, r/ProductManagement, r/Entrepreneur, r/3Dmodeling",
    "- 3D printing/STL/minis: r/3Dprinting, r/PrintedMinis, r/AdditiveManufacturing, r/functionalprint, r/3Dmodeling",
    "- Game assets/engines: r/gamedev, r/Unity3D, r/unrealengine, r/IndieDev, r/GameAssets",
    "- Animation/rigging/mocap: r/animation, r/3Dmodeling, r/blender, r/Maya, r/gamedev",
    "- AI tools/general: r/artificial, r/AItools, r/3Dmodeling, r/gamedev, r/StableDiffusion",
    "Only recommend communities that fit the post. Do not invent subreddit names.",
    "",
    "Row inputs:",
    JSON.stringify({
      sourceTitle,
      prompt: promptInput,
      platform,
      existingPersona,
      existingUseCase,
      existingSearchIntent,
    }, null, 2),
    "",
    "Post/article markdown excerpt:",
    sourceMarkdown.slice(0, 9000),
  ].join("\n");
}

async function generateWithCodex(prompt) {
  const codexBin = await resolveCodexCli();
  const tmpDir = path.join(os.tmpdir(), `geo-post-workflow-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const outputPath = path.join(tmpDir, "output.json");
  const schemaPath = path.join(rootDir, "scripts", "geo_post_schema.json");

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
  args.push([
    "Return only the final JSON object matching the provided schema.",
    "Do not edit files. Do not run commands.",
    "",
    prompt,
  ].join("\n"));

  await runCommand(codexBin, args, { cwd: rootDir, timeoutMs: 8 * 60 * 1000 });
  return JSON.parse(stripJsonFences(fs.readFileSync(outputPath, "utf8")));
}

async function generateWithCompatibleApi(prompt) {
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
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
          content: "You classify GEO/social posts for V2Fun. Return only valid JSON matching the requested schema.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const output = data.choices?.[0]?.message?.content || "";
  return JSON.parse(stripJsonFences(output));
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

async function writeCompatibleStatus(rowNumber, value) {
  if (header[normalizeHeader("Content Status")]) {
    await writeField(GEO_POST_SHEET_ID, header, rowNumber, "Content Status", value);
    return;
  }
  await writeField(GEO_POST_SHEET_ID, header, rowNumber, "Content Staus", value);
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

function readCellText(row, names) {
  for (const name of names) {
    const value = inlineText(cell(row, header, name));
    if (value) return value;
  }
  return "";
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
  const localDoc = await fetchLocalMarkdown(doc);
  if (localDoc) return localDoc;

  if (isDirectMarkdownUrl(doc)) {
    const response = await fetch(doc);
    if (!response.ok) throw new Error(`Markdown URL 返回 ${response.status}`);
    return { content: await response.text(), documentId: buildLocalDocumentId(doc) };
  }

  const inspected = await inspectLarkResource(doc);
  if (inspected?.type === "file" && inspected.token) return downloadDriveMarkdown(inspected);
  if (["doc", "docx"].includes(inspected?.type) && inspected.token) doc = inspected.token;

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

async function inspectLarkResource(doc) {
  const raw = extractLinkCandidate(doc);
  if (!raw) return null;

  const args = ["drive", "+inspect", "--as", "user", "--url", raw, "--format", "json"];
  if (!/^https?:\/\//i.test(raw)) args.push("--type", "wiki");

  try {
    const result = await runJson(args);
    return result.data || null;
  } catch {
    return null;
  }
}

async function downloadDriveMarkdown(resource) {
  const token = String(resource?.token || "");
  if (!token) throw new Error("Drive file token 为空");

  const title = String(resource?.title || `${token}.md`);
  const fileName = sanitizeFileName(title.endsWith(".md") || title.endsWith(".markdown") ? title : `${title}.md`);
  const output = path.join("tmp", `geo-post-drive-${randomUUID()}-${fileName}`);
  fs.mkdirSync(path.join(rootDir, "tmp"), { recursive: true });

  const result = await runJson([
    "drive",
    "+download",
    "--as",
    "user",
    "--file-token",
    token,
    "--output",
    output,
    "--overwrite",
    "--format",
    "json",
  ]);
  const savedPath = result.data?.saved_path || path.resolve(rootDir, output);
  return {
    content: fs.readFileSync(savedPath, "utf8"),
    documentId: token,
  };
}

async function fetchLocalMarkdown(doc) {
  const candidates = localMarkdownCandidates(doc);
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      return {
        content: fs.readFileSync(candidate, "utf8"),
        documentId: buildLocalDocumentId(candidate),
      };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function localMarkdownCandidates(input) {
  const ref = localMarkdownRef(input);
  if (!ref) return [];

  const decoded = safeDecodeURIComponent(ref);
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const baseName = path.basename(withoutLeadingSlash);
  return [...new Set([
    decoded,
    path.resolve(rootDir, withoutLeadingSlash),
    path.resolve(rootDir, "blogdoc", baseName),
    path.resolve(rootDir, "blogdocs", baseName),
    path.resolve(rootDir, "docs", baseName),
    path.resolve(rootDir, "tmp", baseName),
  ])];
}

function localMarkdownRef(input) {
  const raw = extractLinkCandidate(input);
  if (!raw) return "";
  if (isDirectMarkdownUrl(raw)) {
    try {
      return new URL(raw).pathname;
    } catch {
      return "";
    }
  }
  if (/^https?:\/\//i.test(raw)) return "";
  if (/\.(?:md|markdown)(?:$|[?#])/i.test(raw)) return raw.replace(/[?#].*$/, "");
  return "";
}

function isDirectMarkdownUrl(input) {
  const raw = extractLinkCandidate(input);
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return /\.(?:md|markdown)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractDocRef(value) {
  if (Array.isArray(value)) {
    const mention = value.find((item) => item?.link || item?.token);
    const title = value.map((item) => item?.text || "").join("").trim();
    const link = mention?.link || "";
    return {
      url: isFetchableRemoteDoc(link) ? link : "",
      token: mention?.token || tokenFromUrl(link),
      localPath: localMarkdownRef(link || title),
      title,
    };
  }

  const raw = text(value);
  return {
    url: isFetchableRemoteDoc(raw) ? raw : "",
    token: tokenFromUrl(raw),
    localPath: localMarkdownRef(raw),
    title: raw.startsWith("http") ? "" : raw,
  };
}

function isFetchableRemoteDoc(input) {
  const raw = extractLinkCandidate(input);
  return /^https?:\/\//i.test(raw) && !isDirectMarkdownUrl(raw);
}

function tokenFromUrl(input) {
  if (!input) return "";
  const match = String(input).match(/\/(?:wiki|docx?)\/([^/?#]+)/);
  return match?.[1] || "";
}

function extractLinkCandidate(input) {
  const raw = text(input);
  if (!raw) return "";
  const markdownLink = raw.match(/\[[^\]]+\]\(([^)]+)\)/);
  return (markdownLink?.[1] || raw).trim();
}

function firstMarkdownHeading(markdown) {
  const match = String(markdown || "").match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "";
}

function buildLocalDocumentId(input) {
  const fileName = path.basename(String(input || ""));
  return slugify(fileName.replace(/\.(?:md|markdown)$/i, "")) || randomUUID();
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function sanitizeFileName(input) {
  return String(input || "source.md")
    .replace(/[/:\\?%*"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "source.md";
}

function safeDecodeURIComponent(input) {
  try {
    return decodeURIComponent(String(input || ""));
  } catch {
    return String(input || "");
  }
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

function shortErrorMessage(error) {
  return String(error?.message || error || "未知错误").replace(/\s+/g, " ").trim().slice(0, 220);
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
    "/Applications/ChatGPT.app/Contents/Resources/codex",
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

async function runJson(args) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runJsonOnce(args);
    } catch (error) {
      lastError = error;
      if (!isRetryableLarkCliError(error) || attempt === maxAttempts) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

function runJsonOnce(args) {
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
        resolve(parseCliJson(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse CLI JSON output: ${error.message}\n${stdout}`));
      }
    });
  });
}

function isRetryableLarkCliError(error) {
  const message = String(error?.message || error || "");
  return /type":\s*"network"|subtype":\s*"(timeout|transport)"|i\/o timeout|no such host|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCliJson(stdout) {
  const output = String(stdout || "").trim();
  if (!output) throw new Error("empty output");

  try {
    return JSON.parse(output);
  } catch {
    const jsonStart = output
      .split(/\r?\n/)
      .findIndex((line) => line.trim().startsWith("{") || line.trim().startsWith("["));
    if (jsonStart < 0) throw new Error("no JSON object found");
    return JSON.parse(output.split(/\r?\n/).slice(jsonStart).join("\n"));
  }
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const values = parseEnv(existing);
const currentBaseUrl = values.AI_BASE_URL || values.OPENAI_BASE_URL || "https://api.openai.com/v1";
const currentModel = values.AI_MODEL || values.OPENAI_MODEL || "gpt-4.1-mini";

const baseUrlInput = (await rl.question(`AI Base URL [${currentBaseUrl}]: `)).trim();
const modelInput = (await rl.question(`AI Model [${currentModel}]: `)).trim();
const apiKey = (await rl.question("AI API key: ")).trim();
rl.close();

if (!apiKey) {
  console.error("No key entered. .env was not changed.");
  process.exit(1);
}

const defaults = {
  AI_PROVIDER: "compatible",
  AI_BASE_URL: baseUrlInput || currentBaseUrl,
  AI_MODEL: modelInput || currentModel,
  SEO_SPREADSHEET_TOKEN: "your_feishu_spreadsheet_token",
  SEO_HOT_SHEET_ID: "your_hot_topic_sheet_id",
  SEO_BLOG_SHEET_ID: "your_manuscript_review_sheet_id",
  SEO_CONFIG_SHEET_ID: "your_seo_config_sheet_id",
  SEO_STRATEGY_SHEET_ID: "your_strategy_sheet_id",
  SEO_MAX_ROWS: "200",
  SEO_HOT_SOURCE_LIMIT: "6",
  SEO_ENABLE_GOOGLE_NEWS: "false",
  SEO_REVISED_DOC_PARENT_TOKEN: "",
  LARK_CLI_BIN: "",
};

values.AI_API_KEY = apiKey;
for (const [key, value] of Object.entries(defaults)) {
  if (key.startsWith("AI_")) values[key] = value;
  else if (!(key in values)) values[key] = value;
}

delete values.OPENAI_API_KEY;
delete values.OPENAI_MODEL;
delete values.OPENAI_BASE_URL;

const orderedKeys = ["AI_PROVIDER", "AI_API_KEY", ...Object.keys(defaults).filter((key) => key !== "AI_PROVIDER")];
const output = orderedKeys.map((key) => `${key}=${values[key] ?? ""}`).join("\n") + "\n";
fs.writeFileSync(envPath, output, { mode: 0o600 });

console.log(".env configured.");

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

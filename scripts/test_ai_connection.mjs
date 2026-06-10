import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const env = readDotEnv(path.join(rootDir, ".env"));

const AI_PROVIDER = (process.env.AI_PROVIDER || env.AI_PROVIDER || "codex").toLowerCase();
const AI_BASE_URL = normalizeBaseUrl(process.env.AI_BASE_URL || env.AI_BASE_URL || process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1");
const AI_MODEL = process.env.AI_MODEL || env.AI_MODEL || process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_API_KEY = process.env.AI_API_KEY || env.AI_API_KEY || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
const CODEX_MODEL = process.env.CODEX_MODEL || env.CODEX_MODEL || "";
const CODEX_CLI_BIN = process.env.CODEX_CLI_BIN || env.CODEX_CLI_BIN || "/Applications/Codex.app/Contents/Resources/codex";

if (AI_PROVIDER === "codex") {
  console.log(`Testing Codex CLI: ${CODEX_CLI_BIN}`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "Return only this JSON object: {\"ok\":true}",
  ];
  if (CODEX_MODEL) args.splice(args.length - 1, 0, "--model", CODEX_MODEL);
  await runCommand(CODEX_CLI_BIN, args, { timeoutMs: 120000 });
  console.log("Codex CLI connection OK.");
  process.exit(0);
}

if (!AI_API_KEY) {
  console.error("AI_API_KEY is missing. Run: npm run setup:key");
  process.exit(1);
}
console.log(`Testing AI provider: ${AI_BASE_URL}`);
console.log(`Model: ${AI_MODEL}`);

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
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: "Return {\"ok\":true}" },
      ],
      response_format: { type: "json_object" },
    }),
  });
} catch (error) {
  console.error(`Connection failed: ${error.message || error}`);
  process.exit(1);
}

const body = await response.text();
if (!response.ok) {
  console.error(`AI API returned ${response.status}: ${body.slice(0, 1000)}`);
  process.exit(1);
}

console.log("AI API connection OK.");
console.log(body.slice(0, 500));

function normalizeBaseUrl(input) {
  return String(input || "").replace(/\/+$/, "");
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

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
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

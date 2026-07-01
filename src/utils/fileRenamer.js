import { FILENAME_FORMATS, IMAGE_EXTENSIONS, NAME_LENGTHS, WINDOWS_RESERVED_NAMES } from "../data/constants.js";

const log = (...args) => console.log("[ai-image-renamer]", ...args);

export async function ensureReadWritePermission(handle) {
  const options = { mode: "readwrite" };
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(options)) === "granted";
}

export async function describeImage(session, file, lang, length) {
  const lengthOption = NAME_LENGTHS.find((item) => item.value === length) || NAME_LENGTHS[0];
  log("prompt:start", {
    fileName: file.name,
    type: file.type,
    size: file.size,
    language: lang.code,
    length,
  });

  const result = await session.prompt([
    {
      role: "user",
      content: [
        {
          type: "text",
          value: `${lang.prompt} ${lengthOption.instruction} Return only the filename stem. Example: ${lang.example}`,
        },
        { type: "image", value: file },
      ],
    },
  ]);

  const text = String(result || "").trim();
  log("prompt:result", { fileName: file.name, length: text.length, preview: text.slice(0, 120) });
  if (!text) {
    throw new Error("AI returned an empty description.");
  }
  return text;
}

export async function renameFile(row, newName) {
  if (row.name === newName) return;
  if (typeof row.handle.move === "function") {
    await row.handle.move(newName);
    return;
  }
  throw new Error("Direct rename is not available in this browser.");
}

export function uniqueName(row, description, rows, rowIndex, options) {
  const extension = extensionOf(row.name);
  const stem = normalizeStem(description, options) || normalizeStem(row.name, options);
  let candidate = `${stem}${extension}`;
  const used = new Set([
    ...rows
      .filter((_, index) => index !== rowIndex)
      .map((item) => item.name.toLocaleLowerCase()),
    ...rows
      .slice(0, rowIndex)
      .map((item) => item.newName.toLocaleLowerCase())
      .filter(Boolean),
  ]);

  if (candidate.toLocaleLowerCase() === row.name.toLocaleLowerCase()) {
    return candidate;
  }

  if (used.has(candidate.toLocaleLowerCase()) && options.conflictStrategy === "skip") {
    return null;
  }

  if (used.has(candidate.toLocaleLowerCase()) && options.conflictStrategy === "index") {
    candidate = `${stem}${numberSeparator(options.format)}${formatIndex(rowIndex + 1)}${extension}`;
  }

  if (used.has(candidate.toLocaleLowerCase()) && options.conflictStrategy === "hash") {
    candidate = `${stem}${numberSeparator(options.format)}${shortHash(row.relativePath || row.name)}${extension}`;
  }

  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase()) && candidate.toLocaleLowerCase() !== row.name.toLocaleLowerCase()) {
    candidate = `${stem}${numberSeparator(options.format)}${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

export function normalizeStem(value, options) {
  const language = typeof options === "string" ? options : options.language;
  const format = typeof options === "string" ? "hyphen" : options.format;
  const separator = formatSeparator(format);

  if (language === "en") {
    let text = String(value)
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/u, "")
      .replace(/&/gu, " and ")
      .replace(/[^a-z0-9]+/gu, " ")
      .trim();
    text = text.split(/\s+/u).filter(Boolean).slice(0, 10).join(separator) || "image";
    return avoidReserved(trimSeparators(text.slice(0, 90), separator) || "image");
  }

  let text = String(value)
    .replace(/\.[^.\\/:*?"<>|\s]{1,8}$/u, "")
    .replace(/[\\/:*?"<>|]/gu, " ")
    .replace(/[`"'“”‘’]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/^[ ._-]+|[ ._-]+$/gu, "");

  if (String(language).startsWith("zh")) {
    text = text.match(/[\u4e00-\u9fff][\u4e00-\u9fff\w -]{0,32}/u)?.[0] || text;
  }

  text = text.split(/\s+/u).filter(Boolean).join(separator);
  return avoidReserved(trimSeparators(text.slice(0, 90), separator) || "image");
}

function formatSeparator(format) {
  return FILENAME_FORMATS.find((item) => item.value === format)?.separator ?? "-";
}

function numberSeparator(format) {
  return format === "compact" ? "-" : formatSeparator(format);
}

function formatIndex(value) {
  return String(value).padStart(3, "0");
}

function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}

function trimSeparators(value, separator) {
  if (!separator) {
    return value.replace(/^[ ._-]+|[ ._-]+$/gu, "");
  }
  const extraSeparator = separator === "-" ? "" : separator.replace(/[\\\]^]/gu, "\\$&");
  return value.replace(new RegExp(`^[ ._${extraSeparator}-]+|[ ._${extraSeparator}-]+$`, "gu"), "");
}

function avoidReserved(value) {
  const stem = value.replace(/^[ .]+|[ .]+$/gu, "");
  return WINDOWS_RESERVED_NAMES.has(stem.toLowerCase()) ? `${stem}-image` : stem;
}

export function formatState(state, t) {
  if (state === "Skipped") return t.stateSkipped || "Skipped";
  if (state === "Restored") return t.stateRestored || "Restored";
  if (state === "Pending") return t.statePending;
  if (state === "Ready") return t.stateReady;
  if (state === "Renamed") return t.stateRenamed;
  if (state === "Keep") return t.stateKeep;
  if (state === "Canceled") return t.stateCanceled;
  if (state === "Analyzing") return t.stateAnalyzing;
  if (state === "Renaming") return t.stateRenaming;
  if (state === "Skipped: name conflict") return t.stateSkippedConflict;
  if (String(state).startsWith("Failed:")) {
    return `${t.failed}: ${String(state).slice("Failed:".length).trim()}`;
  }
  return state;
}

export function isReady(row) {
  return row.state === "Ready" && row.selected !== false && !row.skipped && row.newName && row.name !== row.newName;
}

export function validateNewName(name) {
  if (!name || name.includes("/") || name.includes("\\") || /[<>:"|?*]/u.test(name)) {
    throw new Error("Invalid file name.");
  }
}

export function isImageName(name) {
  return IMAGE_EXTENSIONS.has(extensionOf(name).slice(1).toLowerCase());
}

export function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

export function isRecoverablePromptError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.name === "TimeoutError" || message.includes("session has been destroyed");
}




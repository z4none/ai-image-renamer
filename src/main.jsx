import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CircleAlert,
  CheckCircle2,
  Download,
  Folder,
  Github,
  Globe2,
  Images,
  Languages,
  Loader2,
  Moon,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";
import "./styles.css";
import { CONFLICT_STRATEGIES, FILENAME_FORMATS, LANGUAGES, LEGAL_TEXT, NAME_LENGTHS, UI_LOCALES, UI_TEXT } from "./data/constants.js";
import { describeImage, ensureReadWritePermission, isImageName, isReady, isRecoverablePromptError, renameFile, uniqueName, validateNewName, withTimeout } from "./utils/fileRenamer.js";
import { IconButton, ImageTable, ProgressBar, SelectControl, Stat } from "./components/ui.jsx";

const PROMPT_TIMEOUT_MS = 60_000;
const MAX_PROMPTS_PER_SESSION = 24;
const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";
const GITHUB_URL = "https://github.com/z4none/ai-image-renamer";
const LAST_BATCH_KEY = "ai-image-renamer-last-batch";
const ROW_FILTERS = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "renamed", label: "Renamed" },
  { value: "skipped", label: "Skipped" },
];

const log = (...args) => console.log("[ai-image-renamer]", ...args);
const logError = (...args) => console.error("[ai-image-renamer]", ...args);
const STATUS_TEXT_KEYS = [
  "initialStatus",
  "permissionDenied",
  "scanningFolder",
  "scanningRecursive",
  "noSupportedImages",
  "analysisComplete",
  "analysisCanceled",
  "renameComplete",
  "renameCanceled",
  "downloadingModel",
  "reinitializingModel",
];

function LogoMark() {
  return <img className="brandLogo" src="/logo-192.png" alt="" draggable="false" />;
}

function Root() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("ai-image-renamer-theme");
    if (stored) return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [uiLocale, setUiLocale] = useState(() => localeFromPath(window.location.pathname) || localStorage.getItem("ai-image-renamer-ui-locale") || "en");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ai-image-renamer-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ai-image-renamer-ui-locale", uiLocale);
  }, [uiLocale]);

  useEffect(() => {
    function handlePopState() {
      setPath(normalizePath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    setPath(normalizePath(nextPath));
  }

  if (path === "/app") {
    return <RenamerApp navigate={navigate} setTheme={setTheme} setUiLocale={setUiLocale} theme={theme} uiLocale={uiLocale} />;
  }

  if (isLegalPath(path)) {
    return (
      <LegalPage
        navigate={navigate}
        path={path}
        setTheme={setTheme}
        setUiLocale={setUiLocale}
        theme={theme}
        uiLocale={uiLocale}
      />
    );
  }

  return (
    <LandingPage
      navigate={navigate}
      setTheme={setTheme}
      setUiLocale={setUiLocale}
      theme={theme}
      uiLocale={uiLocale}
    />
  );
}

function RenamerApp({ navigate, setTheme, setUiLocale, theme, uiLocale }) {
  const [language, setLanguage] = useState("en");
  const [filenameFormat, setFilenameFormat] = useState("hyphen");
  const [nameLength, setNameLength] = useState("short");
  const [conflictStrategy, setConflictStrategy] = useState("append");
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [rows, setRows] = useState([]);
  const [rowFilter, setRowFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");
  const [undoRecoveryTip, setUndoRecoveryTip] = useState(null);
  const [progress, setProgressState] = useState({ value: 0, max: 1 });
  const [lastBatch, setLastBatch] = useState(() => readLastBatch());
  const [support, setSupport] = useState({
    aiAvailability: "unknown",
    browserName: "Unknown",
    chromeVersion: null,
    hasDirectoryPicker: false,
    hasImagePrompt: false,
    hasLanguageModel: false,
    hasDirectRename: false,
  });
  const [supportChecked, setSupportChecked] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isCancelRequested, setIsCancelRequested] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const sessionRef = useRef(null);
  const sessionLanguageRef = useRef(null);
  const sessionPromptCountRef = useRef(0);
  const analyzingRef = useRef(false);
  const cancelRequestedRef = useRef(false);

  const selectedLanguage = useMemo(
    () => LANGUAGES.find((item) => item.code === language) || LANGUAGES[0],
    [language],
  );
  const t = useMemo(() => UI_TEXT[uiLocale] || UI_TEXT.en, [uiLocale]);
  const landingPath = uiLocale === "en" ? "/" : `/${uiLocale}`;
  const readyCount = rows.filter(isReady).length;
  const visibleRows = useMemo(() => filterRows(rows, rowFilter, searchQuery), [rowFilter, rows, searchQuery]);
  const failedCount = rows.filter((row) => String(row.state).startsWith("Failed")).length;

  useEffect(() => {
    if (!rows.length && !folderName) {
      setStatus(t.initialStatus);
    }
  }, [folderName, rows.length, t]);

  useEffect(() => {
    setStatus((currentStatus) => translateStaticStatus(currentStatus, t));
  }, [t]);

  useEffect(() => {
    let isMounted = true;

    async function checkSupport() {
      const hasDirectoryPicker = "showDirectoryPicker" in window;
      const hasLanguageModel = "LanguageModel" in window;
      const hasDirectRename =
        "FileSystemFileHandle" in window && typeof window.FileSystemFileHandle?.prototype?.move === "function";
      const browserInfo = getBrowserInfo();
      let aiAvailability = "unavailable";
      let hasImagePrompt = false;

      if (hasLanguageModel) {
        try {
          aiAvailability = await window.LanguageModel.availability({
            expectedInputs: [{ type: "text" }, { type: "image" }],
          });
          hasImagePrompt = aiAvailability !== "unavailable";
        } catch (error) {
          logError("support:availability:failed", error);
        }
      }

      if (!isMounted) return;
      setSupport({
        ...browserInfo,
        aiAvailability,
        hasDirectoryPicker,
        hasDirectRename,
        hasImagePrompt,
        hasLanguageModel,
      });
      setSupportChecked(true);
      log("support", { ...browserInfo, aiAvailability, hasDirectoryPicker, hasDirectRename, hasImagePrompt, hasLanguageModel });
    }

    void checkSupport();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    analyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

  useEffect(() => {
    void resetSession();
  }, [language]);

  const supportMessage = useMemo(() => {
    if (!support.hasDirectoryPicker || !support.hasDirectRename || !support.hasImagePrompt) {
      return [
        !support.hasDirectoryPicker ? t.fileApiUnavailable : "",
        !support.hasDirectRename ? t.directRenameUnavailable : "",
        !support.hasImagePrompt ? t.aiUnavailable : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return t.supportReady;
  }, [support, t]);

  const canUseApp = support.hasDirectoryPicker && support.hasDirectRename && support.hasImagePrompt;

  async function pickFolder() {
    log("pickFolder:start");
    let nextDirectoryHandle = null;
    try {
      nextDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error?.name === "AbortError") {
        log("pickFolder:canceled");
        return;
      }
      throw error;
    }
    setUndoRecoveryTip(null);
    setFolderName(nextDirectoryHandle.name);
    setDirectoryHandle(nextDirectoryHandle);
    const permission = await ensureReadWritePermission(nextDirectoryHandle);
    if (!permission) {
      setStatus(t.permissionDenied);
      return;
    }

    await scanDirectory(nextDirectoryHandle, includeSubfolders || batchNeedsRecursiveScan(lastBatch));
  }

  async function scanDirectory(handle, recursive) {
    setStatus(recursive ? t.scanningRecursive : t.scanningFolder);
    setProgress(0, 1);
    const discovered = [];
    for await (const item of walkDirectory(handle, "", recursive)) {
      if (isImageName(item.name)) {
        discovered.push({
          ...item,
          id: `${item.relativePath}-${discovered.length}`,
          newName: "",
          skipped: false,
          state: "Pending",
          previewUrl: "",
        });
      }
    }

    const nextRows = hydrateRowsFromLastBatch(discovered, lastBatch);
    setRows(nextRows);
    setProgress(discovered.length ? 0 : 1, Math.max(1, discovered.length));
    const recoveredUndoCount = nextRows.filter((row) => row.undoBatchItem).length;
    setStatus(
      recoveredUndoCount
        ? `${t.images}: ${discovered.length} · Undo ready: ${recoveredUndoCount}`
        : discovered.length
          ? `${t.images}: ${discovered.length}`
          : t.noSupportedImages,
    );
    log("scanDirectory:done", { count: discovered.length, recoveredUndoCount, recursive });
  }

  async function changeIncludeSubfolders(checked) {
    setIncludeSubfolders(checked);
    if (directoryHandle) {
      await scanDirectory(directoryHandle, checked || batchNeedsRecursiveScan(lastBatch));
    }
  }

  async function analyzeImages() {
    if (!rows.length) return;
    cancelRequestedRef.current = false;
    setIsCancelRequested(false);
    setIsAnalyzing(true);
    setProgress(0, rows.length);
    log("analyze:start", { count: rows.length, language });

    try {
      const plannedRows = rows.map((row) => ({ ...row }));
      for (let index = 0; index < plannedRows.length; index += 1) {
        if (cancelRequestedRef.current) {
          break;
        }
        const row = plannedRows[index];
        if (row.skipped) {
          setProgress(index + 1, plannedRows.length);
          continue;
        }
        updateRow(index, { state: "Analyzing" });
        setStatus(`${t.analyzing} ${index + 1}/${plannedRows.length}: ${row.relativePath}`);
        log("analyze:image:start", { index: index + 1, total: plannedRows.length, path: row.relativePath });

        try {
          const file = await row.handle.getFile();
          const description = await describeImageWithRetry(file, selectedLanguage, nameLength);
          const newName = uniqueName(row, description, plannedRows, index, {
            language,
            format: filenameFormat,
            conflictStrategy,
          });
          if (!newName) {
            plannedRows[index] = { ...plannedRows[index], newName: "", state: "Skipped: name conflict" };
            updateRow(index, { newName: "", state: "Skipped: name conflict" });
            log("analyze:image:skipped-conflict", { path: row.relativePath, description });
            continue;
          }
          plannedRows[index] = { ...plannedRows[index], newName, state: newName === row.name ? "Keep" : "Ready" };
          updateRow(index, { newName, state: newName === row.name ? "Keep" : "Ready" });
          log("analyze:image:ready", { path: row.relativePath, description, newName });
        } catch (error) {
          const state = cancelRequestedRef.current ? "Canceled" : `Failed: ${error.message || error}`;
          plannedRows[index] = { ...plannedRows[index], state };
          updateRow(index, { state });
          logError("analyze:image:failed", { path: row.relativePath, error });
        }

        setProgress(index + 1, plannedRows.length);
        if (cancelRequestedRef.current) {
          break;
        }
      }
    } finally {
      setIsAnalyzing(false);
      setIsCancelRequested(false);
      setStatus(cancelRequestedRef.current ? t.analysisCanceled : t.analysisComplete);
      cancelRequestedRef.current = false;
    }
  }

  async function applyRenames() {
    cancelRequestedRef.current = false;
    setIsCancelRequested(false);
    setIsApplying(true);
    const applyableRows = rows.map((row, index) => ({ ...row, index })).filter(isReady);
    const batch = {
      id: `batch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      folderName,
      items: [],
      undone: false,
    };
    setProgress(0, applyableRows.length || 1);
    log("apply:start", { count: applyableRows.length });

    try {
      for (let applyIndex = 0; applyIndex < applyableRows.length; applyIndex += 1) {
        if (cancelRequestedRef.current) {
          break;
        }
        const current = applyableRows[applyIndex];

        updateRow(current.index, { state: "Renaming" });
        setStatus(`${t.applyRenames} ${applyIndex + 1}/${applyableRows.length}: ${current.relativePath}`);

        try {
          validateNewName(current.newName);
          await renameFile(current, current.newName);
          const nextRelativePath = replacePathBasename(current.relativePath, current.newName);
          updateRow(current.index, {
            name: current.newName,
            relativePath: nextRelativePath,
            state: "Renamed",
          });
          batch.items.push({
            id: current.id,
            oldName: current.name,
            newName: current.newName,
            oldRelativePath: current.relativePath,
            newRelativePath: nextRelativePath,
            state: "Renamed",
          });
          log("apply:file:done", { newName: current.newName });
        } catch (error) {
          const message = String(error.message || error);
          updateRow(current.index, { state: `Failed: ${message}` });
          batch.items.push({
            id: current.id,
            oldName: current.name,
            newName: current.newName,
            oldRelativePath: current.relativePath,
            newRelativePath: replacePathBasename(current.relativePath, current.newName),
            state: "Failed",
            error: message,
          });
          logError("apply:file:failed", { oldName: current.name, error });
        }

        setProgress(applyIndex + 1, applyableRows.length || 1);
        if (cancelRequestedRef.current) {
          break;
        }
      }
      if (batch.items.length) {
        persistLastBatch(batch);
        setLastBatch(batch);
      }
      setStatus(cancelRequestedRef.current ? t.renameCanceled : t.renameComplete);
    } finally {
      setIsApplying(false);
      setIsCancelRequested(false);
      cancelRequestedRef.current = false;
    }
  }

  async function cancelCurrentTask() {
    log("cancel:requested", { isAnalyzing, isApplying });
    cancelRequestedRef.current = true;
    setIsCancelRequested(true);
    setStatus(isAnalyzing ? `${t.canceling}...` : `${t.canceling}...`);
    if (isAnalyzing) {
      await resetSession();
    }
  }

  function updateRow(index, patch) {
    setRows((currentRows) => currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function exportRenamePlan() {
    if (!rows.length) return;
    const csv = toCsv([
      ["relativePath", "currentName", "generatedName", "state", "skipped"],
      ...rows.map((row) => [
        row.relativePath,
        row.name,
        row.newName,
        row.skipped ? "Skipped" : row.state,
        row.skipped ? "true" : "false",
      ]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-image-renamer-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function undoLastBatch() {
    if (!lastBatch?.items?.length) return;
    const renamedItems = lastBatch.items.filter((item) => item.state === "Renamed");
    if (!renamedItems.length) return;
    const undoTargets = renamedItems
      .map((item) => ({ item, rowIndex: findUndoRowIndex(rows, item) }))
      .filter((target) => target.rowIndex >= 0);
    if (!undoTargets.length) {
      setUndoRecoveryTip({
        title: `Open ${lastBatch.folderName || "the original folder"} again`,
        body: "Click this tip to choose the folder and reconnect Undo Last.",
      });
      return;
    }
    cancelRequestedRef.current = false;
    setIsApplying(true);
    setProgress(0, undoTargets.length);

    try {
      for (let index = 0; index < undoTargets.length; index += 1) {
        const { item, rowIndex } = undoTargets[index];
        const row = rows[rowIndex];

        setStatus(`Undo ${index + 1}/${undoTargets.length}: ${item.newRelativePath}`);
        updateRow(rowIndex, { state: "Renaming" });
        try {
          await renameFile(row, item.oldName);
          updateRow(rowIndex, {
            name: item.oldName,
            newName: item.oldName,
            relativePath: item.oldRelativePath,
            skipped: false,
            undoBatchItem: null,
            state: "Restored",
          });
        } catch (error) {
          updateRow(rowIndex, { state: `Failed: ${error.message || error}` });
        }
        setProgress(index + 1, undoTargets.length);
      }

      const nextBatch = { ...lastBatch, undone: true, undoneAt: new Date().toISOString() };
      persistLastBatch(nextBatch);
      setLastBatch(nextBatch);
      setStatus("Undo complete.");
    } finally {
      setIsApplying(false);
    }
  }

  async function getSession(lang) {
    if (
      sessionRef.current &&
      sessionLanguageRef.current === lang.code &&
      sessionPromptCountRef.current < MAX_PROMPTS_PER_SESSION
    ) {
      return sessionRef.current;
    }

    if (sessionRef.current && sessionPromptCountRef.current >= MAX_PROMPTS_PER_SESSION) {
      log("session:recycle-before-limit", {
        count: sessionPromptCountRef.current,
        max: MAX_PROMPTS_PER_SESSION,
      });
    }

    await resetSession();
    const options = createSessionOptions(lang);
    const availability = await window.LanguageModel.availability(options);
    log("session:availability", availability);
    if (availability === "unavailable") {
      throw new Error("Chrome built-in AI is unavailable on this browser.");
    }
    if (availability === "downloading" && !analyzingRef.current) {
      setStatus(t.downloadingModel);
      setProgress(0, 1);
    }

    sessionRef.current = await window.LanguageModel.create(options);
    sessionLanguageRef.current = lang.code;
    sessionPromptCountRef.current = 0;
    return sessionRef.current;
  }

  function createSessionOptions(lang) {
    const options = {
      expectedInputs: [{ type: "text" }, { type: "image" }],
      temperature: 0.1,
      topK: 1,
      monitor(monitorTarget) {
        monitorTarget.addEventListener("downloadprogress", (event) => {
          const loaded = Number(event.loaded) || 0;
          const percent = Math.round(loaded * 100);
          log("session:downloadprogress", { loaded, percent });
          if (analyzingRef.current) {
            setStatus(t.reinitializingModel);
          } else {
            setStatus(`${t.modelDownloading}: ${percent}%`);
            setProgress(loaded, 1);
          }
        });
      },
    };

    if (lang.apiLanguage === "en") {
      options.expectedInputs = [
        { type: "text", languages: ["en"] },
        { type: "image" },
      ];
      options.expectedOutputs = [{ type: "text", languages: ["en"] }];
    }
    return options;
  }

  async function resetSession() {
    if (sessionRef.current) {
      sessionRef.current.destroy();
    }
    sessionRef.current = null;
    sessionLanguageRef.current = null;
    sessionPromptCountRef.current = 0;
  }

  async function describeImageWithRetry(file, lang, length) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const session = await getSession(lang);
        const description = await withTimeout(
          describeImage(session, file, lang, length),
          PROMPT_TIMEOUT_MS,
          `AI prompt timed out after ${Math.round(PROMPT_TIMEOUT_MS / 1000)}s`,
        );
        sessionPromptCountRef.current += 1;
        return description;
      } catch (error) {
        await resetSession();
        if (attempt >= maxAttempts || !isRecoverablePromptError(error)) {
          throw error;
        }
        log("prompt:retrying-with-new-session", { attempt: attempt + 1 });
      }
    }
    throw new Error("AI prompt failed.");
  }

  if (!supportChecked) {
    return (
      <UnsupportedScreen
        icon={<Sparkles size={28} />}
        title="AI Image Renamer"
        message={t.initialStatus}
        theme={theme}
        setTheme={setTheme}
        showMatrix={false}
        support={support}
        t={t}
        onHome={() => navigate(landingPath)}
      />
    );
  }

  if (!canUseApp) {
    return (
      <UnsupportedScreen
        icon={<CircleAlert size={28} />}
        title="AI Image Renamer"
        message={supportMessage}
        missing={[
          !support.hasDirectoryPicker ? t.fileApiUnavailable : "",
          !support.hasDirectRename ? t.directRenameUnavailable : "",
          !support.hasImagePrompt ? t.aiUnavailable : "",
        ].filter(Boolean)}
        theme={theme}
        setTheme={setTheme}
        support={support}
        t={t}
        onHome={() => navigate(landingPath)}
      />
    );
  }

  return (
    <main className="appShell">
      <header className="hero">
        <div className="brandCluster">
          <div className="brandMark logoMarkWrap" aria-hidden="true">
            <LogoMark />
          </div>
          <div>
            <h1>AI Image Renamer</h1>
            <p>{supportMessage || t.appIntro}</p>
          </div>
        </div>
        <div className="heroActions">
          <IconButton
            variant="ghost"
            icon={<ArrowLeft size={18} />}
            label="Home"
            onClick={() => navigate(landingPath)}
          />
          <SelectControl
            className="uiLocaleSelect"
            icon={<Globe2 size={16} />}
            label={t.uiLanguage}
            value={uiLocale}
            options={UI_LOCALES.map((locale) => ({ value: locale.code, label: locale.label }))}
            onChange={setUiLocale}
          />
          <IconButton
            variant="ghost"
            icon={theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            label={theme === "dark" ? "Light" : "Dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
        </div>
      </header>

      <section className="toolbar" aria-label={t.appIntro}>
        <div className="toolbarGroup toolbarLeft">
          <IconButton
            variant="secondary"
            icon={<Folder size={18} />}
            label={t.openFolder}
            disabled={!support.hasDirectoryPicker || isAnalyzing || isApplying}
            onClick={pickFolder}
          />
          <label className="switchRow">
            <input
              type="checkbox"
              checked={includeSubfolders}
              disabled={!directoryHandle || isAnalyzing || isApplying}
              onChange={(event) => void changeIncludeSubfolders(event.target.checked)}
            />
            <span className="switchTrack" aria-hidden="true" />
            <span>{t.includeSubfolders}</span>
          </label>
        </div>

        <div className="toolbarGroup toolbarCenter">
          <div className="settingsStrip">
            <div className="settingsGrid">
              <label className="field settingField languageField">
                <span>
                  <Languages size={14} />
                  {t.language}
                </span>
                <SelectControl
                  value={language}
                  options={LANGUAGES.map((item) => ({ value: item.code, label: `${item.label} · ${item.output}` }))}
                  onChange={setLanguage}
                />
              </label>
              <label className="field settingField">
                <span>{t.format}</span>
                <SelectControl
                  value={filenameFormat}
                  disabled={isAnalyzing || isApplying}
                  options={FILENAME_FORMATS.map((item) => ({
                    value: item.value,
                    label: t[item.labelKey],
                    description: t[item.descriptionKey],
                  }))}
                  onChange={setFilenameFormat}
                />
              </label>
              <label className="field settingField">
                <span>{t.length}</span>
                <SelectControl
                  value={nameLength}
                  disabled={isAnalyzing || isApplying}
                  options={NAME_LENGTHS.map((item) => ({
                    value: item.value,
                    label: t[item.labelKey],
                    description: t[item.descriptionKey],
                  }))}
                  onChange={setNameLength}
                />
              </label>
              <label className="field settingField">
                <span>{t.conflict}</span>
                <SelectControl
                  value={conflictStrategy}
                  disabled={isAnalyzing || isApplying}
                  options={CONFLICT_STRATEGIES.map((item) => ({
                    value: item.value,
                    label: t[item.labelKey],
                    description: t[item.descriptionKey],
                  }))}
                  onChange={setConflictStrategy}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="toolbarGroup toolbarRight">
          <IconButton
            variant="primary"
            icon={isAnalyzing ? <Loader2 className="spin" size={18} /> : <Bot size={18} />}
            label={isAnalyzing ? t.analyzing : t.analyze}
            disabled={!rows.length || !support.hasImagePrompt || isAnalyzing || isApplying}
            onClick={analyzeImages}
          />
          <IconButton
            variant="primary"
            icon={<Save size={18} />}
            label={t.applyRenames}
            disabled={!readyCount || isAnalyzing || isApplying}
            onClick={applyRenames}
          />
          <IconButton
            variant="secondary"
            icon={<Download size={18} />}
            label="Export CSV"
            disabled={!rows.length || isAnalyzing || isApplying}
            onClick={exportRenamePlan}
          />
          <IconButton
            variant="secondary"
            icon={<RotateCcw size={18} />}
            label="Undo Last"
            disabled={!canAttemptUndo(lastBatch) || isAnalyzing || isApplying}
            onClick={undoLastBatch}
          />
          <IconButton
            variant="secondary"
            icon={<X size={18} />}
            label={isCancelRequested ? t.canceling : t.cancel}
            disabled={(!isAnalyzing && !isApplying) || isCancelRequested}
            onClick={cancelCurrentTask}
          />
        </div>
      </section>

      <section className="workspace">
        <div className="reviewBar">
          <label className="searchField">
            <span>Search</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Current, generated, or path"
            />
          </label>
          <label className="filterField">
            <span>Status</span>
            <SelectControl
              label="Status"
              value={rowFilter}
              options={ROW_FILTERS}
              onChange={setRowFilter}
            />
          </label>
        </div>
        <div className="statusPanel" aria-live="polite">
          <div className="statusMessage">
            <span>{t.status}</span>
            {undoRecoveryTip ? (
              <button className="statusTip" type="button" onClick={pickFolder}>
                <CircleAlert size={17} />
                <span className="statusTipText">
                  <strong>{undoRecoveryTip.title}</strong>
                  <small>{undoRecoveryTip.body}</small>
                </span>
              </button>
            ) : (
              <strong>{status}</strong>
            )}
          </div>
          <div className="fileStats" aria-label={t.status}>
            {folderName ? <Stat label={t.folder} value={folderName} /> : null}
            <Stat label={t.images} value={rows.length} />
            <Stat label={t.ready} value={readyCount} />
            <Stat label={t.failed} value={failedCount} tone={failedCount ? "danger" : ""} />
          </div>
          {lastBatch ? (
            <div className="batchSummary">
              <span>Last batch</span>
              <strong>{summarizeBatch(lastBatch)}</strong>
            </div>
          ) : null}
          <ProgressBar max={progress.max} value={progress.value} />
        </div>
        <ImageTable rows={visibleRows} setRows={setRows} t={t} />
      </section>
    </main>
  );

  function setProgress(value, max) {
    setProgressState({ value, max: Math.max(1, max) });
  }
}

function getBrowserInfo() {
  const brands = navigator.userAgentData?.brands || [];
  const chromeBrand = brands.find((brand) => /Google Chrome|Chromium|Chrome/u.test(brand.brand));
  const userAgentMatch = navigator.userAgent.match(/\b(?:Chrome|Chromium)\/(\d+)/u);
  const chromeVersion = Number(chromeBrand?.version || userAgentMatch?.[1]) || null;
  const isChromeLike = Boolean(chromeVersion);
  return {
    browserName: isChromeLike ? "Chrome" : "Unsupported browser",
    chromeVersion,
  };
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/u, "") || "/";
}

function localeFromPath(pathname) {
  const segment = normalizePath(pathname).split("/")[1];
  return UI_LOCALES.some((locale) => locale.code === segment) ? segment : "";
}

function isLegalPath(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  const last = parts.at(-1);
  return last === "terms" || last === "privacy";
}

function legalPathFor(locale, type) {
  const prefix = locale && locale !== "en" ? `/${locale}` : "";
  return `${prefix}/${type}`;
}

function readLastBatch() {
  try {
    return JSON.parse(localStorage.getItem(LAST_BATCH_KEY) || "null");
  } catch {
    return null;
  }
}

function persistLastBatch(batch) {
  localStorage.setItem(LAST_BATCH_KEY, JSON.stringify(batch));
}

function filterRows(rows, filter, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows
    .map((row, originalIndex) => ({ ...row, originalIndex }))
    .filter((row) => rowMatchesFilter(row, filter))
    .filter((row) => {
      if (!normalizedQuery) return true;
      return [row.name, row.newName, row.relativePath]
        .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
    });
}

function hydrateRowsFromLastBatch(rows, batch) {
  if (!canAttemptUndo(batch)) return rows;
  const renamedItemsByNewPath = new Map(
    batch.items
      .filter((item) => item.state === "Renamed")
      .map((item) => [normalizeRelativePath(item.newRelativePath), item]),
  );

  return rows.map((row) => {
    const batchItem = renamedItemsByNewPath.get(normalizeRelativePath(row.relativePath));
    if (!batchItem) return row;
    return {
      ...row,
      id: batchItem.id,
      newName: batchItem.oldName,
      skipped: false,
      state: "Renamed",
      undoBatchItem: batchItem,
    };
  });
}

function findUndoRowIndex(rows, batchItem) {
  const normalizedNewPath = normalizeRelativePath(batchItem.newRelativePath);
  return rows.findIndex(
    (row) =>
      row.id === batchItem.id ||
      normalizeRelativePath(row.relativePath) === normalizedNewPath ||
      normalizeRelativePath(row.undoBatchItem?.newRelativePath) === normalizedNewPath,
  );
}

function canAttemptUndo(batch) {
  return Boolean(batch?.items?.some((item) => item.state === "Renamed") && !batch.undone);
}

function batchNeedsRecursiveScan(batch) {
  return Boolean(
    batch?.items?.some(
      (item) =>
        item.state === "Renamed" &&
        (String(item.oldRelativePath || "").includes("/") || String(item.newRelativePath || "").includes("/")),
    ),
  );
}

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/gu, "/").replace(/^\/+/u, "").toLocaleLowerCase();
}

function rowMatchesFilter(row, filter) {
  if (filter === "all") return true;
  if (filter === "skipped") return Boolean(row.skipped);
  if (row.skipped) return false;
  if (filter === "ready") return row.state === "Ready";
  if (filter === "pending") return row.state === "Pending" || row.state === "Analyzing";
  if (filter === "failed") return String(row.state).startsWith("Failed");
  if (filter === "renamed") return row.state === "Renamed" || row.state === "Restored";
  return true;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
}

function replacePathBasename(relativePath, nextName) {
  const normalizedPath = String(relativePath || "");
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex >= 0 ? `${normalizedPath.slice(0, slashIndex + 1)}${nextName}` : nextName;
}

function summarizeBatch(batch) {
  const renamed = batch.items?.filter((item) => item.state === "Renamed").length || 0;
  const failed = batch.items?.filter((item) => item.state === "Failed").length || 0;
  const suffix = batch.undone ? " · undone" : "";
  const folder = batch.folderName ? ` · ${batch.folderName}` : "";
  return `${renamed} renamed, ${failed} failed${suffix}${folder}`;
}

function translateStaticStatus(currentStatus, t) {
  for (const key of STATUS_TEXT_KEYS) {
    const isKnownStatus = Object.values(UI_TEXT).some((localeText) => localeText[key] === currentStatus);
    if (isKnownStatus) {
      return t[key];
    }
  }
  return currentStatus;
}

function LandingPage({ navigate, setTheme, setUiLocale, theme, uiLocale }) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const t = UI_TEXT[uiLocale] || UI_TEXT.en;
  const screenshotSrc = theme === "dark" ? "/screenshot-dark.png" : "/screenshot-light.png";
  const features = [
    {
      icon: <Images size={20} />,
      title: t.landingFeatureAiTitle,
      body: t.landingFeatureAiBody,
    },
    {
      icon: <Folder size={20} />,
      title: t.landingFeatureFolderTitle,
      body: t.landingFeatureFolderBody,
    },
    {
      icon: <ShieldCheck size={20} />,
      title: t.landingFeaturePrivacyTitle,
      body: t.landingFeaturePrivacyBody,
    },
    {
      icon: <WandSparkles size={20} />,
      title: t.landingFeatureNamingTitle,
      body: t.landingFeatureNamingBody,
    },
    {
      icon: <Languages size={20} />,
      title: t.landingFeatureLanguagesTitle,
      body: t.landingFeatureLanguagesBody,
    },
    {
      icon: <Globe2 size={20} />,
      title: t.landingFeatureOnlineTitle,
      body: t.landingFeatureOnlineBody,
    },
  ];
  const useCases = [
    [t.landingUseCasePhotoTitle, t.landingUseCasePhotoBody],
    [t.landingUseCaseAssetTitle, t.landingUseCaseAssetBody],
    [t.landingUseCaseArchiveTitle, t.landingUseCaseArchiveBody],
  ];
  const faqs = [
    [t.landingFaqPrivacyQuestion, t.landingFaqPrivacyAnswer],
    [t.landingFaqChromeQuestion, t.landingFaqChromeAnswer],
    [t.landingFaqReviewQuestion, t.landingFaqReviewAnswer],
  ];
  const steps = [
    [t.landingStepFolderTitle, t.landingStepFolderBody],
    [t.landingStepRulesTitle, t.landingStepRulesBody],
    [t.landingStepAnalyzeTitle, t.landingStepAnalyzeBody],
    [t.landingStepApplyTitle, t.landingStepApplyBody],
  ];
  const freeItems = [
    [t.landingFreeAccountTitle, t.landingFreeAccountBody],
    [t.landingFreeApiKeyTitle, t.landingFreeApiKeyBody],
    [t.landingFreeDownloadTitle, t.landingFreeDownloadBody],
  ];
  const changeLandingLocale = (nextLocale) => {
    setUiLocale(nextLocale);
    navigate(nextLocale === "en" ? "/" : `/${nextLocale}`);
  };

  return (
    <main className="landingShell">
      <SiteNav
        homePath={uiLocale === "en" ? "/" : `/${uiLocale}`}
        navigate={navigate}
        onLocaleChange={changeLandingLocale}
        setTheme={setTheme}
        t={t}
        theme={theme}
        uiLocale={uiLocale}
      />

      <section className="landingHero">
        <div className="landingCopy">
          <p className="landingEyebrow">{t.landingEyebrow}</p>
          <h1>{t.landingHeadline}</h1>
          <p className="landingLead">{t.landingLead}</p>
          <div className="landingCtas">
            <span className="freeBadge">{t.landingFreeBadge}</span>
            <IconButton
              variant="primary"
              icon={<ArrowRight size={27} />}
              label={t.getStarted}
              onClick={() => navigate("/app")}
            />
            <span className="landingRequirement">
              {t.landingRequirementPrefix}
              <a href={CHROME_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                {t.chrome148LinkLabel}
              </a>
              {t.landingRequirementSuffix}
            </span>
          </div>
        </div>

        <button
          className="screenshotPreview"
          type="button"
          aria-label={t.openScreenshotPreview}
          onClick={() => setIsLightboxOpen(true)}
        >
          <img src={screenshotSrc} alt={t.landingScreenshotAlt} />
        </button>
      </section>

      {isLightboxOpen ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={t.landingScreenshotAlt}>
          <button className="lightboxBackdrop" type="button" aria-label={t.closeScreenshotPreview} onClick={() => setIsLightboxOpen(false)} />
          <div className="lightboxPanel">
            <button className="lightboxClose" type="button" aria-label={t.closeScreenshotPreview} onClick={() => setIsLightboxOpen(false)}>
              <X size={22} />
            </button>
            <img src={screenshotSrc} alt={t.landingScreenshotAlt} />
          </div>
        </div>
      ) : null}

      <section className="featureGrid" aria-label={t.landingFeaturesLabel}>
        {features.map((feature) => (
          <article className="featureCard" key={feature.title}>
            <span className="featureIcon" aria-hidden="true">
              {feature.icon}
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="contentSection">
        <div className="sectionHeader">
          <p className="landingEyebrow">{t.landingHowItWorksEyebrow}</p>
          <h2>{t.landingHowItWorksTitle}</h2>
          <p>{t.landingHowItWorksIntro}</p>
        </div>
        <div className="stepsGrid">
          {steps.map(([title, body], index) => (
            <article className="stepCard" key={title}>
              <span>{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contentSection freeSection">
        <div className="sectionHeader">
          <p className="landingEyebrow">{t.landingFreeEyebrow}</p>
          <h2>{t.landingFreeTitle}</h2>
          <p>{t.landingFreeIntro}</p>
        </div>
        <div className="freeGrid">
          {freeItems.map(([title, body]) => (
            <article className="freeCard" key={title}>
              <CheckCircle2 size={20} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contentSection">
        <div className="sectionHeader">
          <p className="landingEyebrow">{t.landingUseCasesEyebrow}</p>
          <h2>{t.landingUseCasesTitle}</h2>
          <p>{t.landingUseCasesIntro}</p>
        </div>
        <div className="useCaseGrid">
          {useCases.map(([title, body]) => (
            <article className="useCaseCard" key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contentSection">
        <div className="sectionHeader">
          <p className="landingEyebrow">{t.landingFaqEyebrow}</p>
          <h2>{t.landingFaqTitle}</h2>
        </div>
        <div className="faqList">
          {faqs.map(([question, answer]) => (
            <details className="faqItem" key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="siteFooter">
        <div>
          <strong>AI Image Renamer</strong>
          <p>{t.footerDescription}</p>
        </div>
        <nav aria-label={t.footerLinksLabel}>
          <a className="githubLink" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Github size={16} />
            <span>GitHub</span>
          </a>
          <a href={legalPathFor(uiLocale, "terms")}>{t.terms}</a>
          <a href={legalPathFor(uiLocale, "privacy")}>{t.privacy}</a>
        </nav>
      </footer>
    </main>
  );
}

function LegalPage({ navigate, path, setTheme, setUiLocale, theme, uiLocale }) {
  const pathLocale = localeFromPath(path);
  const activeLocale = pathLocale || uiLocale;
  const t = UI_TEXT[activeLocale] || UI_TEXT.en;
  const legal = LEGAL_TEXT[activeLocale] || LEGAL_TEXT.en;
  const type = normalizePath(path).split("/").filter(Boolean).at(-1) === "privacy" ? "privacy" : "terms";
  const pageTitle = type === "privacy" ? legal.privacyTitle : legal.termsTitle;

  const changeLocale = (nextLocale) => {
    setUiLocale(nextLocale);
    navigate(legalPathFor(nextLocale, type));
  };

  return (
    <main className="legalShell">
      <SiteNav
        homePath={activeLocale === "en" ? "/" : `/${activeLocale}`}
        navigate={navigate}
        onLocaleChange={changeLocale}
        setTheme={setTheme}
        t={t}
        theme={theme}
        uiLocale={activeLocale}
      />

      <article className="legalArticle">
        <p className="landingEyebrow">{pageTitle}</p>
        <h1>{legal.title}</h1>
        <p className="legalDate">{legal.lastUpdated}</p>
        <p className="legalIntro">{legal.intro}</p>
        {legal.sections.map((section) => (
          <section className="legalSection" key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <dl>
                {section.bullets.map(([term, detail]) => (
                  <React.Fragment key={term}>
                    <dt>{term}</dt>
                    <dd>{detail}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
          </section>
        ))}
      </article>
    </main>
  );
}

function SiteNav({ homePath, navigate, onLocaleChange, setTheme, t, theme, uiLocale }) {
  const [isNavScrolled, setIsNavScrolled] = useState(false);

  useEffect(() => {
    const updateNavState = () => setIsNavScrolled(window.scrollY > 8);
    updateNavState();
    window.addEventListener("scroll", updateNavState, { passive: true });
    return () => window.removeEventListener("scroll", updateNavState);
  }, []);

  return (
    <header className={isNavScrolled ? "landingNav isScrolled" : "landingNav"}>
      <div className="landingNavInner">
        <button className="landingBrand" type="button" onClick={() => navigate(homePath)}>
          <span className="brandMark logoMarkWrap" aria-hidden="true">
            <LogoMark />
          </span>
          <span>AI Image Renamer</span>
        </button>
        <div className="landingActions">
          <SelectControl
            className="uiLocaleSelect"
            icon={<Globe2 size={16} />}
            label={t.uiLanguage}
            value={uiLocale}
            options={UI_LOCALES.map((locale) => ({ value: locale.code, label: locale.label }))}
            onChange={onLocaleChange}
          />
          <IconButton
            variant="ghost"
            icon={theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            label={theme === "dark" ? "Light" : "Dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
          <IconButton
            variant="primary"
            icon={<ArrowRight size={18} />}
            label={t.getStarted}
            onClick={() => navigate("/app")}
          />
        </div>
      </div>
    </header>
  );
}

function UnsupportedScreen({ icon, message, missing = [], onHome, setTheme, showMatrix = true, support, t, theme, title }) {
  const chromeVersionText = support.chromeVersion ? `${support.browserName} ${support.chromeVersion}` : t.browserUnknown;
  const featureChecks = [
    {
      label: t.requiredChrome,
      detail: `${chromeVersionText} · ${t.requiredChromeDetail}`,
      ok: Boolean(support.chromeVersion && support.chromeVersion >= 148),
    },
    {
      label: t.folderAccessFeature,
      detail: t.folderAccessFeatureDetail,
      ok: support.hasDirectoryPicker,
    },
    {
      label: t.directRenameFeature,
      detail: t.directRenameFeatureDetail,
      ok: support.hasDirectRename,
    },
    {
      label: t.promptApiFeature,
      detail: support.aiAvailability ? `${t.promptApiFeatureDetail} · ${support.aiAvailability}` : t.promptApiFeatureDetail,
      ok: support.hasLanguageModel,
    },
    {
      label: t.imageInputFeature,
      detail: t.imageInputFeatureDetail,
      ok: support.hasImagePrompt,
    },
  ];

  return (
    <main className="unsupportedShell">
      <section className="unsupportedPanel" aria-live="polite">
        <div className="unsupportedTopBar">
          <div className="unsupportedHeader">
            <div className="brandMark" aria-hidden="true">
              {icon}
            </div>
            <div>
              <h1>{title}</h1>
              <p>{message}</p>
            </div>
          </div>
          <div className="unsupportedActions">
            {onHome ? (
              <IconButton
                variant="ghost"
                icon={<ArrowLeft size={18} />}
                label="Home"
                onClick={onHome}
              />
            ) : null}
            <IconButton
              variant="ghost"
              icon={theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              label={theme === "dark" ? "Light" : "Dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            />
          </div>
        </div>

        {missing.length ? (
          <ul className="unsupportedList">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {showMatrix ? (
          <div className="supportMatrix" aria-label={t.supportMatrix}>
            {featureChecks.map((item) => (
              <div className="supportRow" key={item.label}>
                <span className={item.ok ? "supportIcon ok" : "supportIcon fail"} aria-hidden="true">
                  {item.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <p className="unsupportedHint">{t.unsupportedHint}</p>
      </section>
    </main>
  );
}

async function* walkDirectory(handle, relativePath, recursive) {
  for await (const [name, child] of handle.entries()) {
    const childPath = relativePath ? `${relativePath}/${name}` : name;
    if (child.kind === "file") {
      yield {
        directory: handle,
        handle: child,
        name,
        relativePath: childPath,
      };
    } else if (recursive && child.kind === "directory") {
      yield* walkDirectory(child, childPath, recursive);
    }
  }
}

createRoot(document.getElementById("root")).render(<Root />);

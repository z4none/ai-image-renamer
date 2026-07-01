import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, FileImage, RotateCcw } from "lucide-react";
import { extensionOf, formatState } from "../utils/fileRenamer.js";

const logError = (...args) => console.error("[ai-image-renamer]", ...args);

export function IconButton({ icon, label, variant, ...props }) {
  return (
    <button className={`button ${variant || "secondary"}`} type="button" {...props}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ProgressBar({ max, value }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.min(safeMax, Math.max(0, Number(value) || 0));
  const percent = (safeValue / safeMax) * 100;

  return (
    <div
      aria-valuemax={safeMax}
      aria-valuemin={0}
      aria-valuenow={safeValue}
      className="progressRoot"
      role="progressbar"
    >
      <div className="progressIndicator" style={{ transform: `translateX(-${100 - percent}%)` }} />
    </div>
  );
}

export function SelectControl({ className = "", disabled = false, icon = null, label, onChange, options, value }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`selectControl ${className}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="selectTrigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {icon ? <span className="selectIcon">{icon}</span> : null}
        <span className="selectValue">{selectedOption?.label}</span>
        <span className="selectChevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="selectPopup" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="selectItem"
              key={option.value}
              role="option"
              type="button"
              onClick={() => choose(option.value)}
            >
              <span className="selectItemLabel">{option.label}</span>
              {option.description ? <span className="selectItemDescription">{option.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ImageTable({ rows, setRows, t }) {
  if (!rows.length) {
    return (
      <div className="emptyState">
        <FileImage size={36} />
        <strong>{t.noImagesTitle}</strong>
        <span>{t.noImagesBody}</span>
      </div>
    );
  }

  function updateName(index, newName) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, newName } : row)),
    );
  }

  return (
    <div className="tableScroller">
      <table>
        <thead>
          <tr>
            <th>{t.preview}</th>
            <th>{t.currentName}</th>
            <th>{t.generatedName}</th>
            <th>{t.status}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <ImageRow
              key={row.id}
              row={row}
              index={row.originalIndex ?? index}
              onNameChange={updateName}
              t={t}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageRow({ row, index, onNameChange, t }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const extension = extensionOf(row.newName || row.name);

  useEffect(() => {
    let active = true;
    let url = "";
    row.handle
      .getFile()
      .then((file) => {
        if (!active) return;
        url = URL.createObjectURL(file);
        setPreviewUrl(url);
      })
      .catch((error) => logError("preview:failed", { path: row.relativePath, error }));

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [row.handle, row.relativePath]);

  const stateClass = row.state === "Ready" || row.state === "Renamed" ? "done" : String(row.state).startsWith("Failed") ? "error" : "";
  const stateLabel = formatState(row.state, t);

  return (
    <tr>
      <td>
        <div className="thumb">{previewUrl ? <img src={previewUrl} alt={row.name} /> : <FileImage size={22} />}</div>
      </td>
      <td>
        <div className="nameStack">
          <strong>{row.name}</strong>
          <span>{row.relativePath}</span>
        </div>
      </td>
      <td>
        <div className="editField">
          <input
            value={row.newName}
            onChange={(event) => onNameChange(index, event.target.value)}
            placeholder={t.generatedPlaceholder}
            disabled={row.skipped || row.state === "Renamed"}
            spellCheck="false"
          />
          <span className="extensionHint">{extension || "name"}</span>
        </div>
      </td>
      <td>
        <span className={`statePill ${stateClass}`}>
          {stateClass === "done" ? <CheckCircle2 size={15} /> : stateClass === "error" ? <CircleAlert size={15} /> : <RotateCcw size={15} />}
          {stateLabel}
        </span>
      </td>
    </tr>
  );
}



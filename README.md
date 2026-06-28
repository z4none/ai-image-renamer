# AI Image Renamer

Rename local image files in Chrome using built-in AI and the File System Access API.

The app is a React/Vite frontend. Images stay local and are passed to Chrome's built-in model from the browser.

## Requirements

- Chrome with built-in AI Prompt API support enabled.
- File System Access API support.
- Node.js 22+ for local development.

## Run

```powershell
cd D:\Side\vivida\ai-image-renamer
pnpm install
pnpm dev
```

Open:

```text
http://127.0.0.1:5177
```

## Build

```powershell
pnpm build
```

The production build pre-renders SEO landing pages for `/`, `/de/`, `/ja/`, `/fr/`, `/es/`, and `/zh/`. The app route is emitted at `/app/`.

Set the public site URL before building so canonical and Open Graph URLs use your deployment domain:

```powershell
$env:SITE_URL="https://your-domain.com"; npm run build
```

## Usage

1. Click `Open Folder`.
2. Toggle `Include subfolders` if you want to rescan the selected folder recursively.
3. Pick an output language: English, German, Japanese, French, Spanish, or Chinese.
4. Choose filename format, name length, and conflict strategy.
5. Click `Analyze`.
6. Review or edit generated names.
7. Click `Apply Renames`.

Use the `Dark` / `Light` button to switch themes. The selection is saved in the browser.

## Notes

- Renaming uses the browser's direct file rename capability.
- Chrome built-in AI multilingual output can vary by browser version and installed model.
- Keep a backup or run on a copied folder first.

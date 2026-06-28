import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGAL_TEXT, UI_LOCALES, UI_TEXT } from "../src/data/constants.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const templatePath = path.join(distDir, "index.html");
const siteUrl = normalizeSiteUrl(process.env.SITE_URL || process.env.VITE_SITE_URL || "https://ai-image-renamer.local");
const chromeDownloadUrl = "https://www.google.com/chrome/";

const localeMeta = {
  en: { htmlLang: "en", path: "/", title: "AI Image Renamer - Local AI batch image renaming" },
  de: { htmlLang: "de", path: "/de/", title: "AI Image Renamer - Lokale KI-Bildumbenennung" },
  ja: { htmlLang: "ja", path: "/ja/", title: "AI Image Renamer - ローカル AI 画像リネーム" },
  fr: { htmlLang: "fr", path: "/fr/", title: "AI Image Renamer - Renommage local d'images par IA" },
  es: { htmlLang: "es", path: "/es/", title: "AI Image Renamer - Renombrado local de imágenes con IA" },
  zh: { htmlLang: "zh-CN", path: "/zh/", title: "AI Image Renamer - 本地 AI 批量图片重命名" },
  "zh-TW": { htmlLang: "zh-TW", path: "/zh-TW/", title: "AI Image Renamer - 本機 AI 批次圖片重新命名" },
};

const landingLocales = UI_LOCALES.map((locale) => locale.code);
const template = await readFile(templatePath, "utf8");
const assetHeadTags = extractPreservedHeadTags(template, { pwa: false });
const appHeadTags = extractPreservedHeadTags(template, { pwa: true });

for (const locale of landingLocales) {
  const meta = localeMeta[locale] || localeMeta.en;
  const t = UI_TEXT[locale] || UI_TEXT.en;
  const html = renderDocument({
    body: renderLanding(t),
    description: t.landingLead,
    htmlLang: meta.htmlLang,
    pathName: meta.path,
    title: meta.title,
  });
  const outputDir = meta.path === "/" ? distDir : path.join(distDir, meta.path);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), html);
}

for (const locale of landingLocales) {
  for (const type of ["terms", "privacy"]) {
    const meta = localeMeta[locale] || localeMeta.en;
    const legalPath = `${meta.path === "/" ? "/" : meta.path}${type}/`;
    const legal = LEGAL_TEXT[locale] || LEGAL_TEXT.en;
    const pageTitle = type === "privacy" ? legal.privacyTitle : legal.termsTitle;
    const html = renderDocument({
      body: renderLegalPage(locale, type),
      description: legal.intro,
      htmlLang: meta.htmlLang,
      pathName: legalPath,
      title: `${pageTitle} - AI Image Renamer`,
    });
    const outputDir = path.join(distDir, ...legalPath.split("/").filter(Boolean));
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "index.html"), html);
  }
}

await mkdir(path.join(distDir, "app"), { recursive: true });
await writeFile(
  path.join(distDir, "app", "index.html"),
  renderDocument({
    body: "",
    description: UI_TEXT.en.appIntro,
    htmlLang: "en",
    pathName: "/app/",
    title: "AI Image Renamer App",
    noIndex: true,
  }),
);

function renderDocument({ body, description, htmlLang, noIndex = false, pathName, title }) {
  const canonicalUrl = `${siteUrl}${pathName}`;
  const legalType = pathName.endsWith("/terms/") ? "terms" : pathName.endsWith("/privacy/") ? "privacy" : "";
  const preservedHeadTags = pathName === "/app/" ? appHeadTags : assetHeadTags;
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    noIndex ? `<meta name="robots" content="noindex, nofollow">` : `<meta name="robots" content="index, follow">`,
    `<link rel="canonical" href="${canonicalUrl}">`,
    ...landingLocales.map((locale) => {
      const meta = localeMeta[locale] || localeMeta.en;
      const alternatePath = legalType ? `${meta.path === "/" ? "/" : meta.path}${legalType}/` : meta.path;
      return `<link rel="alternate" hreflang="${meta.htmlLang}" href="${siteUrl}${alternatePath}">`;
    }),
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}${legalType ? `/${legalType}/` : "/"}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="AI Image Renamer">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${canonicalUrl}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<script type="application/ld+json">${JSON.stringify(renderJsonLd({ description, title, url: canonicalUrl }))}</script>`,
    preservedHeadTags,
  ].join("\n    ");

  return template
    .replace(/<html[^>]*>/u, `<html lang="${htmlLang}">`)
    .replace(/<head>[\s\S]*?<\/head>/u, `<head>\n    ${head}\n  </head>`)
    .replace(`<div id="root"></div>`, `<div id="root">${body}</div>`);
}

function extractPreservedHeadTags(html, { pwa }) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/u)?.[1] || "";
  const tagPattern = pwa
    ? /<(?:script|link|meta)\b(?=[^>]*(?:\/assets\/|manifest\.webmanifest|registerSW\.js|rel="(?:icon|apple-touch-icon)"|name="theme-color"))[^>]*(?:><\/script>|>)/gu
    : /<(?:script|link)\b(?=[^>]*\/assets\/)[^>]*(?:><\/script>|>)/gu;
  return [...head.matchAll(tagPattern)]
    .map((match) => match[0].trim())
    .join("\n    ");
}

function renderLanding(t) {
  const currentLocale = landingLocales.find((locale) => UI_TEXT[locale] === t) || "en";
  const localePrefix = currentLocale === "en" ? "" : `/${currentLocale}`;
  const features = [
    ["AI", t.landingFeatureAiTitle, t.landingFeatureAiBody],
    ["DIR", t.landingFeatureFolderTitle, t.landingFeatureFolderBody],
    ["LOC", t.landingFeaturePrivacyTitle, t.landingFeaturePrivacyBody],
    ["CFG", t.landingFeatureNamingTitle, t.landingFeatureNamingBody],
    ["LANG", t.landingFeatureLanguagesTitle, t.landingFeatureLanguagesBody],
    ["WEB", t.landingFeatureOnlineTitle, t.landingFeatureOnlineBody],
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

  return `
    <main class="landingShell">
      ${renderSiteNav({ homePath: localePrefix || "/", t })}

      <section class="landingHero">
        <div class="landingCopy">
          <p class="landingEyebrow">${escapeHtml(t.landingEyebrow)}</p>
          <h1>${escapeHtml(t.landingHeadline)}</h1>
          <p class="landingLead">${escapeHtml(t.landingLead)}</p>
          <div class="landingCtas">
            <span class="freeBadge">${escapeHtml(t.landingFreeBadge)}</span>
            <a class="button primary" href="/app/">${escapeHtml(t.getStarted)}</a>
            <span class="landingRequirement">${escapeHtml(t.landingRequirementPrefix)}<a href="${chromeDownloadUrl}" target="_blank" rel="noreferrer">${escapeHtml(t.chrome148LinkLabel)}</a>${escapeHtml(t.landingRequirementSuffix)}</span>
          </div>
        </div>

        <a class="screenshotPreview" href="/screenshot-light.png" aria-label="${escapeHtml(t.openScreenshotPreview)}">
          <picture>
            <source srcset="/screenshot-dark.png" media="(prefers-color-scheme: dark)">
            <img src="/screenshot-light.png" alt="${escapeHtml(t.landingScreenshotAlt)}">
          </picture>
        </a>
      </section>

      <section class="featureGrid" aria-label="${escapeHtml(t.landingFeaturesLabel)}">
        ${features
          .map(
            ([icon, title, body]) => `
              <article class="featureCard">
                <span class="featureIcon" aria-hidden="true">${escapeHtml(icon)}</span>
                <h2>${escapeHtml(title)}</h2>
                <p>${escapeHtml(body)}</p>
              </article>
            `,
          )
          .join("")}
      </section>

      <section class="contentSection">
        <div class="sectionHeader">
          <p class="landingEyebrow">${escapeHtml(t.landingHowItWorksEyebrow)}</p>
          <h2>${escapeHtml(t.landingHowItWorksTitle)}</h2>
          <p>${escapeHtml(t.landingHowItWorksIntro)}</p>
        </div>
        <div class="stepsGrid">
          ${steps
            .map(
              ([title, body], index) => `
                <article class="stepCard">
                  <span>${index + 1}</span>
                  <h3>${escapeHtml(title)}</h3>
                  <p>${escapeHtml(body)}</p>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="contentSection freeSection">
        <div class="sectionHeader">
          <p class="landingEyebrow">${escapeHtml(t.landingFreeEyebrow)}</p>
          <h2>${escapeHtml(t.landingFreeTitle)}</h2>
          <p>${escapeHtml(t.landingFreeIntro)}</p>
        </div>
        <div class="freeGrid">
          ${freeItems
            .map(
              ([title, body]) => `
                <article class="freeCard">
                  <span aria-hidden="true">✓</span>
                  <h3>${escapeHtml(title)}</h3>
                  <p>${escapeHtml(body)}</p>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="contentSection">
        <div class="sectionHeader">
          <p class="landingEyebrow">${escapeHtml(t.landingUseCasesEyebrow)}</p>
          <h2>${escapeHtml(t.landingUseCasesTitle)}</h2>
          <p>${escapeHtml(t.landingUseCasesIntro)}</p>
        </div>
        <div class="useCaseGrid">
          ${useCases
            .map(
              ([title, body]) => `
                <article class="useCaseCard">
                  <h3>${escapeHtml(title)}</h3>
                  <p>${escapeHtml(body)}</p>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="contentSection">
        <div class="sectionHeader">
          <p class="landingEyebrow">${escapeHtml(t.landingFaqEyebrow)}</p>
          <h2>${escapeHtml(t.landingFaqTitle)}</h2>
        </div>
        <div class="faqList">
          ${faqs
            .map(
              ([question, answer]) => `
                <details class="faqItem">
                  <summary>${escapeHtml(question)}</summary>
                  <p>${escapeHtml(answer)}</p>
                </details>
              `,
            )
            .join("")}
        </div>
      </section>

      <footer class="siteFooter">
        <div>
          <strong>AI Image Renamer</strong>
          <p>${escapeHtml(t.footerDescription)}</p>
        </div>
        <nav aria-label="${escapeHtml(t.footerLinksLabel)}">
          <a href="${localePrefix}/terms/">${escapeHtml(t.terms)}</a>
          <a href="${localePrefix}/privacy/">${escapeHtml(t.privacy)}</a>
        </nav>
      </footer>
    </main>
  `;
}

function renderLegalPage(locale, type) {
  const legal = LEGAL_TEXT[locale] || LEGAL_TEXT.en;
  const t = UI_TEXT[locale] || UI_TEXT.en;
  const pageTitle = type === "privacy" ? legal.privacyTitle : legal.termsTitle;
  const localePrefix = locale === "en" ? "" : `/${locale}`;

  return `
    <main class="legalShell">
      ${renderSiteNav({ homePath: localePrefix || "/", t })}
      <article class="legalArticle">
        <p class="landingEyebrow">${escapeHtml(pageTitle)}</p>
        <h1>${escapeHtml(legal.title)}</h1>
        <p class="legalDate">${escapeHtml(legal.lastUpdated)}</p>
        <p class="legalIntro">${escapeHtml(legal.intro)}</p>
        ${legal.sections
          .map(
            (section) => `
              <section class="legalSection">
                <h2>${escapeHtml(section.title)}</h2>
                ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
                ${
                  section.bullets
                    ? `<dl>${section.bullets
                        .map(([term, detail]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd>`)
                        .join("")}</dl>`
                    : ""
                }
              </section>
            `,
          )
          .join("")}
      </article>
    </main>
  `;
}

function renderSiteNav({ homePath, t }) {
  return `
    <header class="landingNav">
      <div class="landingNavInner">
        <a class="landingBrand" href="${homePath}">
          <span class="brandMark logoMarkWrap" aria-hidden="true"><img class="brandLogo" src="/logo-192.png" alt="" draggable="false"></span>
          <span>AI Image Renamer</span>
        </a>
        <div class="landingActions">
          <a class="button primary" href="/app/">${escapeHtml(t.getStarted)}</a>
        </div>
      </div>
    </header>
  `;
}

function renderJsonLd({ description, title, url }) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AI Image Renamer",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Chrome",
    browserRequirements: "Chrome 148 or later with Prompt API image input",
    description,
    url,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Local folder image scanning",
      "Chrome built-in AI image understanding",
      "Batch filename generation",
      "Review before applying renames",
      "Multilingual filename output",
      "Photo library organization",
      "Creative asset cleanup",
      "Archive filename normalization",
    ],
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function normalizeSiteUrl(value) {
  return String(value).replace(/\/+$/u, "");
}

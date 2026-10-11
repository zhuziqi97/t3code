import type { TFunction } from "i18next";

const FIXED_ERROR_KEYS = [
  "appearance.theme.error.nameFirst",
  "appearance.theme.error.activate",
  "appearance.theme.error.save",
  "appearance.theme.error.create",
  "appearance.theme.error.readFile",
  "appearance.theme.error.tooLarge",
  "appearance.theme.error.notTheme",
  "appearance.theme.error.install",
  "appearance.theme.error.failed",
  "appearance.theme.error.select",
  "appearance.theme.error.invalid",
  "appearance.theme.error.search",
  "appearance.theme.error.readInstalled",
  "appearance.theme.error.add",
  "appearance.theme.error.colorsObject",
  "appearance.theme.error.addColor",
  "appearance.theme.error.jsonObject",
  "appearance.theme.error.name",
  "appearance.theme.error.appearance",
  "appearance.theme.error.colorsRequired",
  "appearance.theme.error.id",
  "appearance.theme.error.collection",
  "appearance.theme.error.variantsObject",
  "appearance.theme.error.variantNames",
  "appearance.theme.error.emptyCollection",
  "appearance.theme.error.invalidCollection",
  "appearance.theme.error.libraryChanged",
  "appearance.theme.error.vscodeBackground",
  "appearance.theme.error.timeout",
  "appearance.theme.error.searchUnavailable",
  "appearance.theme.error.largeResponse",
  "appearance.theme.error.unreadableResponse",
  "appearance.theme.error.unreadableSearch",
  "appearance.theme.error.detailsUnavailable",
  "appearance.theme.error.download",
  "appearance.theme.error.largeExtension",
  "appearance.theme.error.manifest",
  "appearance.theme.error.largeManifest",
  "appearance.theme.error.noColors",
  "appearance.theme.error.tooManyColors",
  "appearance.theme.error.checksum",
  "appearance.theme.error.checksumResponse",
  "appearance.theme.error.invalidChecksum",
  "appearance.theme.error.integrity",
  "appearance.theme.error.openPackage",
  "appearance.theme.error.noZipDirectory",
  "appearance.theme.error.zipDirectory",
  "appearance.theme.error.tooManyFiles",
  "appearance.theme.error.zip64",
  "appearance.theme.error.expansion",
  "appearance.theme.error.compression",
  "appearance.theme.error.packageMismatch",
  "appearance.theme.error.licenseMismatch",
  "appearance.theme.error.importColors",
  "appearance.theme.error.noCompatible",
] as const;

const PARAMETERIZED_ERRORS = [
  {
    pattern: /^Theme JSON is invalid: (.*)$/s,
    key: "appearance.theme.error.jsonSyntax",
    parameter: "detail",
  },
  {
    pattern: /^This theme file uses an unsupported version\. Expected (.+)\.$/s,
    key: "appearance.theme.error.version",
    parameter: "version",
  },
  {
    pattern: /^"(.*)" is not a supported theme color role\.$/s,
    key: "appearance.theme.error.role",
    parameter: "role",
  },
  {
    pattern:
      /^The color for "(.*)" must be a literal CSS color such as oklch\(0\.62 0\.2 280\)\.$/s,
    key: "appearance.theme.error.color",
    parameter: "role",
  },
  {
    pattern: /^The theme id "(.*)" is reserved\.$/s,
    key: "appearance.theme.error.reserved",
    parameter: "id",
  },
  {
    pattern: /^A theme named "(.*)" is already installed\.$/s,
    key: "appearance.theme.error.installed",
    parameter: "name",
  },
  {
    pattern: /^The theme "(.*)" is not installed\.$/s,
    key: "appearance.theme.error.notInstalled",
    parameter: "name",
  },
  {
    pattern: /^Theme variants must not repeat the base appearance "(.*)"\.$/s,
    key: "appearance.theme.error.repeatedAppearance",
    parameter: "mode",
  },
  {
    pattern: /^Too many copies of "(.*)"\.$/s,
    key: "appearance.theme.error.tooManyCopies",
    parameter: "name",
  },
  {
    pattern: /^Failed to read the theme library from (.+)\.$/s,
    key: "appearance.theme.error.storageRead",
    parameter: "key",
  },
  {
    pattern: /^Failed to write the theme library to (.+)\.$/s,
    key: "appearance.theme.error.storageWrite",
    parameter: "key",
  },
  {
    pattern: /^(.+) is not valid JSON\.$/s,
    key: "appearance.theme.error.json",
    parameter: "source",
  },
  {
    pattern: /^(.+) is missing from the extension package\.$/s,
    key: "appearance.theme.error.missingFile",
    parameter: "source",
  },
  {
    pattern: /^(.+) has unreadable size metadata\.$/s,
    key: "appearance.theme.error.sizeMetadata",
    parameter: "source",
  },
  {
    pattern: /^(.+) is too large\.$/s,
    key: "appearance.theme.error.largeFile",
    parameter: "source",
  },
] as const;

/** Parsers keep their diagnostic messages; translate owned prompts when shown,
 *  so an already-visible failure follows language changes without re-importing. */
export function translateThemeError(message: string, t: TFunction): string {
  for (const key of FIXED_ERROR_KEYS) {
    if (message === t(key, { lng: "en" })) return t(key);
  }
  for (const { pattern, key, parameter } of PARAMETERIZED_ERRORS) {
    const match = pattern.exec(message);
    if (!match) continue;
    const value = match[1]!;
    return t(key, {
      [parameter]:
        parameter === "source" && value === "Extension manifest"
          ? t("appearance.theme.error.manifestLabel")
          : value,
    });
  }
  const oversized =
    /^That file is (.+)\. Theme files are only a few KB, so this one was not read \(limit (.+)\)\.$/s.exec(
      message,
    );
  if (oversized) {
    return t("appearance.theme.error.oversized", { size: oversized[1], limit: oversized[2] });
  }
  const collision = /^“(.*)” already has a (light|dark) palette\. Pick another name\.$/s.exec(
    message,
  );
  if (collision) {
    return t("appearance.theme.error.paletteTakenRename", {
      name: collision[1],
      mode: t(`appearance.${collision[2]}`),
    });
  }
  const bothPalettes = /^“(.*)” already has light and dark palettes\. Pick another name\.$/s.exec(
    message,
  );
  if (bothPalettes) {
    return t("appearance.theme.error.bothPalettesTaken", { name: bothPalettes[1] });
  }
  return message;
}

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function loadLocalizationPackage() {
  const packageEntry = path.join(
    repoRoot,
    "packages/localization/dist/index.mjs",
  );
  return import(pathToFileURL(packageEntry).href);
}

export async function run(config) {
  const { runInspectLocalizationCommand } = await loadLocalizationPackage();

  return runInspectLocalizationCommand(config);
}

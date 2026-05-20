import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

export async function run(config) {
  const packageEntry = path.resolve(
    process.cwd(),
    "packages/localization/dist/index.js",
  );
  const { runInspectLocalizationCommand } = await import(
    pathToFileURL(packageEntry).href
  );

  return runInspectLocalizationCommand(config);
}

import type {
  LocalizationUnit,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitsResult,
} from './types';
import {
  fileRowsToLocalizationUnits,
  parseExternalSpreadsheet,
  writeTranslatedSpreadsheet,
} from './modules/FileModule';

type TranslateUnitsFn = (units: LocalizationUnit[]) => Promise<TranslateUnitsResult>;

export async function translateSpreadsheetFile(
  input: TranslateFileInput,
  translateUnits: TranslateUnitsFn,
): Promise<TranslateFileResult> {
  const parsed = await parseExternalSpreadsheet(input);
  const units = fileRowsToLocalizationUnits(parsed.artifact.rows);
  const translation = await translateUnits(units);
  await writeTranslatedSpreadsheet(parsed, translation, input.outputPath, input.format);

  return {
    ...translation,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
  };
}

import { mkdir, readFile, appendFile } from 'fs/promises';
import { dirname } from 'path';

export interface JsonlReadDiagnostic {
  line: number;
  raw: string;
  error: string;
}

export interface JsonlReadResult<T> {
  records: T[];
  diagnostics: JsonlReadDiagnostic[];
}

export async function appendJsonlRecord<T>(filePath: string, record: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readJsonlRecords<T = unknown>(filePath: string): Promise<JsonlReadResult<T>> {
  let content: string;

  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return { records: [], diagnostics: [] };
    }

    throw error;
  }

  const records: T[] = [];
  const diagnostics: JsonlReadDiagnostic[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }

    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      diagnostics.push({
        line: index + 1,
        raw: line,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { records, diagnostics };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

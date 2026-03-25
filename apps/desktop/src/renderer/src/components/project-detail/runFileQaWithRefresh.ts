import type { FileQaReport } from '@cat/core/project';

interface RunFileQaWithRefreshParams {
  fileId: number;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  runFileQA: (fileId: number) => Promise<FileQaReport>;
  loadData: () => Promise<void>;
}

export async function runFileQaWithRefresh({
  fileId,
  runMutation,
  runFileQA,
  loadData,
}: RunFileQaWithRefreshParams): Promise<FileQaReport> {
  return runMutation(async () => {
    const report = await runFileQA(fileId);
    await loadData();
    return report;
  });
}

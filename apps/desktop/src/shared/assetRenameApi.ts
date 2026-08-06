export interface ProjectFileRenameResult {
  name: string;
  internalFile: 'renamed' | 'missing' | 'unchanged';
}

export interface AssetRenameApi {
  renameFile: (fileId: number, name: string) => Promise<ProjectFileRenameResult>;
  renameTM: (tmId: string, name: string) => Promise<void>;
  renameTB: (tbId: string, name: string) => Promise<void>;
}

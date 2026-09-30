import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CATDatabase,
  acknowledgeCloudInstallReceipt,
  clearCloudInstallReceipt,
  getCloudInstallReceipt,
  initializeCloudInstallReceipts,
} from '@cat/db';

interface InstallationJournal {
  version: 1;
  id: string;
  projectUUID: string;
  projectId: number;
  revision: number;
  signature: string;
  hadDestination: boolean;
}
const installationIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function syncPath(path: string, directory = false): void {
  // Windows does not expose directory fsync through Node. File flushes and
  // atomic renames still apply; native Windows validation remains required.
  if (directory && process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function safeDirectory(path: string): void {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()))
    throw new Error('Unsafe cloud installation directory');
}

/** Couples filesystem replacement to a receipt inside the snapshot SQL commit. */
export class CloudProjectInstallations {
  private readonly journalsDir: string;
  constructor(
    private readonly db: CATDatabase,
    private readonly dbPath: string,
    private readonly projectsDir: string,
    directory: string,
  ) {
    this.journalsDir = join(directory, 'project-installations');
  }
  staging(id: string): string {
    if (!installationIdPattern.test(id)) throw new Error('Invalid cloud installation identity');
    return join(this.projectsDir, `.download-${id}`);
  }
  private paths(journal: InstallationJournal) {
    return {
      staging: this.staging(journal.id),
      backup: join(this.projectsDir, `.previous-${journal.id}`),
      destination: join(this.projectsDir, String(journal.projectId)),
      journal: join(this.journalsDir, `${journal.id}.json`),
    };
  }
  initialize(): void {
    safeDirectory(this.projectsDir);
    safeDirectory(this.journalsDir);
    mkdirSync(this.journalsDir, { recursive: true });
    syncPath(dirname(this.journalsDir), true);
    initializeCloudInstallReceipts(this.dbPath);
  }
  install(
    id: string,
    projectId: number,
    projectUUID: string,
    revision: number,
    signature: string,
  ): { installationId: string } {
    const journal: InstallationJournal = {
      version: 1,
      id,
      projectId,
      projectUUID,
      revision,
      signature,
      hadDestination: existsSync(join(this.projectsDir, String(projectId))),
    };
    this.validate(journal, id);
    const paths = this.paths(journal);
    for (const path of [paths.staging, paths.backup, paths.destination]) safeDirectory(path);
    if (existsSync(paths.backup) || existsSync(paths.journal))
      throw new Error('Cloud installation identity already exists');
    for (const name of readdirSync(paths.staging)) {
      const path = join(paths.staging, name);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        throw new Error('Unsafe staged cloud file');
      syncPath(path);
    }
    syncPath(paths.staging, true);
    // The recovery description reaches durable storage before moving old bytes.
    const temporaryJournal = `${paths.journal}.tmp`;
    writeFileSync(temporaryJournal, JSON.stringify(journal), { flag: 'wx' });
    syncPath(temporaryJournal);
    renameSync(temporaryJournal, paths.journal);
    syncPath(this.journalsDir, true);
    if (journal.hadDestination) renameSync(paths.destination, paths.backup);
    renameSync(paths.staging, paths.destination);
    syncPath(this.projectsDir, true);
    return { installationId: id };
  }
  private validate(value: unknown, id: string): InstallationJournal {
    const journal = value as InstallationJournal;
    if (
      !journal ||
      typeof journal !== 'object' ||
      journal.version !== 1 ||
      journal.id !== id ||
      !installationIdPattern.test(id) ||
      !Number.isSafeInteger(journal.projectId) ||
      journal.projectId < 1 ||
      typeof journal.projectUUID !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(journal.projectUUID) ||
      !Number.isSafeInteger(journal.revision) ||
      journal.revision < 1 ||
      typeof journal.signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(journal.signature) ||
      typeof journal.hadDestination !== 'boolean'
    )
      throw new Error('Invalid cloud installation journal');
    return journal;
  }
  recover(): void {
    this.initialize();
    for (const filename of readdirSync(this.journalsDir)) {
      if (!filename.endsWith('.json')) continue;
      const id = filename.slice(0, -5);
      this.complete(id);
    }
  }
  complete(id: string): void {
    const journalPath = join(this.journalsDir, `${id}.json`);
    if (!installationIdPattern.test(id)) throw new Error('Invalid cloud installation identity');
    if (!existsSync(journalPath)) return;
    if (!lstatSync(journalPath).isFile() || lstatSync(journalPath).isSymbolicLink())
      throw new Error('Unsafe cloud installation journal');
    const journal = this.validate(JSON.parse(readFileSync(journalPath, 'utf8')), id);
    const paths = this.paths(journal);
    for (const path of [paths.staging, paths.backup, paths.destination]) safeDirectory(path);
    const receipt = getCloudInstallReceipt(this.dbPath, id);
    if (receipt) {
      if (
        receipt.projectUUID !== journal.projectUUID ||
        this.db.getProject(journal.projectId)?.uuid !== journal.projectUUID ||
        !existsSync(paths.destination)
      )
        throw new Error('Cloud installation receipt does not match its files');
      acknowledgeCloudInstallReceipt(this.dbPath, id, journal.revision, journal.signature);
      rmSync(paths.backup, { recursive: true, force: true });
    } else if (existsSync(paths.backup)) {
      rmSync(paths.destination, { recursive: true, force: true });
      renameSync(paths.backup, paths.destination);
    } else if (!journal.hadDestination) {
      rmSync(paths.destination, { recursive: true, force: true });
    }
    rmSync(paths.staging, { recursive: true, force: true });
    syncPath(this.projectsDir, true);
    // Delete the journal before its SQL receipt. A crash in between leaves an
    // inert receipt, never a committed install mistaken for a rolled-back one.
    rmSync(paths.journal);
    syncPath(this.journalsDir, true);
    if (receipt) clearCloudInstallReceipt(this.dbPath, id);
  }
}

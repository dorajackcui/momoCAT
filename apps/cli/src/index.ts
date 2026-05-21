import { fileURLToPath } from 'node:url';
import { runCli } from './cli';

export { runCli } from './cli';

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : null;

if (entryPath && process.argv[1] === entryPath) {
  process.exitCode = await runCli(process.argv.slice(2));
}

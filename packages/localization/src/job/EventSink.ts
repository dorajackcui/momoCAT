import type { ProgressEventRecord } from './types';
import { appendJsonlRecord } from './JsonlStore';

export type StdoutWriter = (line: string) => void | Promise<void>;

export interface EventSinkOptions {
  stdout?: boolean;
  writeStdout?: StdoutWriter;
}

export class EventSink {
  private readonly stdout: boolean;
  private readonly writeStdout: StdoutWriter;

  constructor(
    private readonly filePath: string,
    options: EventSinkOptions = {},
  ) {
    this.stdout = options.stdout ?? false;
    this.writeStdout =
      options.writeStdout ??
      ((line) => {
        process.stdout.write(line);
      });
  }

  async append(record: ProgressEventRecord): Promise<void> {
    await appendJsonlRecord(this.filePath, record);

    if (this.stdout) {
      await this.writeStdout(`${JSON.stringify(record)}\n`);
    }
  }
}

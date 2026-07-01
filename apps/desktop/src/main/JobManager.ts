import { EventEmitter } from 'events';
import type { CancellationToken } from '@cat/localization';
import type { JobProgressEvent } from '../shared/ipc';

export type JobProgress = JobProgressEvent;

export type JobCancellationToken = CancellationToken;

export class JobManager extends EventEmitter {
  private jobs: Map<string, JobProgress> = new Map();

  public startJob(jobId: string, initialMessage?: string): JobProgress {
    const progress: JobProgress = {
      jobId,
      progress: 0,
      status: 'running',
      message: initialMessage,
      cancelRequested: false,
    };
    this.jobs.set(jobId, progress);
    this.emit('progress', progress);
    return progress;
  }

  public updateProgress(jobId: string, update: Partial<JobProgress>) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, update);
      this.emit('progress', job);
    }
  }

  public getJob(jobId: string): JobProgress | undefined {
    return this.jobs.get(jobId);
  }

  public getCancellationToken(jobId: string): JobCancellationToken {
    return {
      isCancellationRequested: () => this.isCancellationRequested(jobId),
    };
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    Object.assign(job, {
      cancelRequested: true,
      message: 'Stopping...',
    });
    this.emit('progress', job);
    return true;
  }

  public isCancellationRequested(jobId: string): boolean {
    return this.jobs.get(jobId)?.cancelRequested === true;
  }
}

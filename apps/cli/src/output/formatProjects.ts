import type { InspectProjectsResult, InspectProviderSummary } from '@cat/localization';

export function formatProjectsInspection(summary: InspectProjectsResult): string {
  const lines: string[] = [];
  lines.push(`Database: ${summary.dbPath}`);
  lines.push(`Projects: ${summary.projects.length}`);
  lines.push('');
  lines.push('API providers:');
  if (summary.providers.length === 0) {
    lines.push('  - no custom providers configured');
  } else {
    for (const provider of summary.providers) {
      lines.push(
        `  - ${provider.id} (${provider.name} / ${provider.model}) apiKey: ${formatKeyStatus(provider)} baseUrl: ${provider.baseUrl}`,
      );
    }
  }

  if (summary.projects.length === 0) {
    lines.push('');
    lines.push('No projects found.');
    return `${lines.join('\n')}\n`;
  }

  for (const project of summary.projects) {
    lines.push('');
    lines.push(`Project ${project.id}: ${project.name} [${project.srcLang} -> ${project.tgtLang}]`);
    lines.push(`  type: ${project.projectType}`);
    lines.push(`  model: ${formatProjectModel(project.model)}`);
    lines.push(`  prompt: ${project.promptChars} chars`);
    lines.push(`  mounted TM: ${project.mountedTMs.length}`);
    for (const tm of project.mountedTMs) {
      lines.push(
        `    - ${tm.name} [${tm.srcLang} -> ${tm.tgtLang}] type=${tm.type} priority=${tm.priority} permission=${tm.permission} enabled=${tm.isEnabled}`,
      );
    }
    lines.push(`  mounted TB: ${project.mountedTBs.length}`);
    for (const tb of project.mountedTBs) {
      lines.push(
        `    - ${tb.name} [${tb.srcLang} -> ${tb.tgtLang}] priority=${tb.priority} enabled=${tb.isEnabled}`,
      );
    }
    lines.push('  files:');
    if (project.files.length === 0) {
      lines.push('    - none');
    } else {
      for (const file of project.files) {
        lines.push(
          `    - file ${file.id}: ${file.name}, total=${file.totalSegments}, targetRows=${file.targetRows}, confirmed=${file.confirmedSegments}, status=${formatStatusCounts(file.statusCounts)}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatKeyStatus(
  provider: Pick<InspectProviderSummary, 'apiKeySet' | 'apiKeyLast4'>,
): string {
  return provider.apiKeySet
    ? `set${provider.apiKeyLast4 ? ` last4=${provider.apiKeyLast4}` : ''}`
    : 'missing';
}

function formatProjectModel(model: InspectProviderSummary): string {
  const providerLabel = model.model
    ? `${model.id} (${model.name} / ${model.model})`
    : `${model.id} (${model.name})`;
  const fallbackLabel = model.fallbackFrom ? ` fallbackFrom=${model.fallbackFrom}` : '';
  return `${providerLabel}, apiKey: ${formatKeyStatus(model)}${fallbackLabel}`;
}

function formatStatusCounts(statusCounts: Record<string, number>): string {
  const entries = Object.entries(statusCounts);
  if (entries.length === 0) {
    return 'none';
  }
  return entries.map(([status, count]) => `${status}:${count}`).join(', ');
}

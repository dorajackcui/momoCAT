import type { ProjectType } from '@cat/core/project';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Button, Card, Icon, Input, Notice, Select, Textarea } from '../ui';
import { ProjectPromptManagerModal } from './ProjectPromptManagerModal';

interface ProjectAIPaneProps {
  ai: ProjectAIController;
  projectType?: ProjectType;
}

export function ProjectAIPane({ ai, projectType = 'translation' }: ProjectAIPaneProps) {
  const isReviewProject = projectType === 'review';
  const isCustomProject = projectType === 'custom';
  const selectedProvider = ai.providerOptions.find((provider) => provider.id === ai.modelDraft);
  const shouldShowUnavailableCurrentProvider = Boolean(ai.modelDraft) && !selectedProvider;
  const promptManager = ai.savedPrompts.managerOpen ? (
    <ProjectPromptManagerModal
      open={true}
      onClose={ai.savedPrompts.closeManager}
      savedPrompts={ai.savedPrompts}
      currentDraft={ai.promptDraft}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <div className="workspace-config-section">
        <label htmlFor="project-ai-provider" className="workspace-section-heading mb-3 block">
          AI provider
        </label>
        {ai.providerWarning && (
          <Notice tone="warning" className="mb-2 text-xs">
            {ai.providerWarning}
          </Notice>
        )}
        <Select
          id="project-ai-provider"
          aria-label="AI provider"
          value={ai.modelDraft}
          onChange={(event) => ai.setModelDraft(event.target.value as typeof ai.modelDraft)}
          className="w-full max-w-sm"
          disabled={ai.providerSetupRequired}
        >
          {ai.providerSetupRequired && !ai.modelDraft && (
            <option value="">No provider configured</option>
          )}
          {shouldShowUnavailableCurrentProvider && (
            <option value={ai.modelDraft}>Unavailable provider ({ai.modelDraft})</option>
          )}
          {ai.providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="workspace-config-section">
        <div className="workspace-section-heading mb-3 flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="project-ai-custom-prompt"
            className="block text-sm font-semibold text-text"
          >
            Custom prompt
          </label>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              id="project-ai-saved-prompt"
              aria-label="Saved prompts"
              value={ai.savedPrompts.selectedPromptId ?? ''}
              onChange={(event) => {
                const promptId = Number(event.target.value);
                if (promptId) void ai.savedPrompts.applyPrompt(promptId);
              }}
              className="w-48"
              disabled={ai.savedPrompts.prompts.length === 0}
            >
              <option value="">
                {ai.savedPrompts.prompts.length === 0 ? 'No saved prompts' : 'Saved prompts…'}
              </option>
              {ai.savedPrompts.prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                </option>
              ))}
            </Select>
            <Button onClick={ai.savedPrompts.openManager} size="sm" variant="ghost">
              Manage
            </Button>
          </div>
        </div>
        <Textarea
          id="project-ai-custom-prompt"
          value={ai.promptDraft}
          onChange={(event) => ai.setPromptDraft(event.target.value)}
          rows={6}
          placeholder={
            isReviewProject
              ? 'Optional. Add project-specific review instructions (accuracy, fluency, style, severity rules).'
              : isCustomProject
                ? 'Optional. Override the default system prompt with full custom processing instructions.'
                : 'Optional. Add project-specific translation instructions (tone, terminology, style).'
          }
        />
        <p className="mt-2 text-xs text-text-muted">
          {isReviewProject
            ? 'Saved custom prompt is appended to the default AI review rules.'
            : isCustomProject
              ? 'Saved custom prompt overrides the default system prompt.'
              : 'Saved custom prompt is appended to the default translation rules.'}
        </p>
      </div>
      <details className="workspace-config-section group">
        <summary className="workspace-section-heading flex cursor-pointer list-none items-center justify-between gap-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          Prompt preview
          <Icon
            name="chevron-down"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-3">
          <Textarea
            size="xs"
            id="project-ai-effective-prompt"
            aria-label="Prompt preview"
            value={ai.effectiveSystemPromptPreview}
            readOnly
            rows={7}
            className="leading-5 whitespace-pre-wrap"
          />
          <p className="mt-2 text-xs text-text-muted">Saved system prompt used at runtime.</p>
        </div>
      </details>
      <details className="workspace-config-section group">
        <summary className="workspace-section-heading flex cursor-pointer list-none items-center justify-between gap-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          Test prompt
          <Icon
            name="chevron-down"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-3">
          <p className="mb-3 text-xs text-text-muted">Uses saved AI settings.</p>
          <label className="block text-xs font-medium text-text-muted mb-1">
            {isReviewProject ? 'Test text' : isCustomProject ? 'Test input' : 'Test source'}
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={ai.testSource}
              onChange={(event) => ai.setTestSource(event.target.value)}
              placeholder={
                isReviewProject
                  ? 'Enter a short sentence to test AI review'
                  : isCustomProject
                    ? 'Enter a short sentence to test AI custom processing'
                    : 'Enter a short sentence to test AI translation'
              }
              className="flex-1"
            />
            <Button
              onClick={() => void ai.testPrompt()}
              disabled={ai.providerSetupRequired || ai.providerUnavailable}
              size="sm"
              variant="primary"
            >
              Test prompt
            </Button>
          </div>
          <label className="block mt-2 text-xs font-medium text-text-muted mb-1">
            Test context (optional)
          </label>
          <Input
            type="text"
            value={ai.testContext}
            onChange={(event) => ai.setTestContext(event.target.value)}
            placeholder={
              isReviewProject
                ? 'Optional source-language context for review'
                : isCustomProject
                  ? 'Optional context for custom processing'
                  : 'Optional translation context'
            }
          />
          {ai.testResult && (
            <div className="mt-2">
              <div className="text-xs font-medium text-text-muted mb-1">
                {isReviewProject
                  ? 'Reviewed text'
                  : isCustomProject
                    ? 'Processed text'
                    : 'Translated text'}
              </div>
              <Card variant="surface" className="text-xs text-text-muted px-3 py-2">
                {ai.testResult}
              </Card>
            </div>
          )}
          {ai.testError && (
            <div className="mt-2">
              <div className="text-xs font-medium text-danger mb-1">Error</div>
              <Notice tone="danger" className="text-xs">
                {ai.testError}
              </Notice>
            </div>
          )}
          {ai.hasTestDetails && (
            <div className="mt-2">
              <Button onClick={() => ai.setShowTestDetails((prev) => !prev)} variant="link">
                {ai.showTestDetails ? 'Hide test details' : 'Show test details'}
              </Button>
            </div>
          )}
          {ai.hasTestDetails && ai.showTestDetails && (
            <>
              {ai.testMeta && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-text-muted mb-1">Transport</div>
                  <Card variant="surface" className="text-caption text-text-muted px-3 py-2">
                    {ai.testMeta}
                  </Card>
                </div>
              )}
              {ai.testUserPrompt && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-text-muted mb-1">User prompt</div>
                  <Card
                    variant="surface"
                    className="text-caption text-text-muted px-3 py-2 whitespace-pre-wrap"
                  >
                    {ai.testUserPrompt}
                  </Card>
                </div>
              )}
              {ai.testSystemPrompt && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-text-muted mb-1">System prompt</div>
                  <Card
                    variant="surface"
                    className="text-caption text-text-muted px-3 py-2 whitespace-pre-wrap"
                  >
                    {ai.testSystemPrompt}
                  </Card>
                </div>
              )}
              {ai.testRawResponse && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-text-muted mb-1">
                    Raw provider response
                  </div>
                  <Card
                    variant="surface"
                    className="text-caption text-text-muted px-3 py-2 whitespace-pre-wrap max-h-40 overflow-auto"
                  >
                    {ai.testRawResponse}
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </details>
      {promptManager}
    </div>
  );
}

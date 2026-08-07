import type { ProjectType } from '@cat/core/project';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Badge, Button, Card, Input, Notice, Select, Textarea } from '../ui';
import { ProjectPromptManagerModal } from './ProjectPromptManagerModal';

interface ProjectAIPaneProps {
  ai: ProjectAIController;
  projectType?: ProjectType;
  expanded: boolean;
  onToggle: () => void;
}

export function ProjectAIPane({
  ai,
  projectType = 'translation',
  expanded,
  onToggle,
}: ProjectAIPaneProps) {
  const isReviewProject = projectType === 'review';
  const isCustomProject = projectType === 'custom';
  const selectedProvider = ai.providerOptions.find((provider) => provider.id === ai.modelDraft);
  const shouldShowUnavailableCurrentProvider = Boolean(ai.modelDraft) && !selectedProvider;
  const providerNeedsAttention = ai.providerSetupRequired || shouldShowUnavailableCurrentProvider;
  const providerSummary = selectedProvider
    ? selectedProvider.name
    : ai.providerSetupRequired
      ? 'Provider not configured'
      : shouldShowUnavailableCurrentProvider
        ? 'Provider unavailable'
        : 'No provider selected';

  const header = (
    <div className={`flex items-center justify-between gap-4 ${expanded ? 'mb-3' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <svg
          className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-text-muted uppercase tracking-wider">
            AI Settings
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2">
            <Badge tone={ai.hasUnsavedPromptChanges ? 'warning' : 'success'}>
              {ai.hasUnsavedPromptChanges ? 'Unsaved Changes' : 'Saved'}
            </Badge>
            <span
              className={`truncate text-xs ${
                providerNeedsAttention ? 'text-warning' : 'text-text-faint'
              }`}
            >
              {providerSummary}
            </span>
            {expanded && ai.promptSavedAt && !ai.hasUnsavedPromptChanges && (
              <span className="shrink-0 text-[10px] text-text-faint">at {ai.promptSavedAt}</span>
            )}
          </span>
        </span>
      </button>
      {(expanded || ai.hasUnsavedPromptChanges || ai.savingPrompt) && (
        <Button
          type="button"
          onClick={() => void ai.savePrompt()}
          disabled={ai.savingPrompt || !ai.hasUnsavedPromptChanges}
          size="sm"
          variant={ai.hasUnsavedPromptChanges ? 'primary' : 'soft'}
          className={!ai.hasUnsavedPromptChanges ? '!bg-success !text-success-contrast' : ''}
        >
          {ai.savingPrompt
            ? 'Saving...'
            : ai.hasUnsavedPromptChanges
              ? 'Save AI Settings'
              : 'AI Settings Saved'}
        </Button>
      )}
    </div>
  );
  const promptManager = ai.savedPrompts.managerOpen ? (
    <ProjectPromptManagerModal
      open={true}
      onClose={ai.savedPrompts.closeManager}
      savedPrompts={ai.savedPrompts}
      currentDraft={ai.promptDraft}
    />
  ) : null;

  if (!expanded) {
    return (
      <div className="mb-8 rounded-panel border border-border p-5">
        {header}
        {promptManager}
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-panel border border-border p-5">
      {header}
      <div className="mb-3">
        <label
          htmlFor="project-ai-effective-prompt"
          className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1"
        >
          Prompt
        </label>
        <Textarea
          id="project-ai-effective-prompt"
          value={ai.effectiveSystemPromptPreview}
          readOnly
          rows={7}
          className="!bg-muted/35 text-[11px] leading-5 whitespace-pre-wrap"
        />
        <p className="mt-2 text-[11px] text-text-muted">
          This is the saved system prompt used at runtime. It updates after you save AI settings.
        </p>
      </div>
      <div className="mb-3">
        <label
          htmlFor="project-ai-provider"
          className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1"
        >
          AI Provider
        </label>
        {ai.providerWarning && (
          <Notice tone="warning" className="mb-2 text-xs">
            {ai.providerWarning}
          </Notice>
        )}
        <Select
          id="project-ai-provider"
          aria-label="AI Provider"
          value={ai.modelDraft}
          onChange={(event) => ai.setModelDraft(event.target.value as typeof ai.modelDraft)}
          className="w-72"
          disabled={ai.providerSetupRequired}
        >
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
      <div className="mb-3">
        <div className="mb-1 flex items-end justify-between gap-2">
          <label
            htmlFor="project-ai-custom-prompt"
            className="block text-xs font-bold text-text-faint uppercase tracking-wider"
          >
            Custom Prompt
          </label>
          <div className="flex items-center gap-2">
            <Select
              id="project-ai-saved-prompt"
              aria-label="Saved Prompts"
              value={ai.savedPrompts.selectedPromptId ?? ''}
              onChange={(event) => {
                const promptId = Number(event.target.value);
                if (promptId) void ai.savedPrompts.applyPrompt(promptId);
              }}
              className="w-48 !text-xs"
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
          rows={4}
          placeholder={
            isReviewProject
              ? 'Optional. Add project-specific review instructions (accuracy, fluency, style, severity rules).'
              : isCustomProject
                ? 'Optional. Override the default system prompt with full custom processing instructions.'
                : 'Optional. Add project-specific translation instructions (tone, terminology, style).'
          }
        />
        <p className="mt-2 text-[11px] text-text-muted">
          {isReviewProject
            ? 'Saved custom prompt is appended to the default AI review rules.'
            : isCustomProject
              ? 'Saved custom prompt overrides the default system prompt.'
              : 'Saved custom prompt is appended to the default translation rules.'}
        </p>
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <label className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1">
          {isReviewProject ? 'Test Text' : isCustomProject ? 'Test Input' : 'Test Source'}
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
            Test Prompt
          </Button>
        </div>
        <label className="block mt-2 text-xs font-bold text-text-faint uppercase tracking-wider mb-1">
          Test Context (Optional)
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
            <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
              {isReviewProject
                ? 'Reviewed Text'
                : isCustomProject
                  ? 'Processed Text'
                  : 'Translated Text'}
            </div>
            <Card variant="surface" className="text-xs text-text-muted px-3 py-2">
              {ai.testResult}
            </Card>
          </div>
        )}
        {ai.testError && (
          <div className="mt-2">
            <div className="text-[10px] font-bold text-danger/80 uppercase tracking-wider mb-1">
              Error
            </div>
            <Notice tone="danger" className="text-xs">
              {ai.testError}
            </Notice>
          </div>
        )}
        {ai.hasTestDetails && (
          <div className="mt-2">
            <Button
              onClick={() => ai.setShowTestDetails((prev) => !prev)}
              size="sm"
              variant="ghost"
              className="!px-0 !py-0 text-[10px] !text-brand underline-offset-2 hover:underline"
            >
              {ai.showTestDetails ? 'Hide Test Details' : 'Show Test Details'}
            </Button>
          </div>
        )}
        {ai.hasTestDetails && ai.showTestDetails && (
          <>
            {ai.testMeta && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  Transport
                </div>
                <Card variant="surface" className="text-[10px] text-text-muted px-3 py-2">
                  {ai.testMeta}
                </Card>
              </div>
            )}
            {ai.testUserPrompt && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  User Prompt
                </div>
                <Card
                  variant="surface"
                  className="text-[10px] text-text-muted px-3 py-2 whitespace-pre-wrap"
                >
                  {ai.testUserPrompt}
                </Card>
              </div>
            )}
            {ai.testSystemPrompt && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  System Prompt
                </div>
                <Card
                  variant="surface"
                  className="text-[10px] text-text-muted px-3 py-2 whitespace-pre-wrap"
                >
                  {ai.testSystemPrompt}
                </Card>
              </div>
            )}
            {ai.testRawResponse && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  Raw Provider Response
                </div>
                <Card
                  variant="surface"
                  className="text-[10px] text-text-muted px-3 py-2 whitespace-pre-wrap max-h-40 overflow-auto"
                >
                  {ai.testRawResponse}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
      {promptManager}
    </div>
  );
}

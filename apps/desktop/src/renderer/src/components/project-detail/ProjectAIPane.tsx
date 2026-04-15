import type { ProjectType } from '@cat/core/project';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Badge, Button, Card, Input, Notice, Select, Textarea } from '../ui';

interface ProjectAIPaneProps {
  ai: ProjectAIController;
  projectType?: ProjectType;
}

export function ProjectAIPane({ ai, projectType = 'translation' }: ProjectAIPaneProps) {
  const isReviewProject = projectType === 'review';
  const isCustomProject = projectType === 'custom';
  return (
    <Card variant="subtle" className="mb-8 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wider">
            AI Settings
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={ai.hasUnsavedPromptChanges ? 'warning' : 'success'}>
              {ai.hasUnsavedPromptChanges ? 'Unsaved Changes' : 'Saved'}
            </Badge>
            {ai.promptSavedAt && !ai.hasUnsavedPromptChanges && (
              <span className="text-[10px] text-text-faint">at {ai.promptSavedAt}</span>
            )}
          </div>
        </div>
        <Button
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
      </div>
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
        <label className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1">
          Model
        </label>
        <Select
          aria-label="AI Provider"
          value={ai.modelDraft}
          onChange={(event) => ai.setModelDraft(event.target.value as typeof ai.modelDraft)}
          className="w-52"
        >
          {ai.providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-3">
        <label
          htmlFor="project-ai-custom-prompt"
          className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1"
        >
          Custom Prompt
        </label>
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
          <Button onClick={() => void ai.testPrompt()} size="sm" variant="primary">
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
            {ai.testUserMessage && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  User Message
                </div>
                <Card
                  variant="surface"
                  className="text-[10px] text-text-muted px-3 py-2 whitespace-pre-wrap"
                >
                  {ai.testUserMessage}
                </Card>
              </div>
            )}
            {ai.testPromptUsed && (
              <div className="mt-2">
                <div className="text-[10px] font-bold text-text-faint uppercase tracking-wider mb-1">
                  System Prompt
                </div>
                <Card
                  variant="surface"
                  className="text-[10px] text-text-muted px-3 py-2 whitespace-pre-wrap"
                >
                  {ai.testPromptUsed}
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
    </Card>
  );
}

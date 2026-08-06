import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATDatabase } from "./index";

describe("CATDatabase", () => {
  let db: CATDatabase;
  const testDbPath = ":memory:"; // Use in-memory for tests

  beforeEach(() => {
    db = new CATDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
  });

  it("should create a project and retrieve it", () => {
    const projectId = db.createProject("Test Project", "en-US", "zh-CN");
    expect(projectId).toBeGreaterThan(0);

    const project = db.getProject(projectId);
    expect(project).toBeDefined();
    expect(project?.name).toBe("Test Project");
    expect(project?.srcLang).toBe("en-US");
    expect(project?.tgtLang).toBe("zh-CN");
    expect(project?.projectType).toBe("translation");
    expect(project?.aiModel).toBe("");
  });

  it("should persist review project type", () => {
    const projectId = db.createProject(
      "Review Project",
      "en-US",
      "zh-CN",
      "review",
    );
    const project = db.getProject(projectId);
    expect(project?.projectType).toBe("review");
  });

  it("should persist custom project type", () => {
    const projectId = db.createProject(
      "Custom Project",
      "en-US",
      "zh-CN",
      "custom",
    );
    const project = db.getProject(projectId);
    expect(project?.projectType).toBe("custom");
  });

  it("should list projects with correct stats", () => {
    db.createProject("P1", "en", "zh");
    db.createProject("P2", "en", "ja");

    const projects = db.listProjects();
    expect(projects).toHaveLength(2);
    const names = projects.map((p) => p.name);
    expect(names).toContain("P1");
    expect(names).toContain("P2");
  });

  it("should update project AI settings", () => {
    const projectId = db.createProject("AI Settings Project", "en-US", "zh-CN");
    db.updateProjectAISettings(
      projectId,
      "Keep product names untranslated.",
      "provider:gpt-5-mini",
    );

    const project = db.getProject(projectId);
    expect(project?.aiPrompt).toBe("Keep product names untranslated.");
    expect(project?.aiModel).toBe("provider:gpt-5-mini");
  });

  it("should update project QA settings", () => {
    const projectId = db.createProject("QA Settings Project", "en-US", "zh-CN");
    db.updateProjectQASettings(projectId, {
      enabledRuleIds: ["tag-integrity"],
      instantQaOnConfirm: false,
    });

    const project = db.getProject(projectId);
    expect(project?.qaSettings?.enabledRuleIds).toEqual(["tag-integrity"]);
    expect(project?.qaSettings?.instantQaOnConfirm).toBe(false);
  });

  describe("project saved prompts", () => {
    it("creates, lists, updates and deletes saved prompts", () => {
      const projectId = db.createProject("Prompt Project", "en-US", "zh-CN");

      const created = db.createProjectSavedPrompt(
        projectId,
        "  Formal tone  ",
        "Translate with a formal tone.",
      );
      expect(created.id).toBeGreaterThan(0);
      expect(created.projectId).toBe(projectId);
      expect(created.name).toBe("Formal tone");
      expect(created.content).toBe("Translate with a formal tone.");

      db.createProjectSavedPrompt(projectId, "Casual tone", "Translate casually.");
      const prompts = db.listProjectSavedPrompts(projectId);
      expect(prompts.map((prompt) => prompt.name)).toEqual(["Casual tone", "Formal tone"]);

      db.updateProjectSavedPrompt(
        projectId,
        created.id,
        "Very formal tone",
        "Translate with a very formal tone.",
      );
      const updated = db
        .listProjectSavedPrompts(projectId)
        .find((prompt) => prompt.id === created.id);
      expect(updated?.name).toBe("Very formal tone");
      expect(updated?.content).toBe("Translate with a very formal tone.");

      db.deleteProjectSavedPrompt(projectId, created.id);
      expect(db.listProjectSavedPrompts(projectId)).toHaveLength(1);
    });

    it("scopes saved prompts per project and cascades on project delete", () => {
      const projectA = db.createProject("Project A", "en", "zh");
      const projectB = db.createProject("Project B", "en", "zh");

      db.createProjectSavedPrompt(projectA, "Shared name", "A content");
      db.createProjectSavedPrompt(projectB, "Shared name", "B content");

      expect(db.listProjectSavedPrompts(projectA)).toHaveLength(1);
      expect(db.listProjectSavedPrompts(projectB)).toHaveLength(1);

      db.deleteProject(projectA);
      expect(db.listProjectSavedPrompts(projectA)).toHaveLength(0);
      expect(db.listProjectSavedPrompts(projectB)).toHaveLength(1);
    });

    it("rejects mutations whose promptId belongs to another project", () => {
      const projectA = db.createProject("Project A", "en", "zh");
      const projectB = db.createProject("Project B", "en", "zh");
      const promptA = db.createProjectSavedPrompt(projectA, "A prompt", "A content");

      expect(() =>
        db.updateProjectSavedPrompt(projectB, promptA.id, "Hijacked", "Hijacked content"),
      ).toThrow(/not found/);
      expect(() => db.deleteProjectSavedPrompt(projectB, promptA.id)).toThrow(/not found/);

      // The prompt is untouched.
      const untouched = db
        .listProjectSavedPrompts(projectA)
        .find((prompt) => prompt.id === promptA.id);
      expect(untouched?.name).toBe("A prompt");
      expect(untouched?.content).toBe("A content");
    });

    it("rejects duplicate and empty prompt names", () => {
      const projectId = db.createProject("Prompt Project", "en", "zh");
      const first = db.createProjectSavedPrompt(projectId, "Formal", "Content");
      db.createProjectSavedPrompt(projectId, "Other", "Content");

      expect(() => db.createProjectSavedPrompt(projectId, "formal", "Other content")).toThrow(
        /already exists/,
      );
      expect(() => db.createProjectSavedPrompt(projectId, "   ", "Content")).toThrow(
        /cannot be empty/,
      );
      expect(() => db.updateProjectSavedPrompt(projectId, first.id, "other", "Content")).toThrow(
        /already exists/,
      );

      // Renaming to its own name (case change only) is allowed.
      db.updateProjectSavedPrompt(projectId, first.id, "FORMAL", "Content");
      const renamed = db
        .listProjectSavedPrompts(projectId)
        .find((prompt) => prompt.id === first.id);
      expect(renamed?.name).toBe("FORMAL");
    });

    it("bumps the parent project's recency on prompt changes", () => {
      const projectId = db.createProject("Prompt Project", "en", "zh");
      const before = db.getProject(projectId)?.updatedAt;

      const created = db.createProjectSavedPrompt(projectId, "Formal", "Content");
      const afterCreate = db.getProject(projectId)?.updatedAt;
      expect(afterCreate).toBeTruthy();
      expect(afterCreate! >= before!).toBe(true);

      db.updateProjectSavedPrompt(projectId, created.id, "Formal", "New content");
      const afterUpdate = db.getProject(projectId)?.updatedAt;
      expect(afterUpdate! >= afterCreate!).toBe(true);

      db.deleteProjectSavedPrompt(projectId, created.id);
      const afterDelete = db.getProject(projectId)?.updatedAt;
      expect(afterDelete! >= afterUpdate!).toBe(true);
    });
  });

  it("should rename file metadata without changing its contents or recency", () => {
    const projectId = db.createProject("Rename File", "en", "zh");
    const fileId = db.createFile(projectId, "original.xlsx", '{"sourceCol":0}');
    db.bulkInsertSegments([
      {
        segmentId: "rename-segment",
        fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "Hello" }],
        targetTokens: [{ type: "text", content: "你好" }],
        status: "confirmed",
        tagsSignature: "",
        matchKey: "hello",
        srcHash: "rename-hash",
        meta: { updatedAt: "2026-08-06T00:00:00.000Z" },
      },
    ]);
    const before = db.getFile(fileId)!;
    const segmentsBefore = db.getSegmentsPage(fileId, 0, 10);

    expect(db.renameFileMetadata(fileId, "  renamed.xlsx  ")).toBe("renamed.xlsx");

    const after = db.getFile(fileId)!;
    expect(after).toMatchObject({
      id: before.id,
      uuid: before.uuid,
      projectId: before.projectId,
      name: "renamed.xlsx",
      importOptionsJson: before.importOptionsJson,
      totalSegments: before.totalSegments,
      confirmedSegments: before.confirmedSegments,
      createdAt: before.createdAt,
      updatedAt: before.updatedAt,
    });
    expect(db.getSegmentsPage(fileId, 0, 10)).toEqual(segmentsBefore);
  });

  it("should reject invalid or missing file renames", () => {
    const projectId = db.createProject("Rename File Validation", "en", "zh");
    const fileId = db.createFile(projectId, "original.xlsx");

    expect(() => db.renameFileMetadata(fileId, "   ")).toThrow("File name cannot be empty.");
    expect(() => db.renameFileMetadata(fileId, "invalid/name.xlsx")).toThrow(
      "File name contains invalid characters.",
    );
    expect(() => db.renameFileMetadata(fileId, "renamed.csv")).toThrow(
      'File extension must remain ".xlsx".',
    );
    expect(() => db.renameFileMetadata(999_999, "missing.xlsx")).toThrow("File not found.");
    expect(db.getFile(fileId)?.name).toBe("original.xlsx");
  });

  it("should handle cascading delete (Project -> Files -> Segments)", () => {
    // 1. Create Project
    const projectId = db.createProject("Delete Me", "en", "zh");

    // 2. Create File
    const fileId = db.createFile(projectId, "test.xlsx");

    // 3. Add Segments
    db.bulkInsertSegments([
      {
        segmentId: "seg1",
        fileId: fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "Hello" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "hello",
        srcHash: "hash1",
        meta: { updatedAt: new Date().toISOString() },
      },
    ]);

    // Verify exists
    expect(db.getProject(projectId)).toBeDefined();
    expect(db.listFiles(projectId)).toHaveLength(1);
    expect(db.getSegmentsPage(fileId, 0, 10)).toHaveLength(1);

    // 4. Delete Project
    db.deleteProject(projectId);

    // Verify cascading delete
    expect(db.getProject(projectId)).toBeUndefined();
    expect(db.listFiles(projectId)).toHaveLength(0);
    // Segments for that fileId should be gone (though technically we can't get them without the fileId)
    // We can check stats or another query to be sure
  });

  it("should update file stats when segments change", () => {
    const projectId = db.createProject("Stats Project", "en", "zh");
    const fileId = db.createFile(projectId, "stats.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "s1",
        fileId: fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "A" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "a",
        srcHash: "ha",
        meta: { updatedAt: "" },
      },
      {
        segmentId: "s2",
        fileId: fileId,
        orderIndex: 1,
        sourceTokens: [{ type: "text", content: "B" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "b",
        srcHash: "hb",
        meta: { updatedAt: "" },
      },
    ]);

    let file = db.getFile(fileId);
    expect(file?.totalSegments).toBe(2);
    expect(file?.confirmedSegments).toBe(0);

    // Confirm one segment
    db.updateSegmentTarget(
      "s1",
      [{ type: "text", content: "甲" }],
      "confirmed",
    );

    file = db.getFile(fileId);
    expect(file?.confirmedSegments).toBe(1);
    expect(file?.segmentStatusStats.totalSegments).toBe(2);
    expect(file?.segmentStatusStats.confirmedSegmentsForBar).toBe(1);

    // File reads derive confirmation stats from segments, so repeated updates
    // cannot double-count and moving back to draft is reflected immediately.
    db.updateSegmentTarget(
      "s1",
      [{ type: "text", content: "updated" }],
      "confirmed",
    );
    expect(db.getFile(fileId)?.confirmedSegments).toBe(1);

    db.updateSegmentTarget(
      "s1",
      [{ type: "text", content: "draft" }],
      "draft",
    );
    file = db.getFile(fileId);
    expect(file?.confirmedSegments).toBe(0);
    expect(file?.segmentStatusStats.totalSegments).toBe(2);
    expect(file?.segmentStatusStats.inProgressSegments).toBe(1);
  });

  it("should derive zero stats for an empty file", () => {
    const projectId = db.createProject("Empty Stats Project", "en", "zh");
    const fileId = db.createFile(projectId, "empty.xlsx");

    const file = db.getFile(fileId);
    expect(file?.totalSegments).toBe(0);
    expect(file?.confirmedSegments).toBe(0);
    expect(file?.segmentStatusStats).toEqual({
      totalSegments: 0,
      qaProblemSegments: 0,
      confirmedSegmentsForBar: 0,
      inProgressSegments: 0,
      newSegments: 0,
    });
  });

  it("should maintain stats for every file in a cross-file bulk insert", () => {
    const projectId = db.createProject("Cross-file Stats Project", "en", "zh");
    const firstFileId = db.createFile(projectId, "first.xlsx");
    const secondFileId = db.createFile(projectId, "second.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "cross-file-1",
        fileId: firstFileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "First" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "first",
        srcHash: "cross-file-hash-1",
        meta: { updatedAt: "" },
      },
      {
        segmentId: "cross-file-2",
        fileId: secondFileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "Second" }],
        targetTokens: [{ type: "text", content: "Second translated" }],
        status: "confirmed",
        tagsSignature: "",
        matchKey: "second",
        srcHash: "cross-file-hash-2",
        meta: { updatedAt: "" },
      },
    ]);

    expect(db.getFile(firstFileId)).toMatchObject({
      totalSegments: 1,
      confirmedSegments: 0,
    });
    expect(db.getFile(secondFileId)).toMatchObject({
      totalSegments: 1,
      confirmedSegments: 1,
    });
  });

  it("should include per-file segment status stats for progress bar rendering", () => {
    const projectId = db.createProject("File Status Stats Project", "en", "zh");
    const fileId = db.createFile(projectId, "status-breakdown.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "s-new",
        fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "new" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "new",
        srcHash: "hash-new",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "s-draft",
        fileId,
        orderIndex: 1,
        sourceTokens: [{ type: "text", content: "draft" }],
        targetTokens: [{ type: "text", content: "草稿" }],
        status: "draft",
        tagsSignature: "",
        matchKey: "draft",
        srcHash: "hash-draft",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "s-translated",
        fileId,
        orderIndex: 2,
        sourceTokens: [{ type: "text", content: "translated" }],
        targetTokens: [{ type: "text", content: "已翻译" }],
        status: "translated",
        tagsSignature: "",
        matchKey: "translated",
        srcHash: "hash-translated",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "s-reviewed",
        fileId,
        orderIndex: 3,
        sourceTokens: [{ type: "text", content: "reviewed" }],
        targetTokens: [{ type: "text", content: "已润色" }],
        status: "reviewed",
        tagsSignature: "",
        matchKey: "reviewed",
        srcHash: "hash-reviewed",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "s-confirmed",
        fileId,
        orderIndex: 4,
        sourceTokens: [{ type: "text", content: "confirmed" }],
        targetTokens: [{ type: "text", content: "已确认" }],
        status: "confirmed",
        tagsSignature: "",
        matchKey: "confirmed",
        srcHash: "hash-confirmed",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "s-qa-problem",
        fileId,
        orderIndex: 5,
        sourceTokens: [{ type: "text", content: "qa" }],
        targetTokens: [{ type: "text", content: "有问题" }],
        status: "draft",
        tagsSignature: "",
        matchKey: "qa",
        srcHash: "hash-qa",
        meta: { updatedAt: new Date().toISOString() },
        qaIssues: [{ ruleId: "tag-order", severity: "warning", message: "order mismatch" }],
      },
      {
        segmentId: "s-confirmed-qa-problem",
        fileId,
        orderIndex: 6,
        sourceTokens: [{ type: "text", content: "confirmed-qa" }],
        targetTokens: [{ type: "text", content: "确认但有问题" }],
        status: "confirmed",
        tagsSignature: "",
        matchKey: "confirmed-qa",
        srcHash: "hash-confirmed-qa",
        meta: { updatedAt: new Date().toISOString() },
        qaIssues: [{ ruleId: "tag-missing", severity: "error", message: "missing tag" }],
      },
    ]);

    const files = db.listFiles(projectId);
    expect(files).toHaveLength(1);
    const stats = files[0].segmentStatusStats;
    expect(stats).toBeDefined();
    expect(stats?.totalSegments).toBe(7);
    expect(stats?.qaProblemSegments).toBe(2);
    expect(stats?.confirmedSegmentsForBar).toBe(1);
    expect(stats?.inProgressSegments).toBe(3);
    expect(stats?.newSegments).toBe(1);

    const totalFromBuckets =
      (stats?.qaProblemSegments ?? 0) +
      (stats?.confirmedSegmentsForBar ?? 0) +
      (stats?.inProgressSegments ?? 0) +
      (stats?.newSegments ?? 0);
    expect(totalFromBuckets).toBe(stats?.totalSegments);
  });

  it("should scope getFile and listFiles stats to the relevant project files only", () => {
    const projectId = db.createProject("Scoped Stats Project", "en", "zh");
    const otherProjectId = db.createProject("Other Stats Project", "en", "fr");
    const targetFileId = db.createFile(projectId, "target.xlsx");
    const siblingFileId = db.createFile(projectId, "sibling.xlsx");
    const otherProjectFileId = db.createFile(otherProjectId, "other.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "target-confirmed",
        fileId: targetFileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "target confirmed" }],
        targetTokens: [{ type: "text", content: "target confirmed zh" }],
        status: "confirmed",
        tagsSignature: "",
        matchKey: "target-confirmed",
        srcHash: "target-confirmed",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "target-draft-qa",
        fileId: targetFileId,
        orderIndex: 1,
        sourceTokens: [{ type: "text", content: "target qa" }],
        targetTokens: [{ type: "text", content: "target qa zh" }],
        status: "draft",
        tagsSignature: "",
        matchKey: "target-qa",
        srcHash: "target-qa",
        meta: { updatedAt: new Date().toISOString() },
        qaIssues: [{ ruleId: "tag-order", severity: "warning", message: "order mismatch" }],
      },
      {
        segmentId: "sibling-draft",
        fileId: siblingFileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "sibling draft" }],
        targetTokens: [{ type: "text", content: "sibling draft zh" }],
        status: "draft",
        tagsSignature: "",
        matchKey: "sibling-draft",
        srcHash: "sibling-draft",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "other-reviewed",
        fileId: otherProjectFileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "other reviewed" }],
        targetTokens: [{ type: "text", content: "other reviewed fr" }],
        status: "reviewed",
        tagsSignature: "",
        matchKey: "other-reviewed",
        srcHash: "other-reviewed",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "other-new",
        fileId: otherProjectFileId,
        orderIndex: 1,
        sourceTokens: [{ type: "text", content: "other new" }],
        targetTokens: [],
        status: "new",
        tagsSignature: "",
        matchKey: "other-new",
        srcHash: "other-new",
        meta: { updatedAt: new Date().toISOString() },
      },
    ]);

    db.updateFileStats(siblingFileId);
    db.updateFileStats(otherProjectFileId);

    const targetFile = db.getFile(targetFileId);
    expect(targetFile).toBeDefined();
    expect(targetFile?.segmentStatusStats).toEqual({
      totalSegments: 2,
      qaProblemSegments: 1,
      confirmedSegmentsForBar: 1,
      inProgressSegments: 0,
      newSegments: 0,
    });

    const projectFiles = db.listFiles(projectId);
    expect(projectFiles).toHaveLength(2);

    const listedTargetFile = projectFiles.find((file) => file.id === targetFileId);
    expect(listedTargetFile?.segmentStatusStats).toEqual(targetFile?.segmentStatusStats);

    const siblingFile = projectFiles.find((file) => file.id === siblingFileId);
    expect(siblingFile?.segmentStatusStats).toEqual({
      totalSegments: 1,
      qaProblemSegments: 0,
      confirmedSegmentsForBar: 0,
      inProgressSegments: 1,
      newSegments: 0,
    });
  });

  it("should persist qa issues and clear them after segment update", () => {
    const projectId = db.createProject("QA Cache Project", "en", "zh");
    const fileId = db.createFile(projectId, "qa-cache.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "qa-1",
        fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "Click <1>" }],
        targetTokens: [{ type: "text", content: "点击" }],
        status: "draft",
        tagsSignature: "<1>",
        matchKey: "click",
        srcHash: "qa-cache-hash",
        meta: { updatedAt: new Date().toISOString() },
      },
    ]);

    db.updateSegmentQaIssues("qa-1", [
      {
        ruleId: "tag-missing",
        severity: "error",
        message: "Missing tags: <1>",
      },
    ]);

    let segment = db.getSegment("qa-1");
    expect(segment?.qaIssues).toHaveLength(1);
    expect(segment?.qaIssues?.[0].ruleId).toBe("tag-missing");

    db.updateSegmentTarget(
      "qa-1",
      [{ type: "text", content: "点击 <1>" }],
      "draft",
    );

    segment = db.getSegment("qa-1");
    expect(segment?.qaIssues).toBeUndefined();
  });

  it("should normalize invalid segment status values when reading", () => {
    const projectId = db.createProject("Status Normalize Project", "en", "zh");
    const fileId = db.createFile(projectId, "normalize.xlsx");

    db.bulkInsertSegments([
      {
        segmentId: "invalid-empty-target",
        fileId,
        orderIndex: 0,
        sourceTokens: [{ type: "text", content: "A" }],
        targetTokens: [],
        status: "" as any,
        tagsSignature: "",
        matchKey: "a",
        srcHash: "status-hash-1",
        meta: { updatedAt: new Date().toISOString() },
      },
      {
        segmentId: "invalid-has-target",
        fileId,
        orderIndex: 1,
        sourceTokens: [{ type: "text", content: "B" }],
        targetTokens: [{ type: "text", content: "已有内容" }],
        status: "" as any,
        tagsSignature: "",
        matchKey: "b",
        srcHash: "status-hash-2",
        meta: { updatedAt: new Date().toISOString() },
      },
    ] as any);

    const segments = db.getSegmentsPage(fileId, 0, 10);
    expect(
      segments.find((segment) => segment.segmentId === "invalid-empty-target")
        ?.status,
    ).toBe("new");
    expect(
      segments.find((segment) => segment.segmentId === "invalid-has-target")
        ?.status,
    ).toBe("draft");
  });

  describe("Multi-TM Architecture (v5)", () => {
    it("should automatically create and mount a Working TM when a project is created", () => {
      const projectId = db.createProject("Auto TM Project", "en", "zh");
      const mounted = db.getProjectMountedTMs(projectId);

      expect(mounted).toHaveLength(1);
      expect(mounted[0].type).toBe("working");
      expect(mounted[0].name).toBe("Auto TM Project (Working TM)");
      expect(mounted[0].permission).toBe("readwrite");
    });

    it("should not auto-create Working TM for review projects", () => {
      const projectId = db.createProject(
        "Review Auto TM Project",
        "en",
        "zh",
        "review",
      );
      const mounted = db.getProjectMountedTMs(projectId);
      expect(mounted).toHaveLength(0);
    });

    it("should not auto-create Working TM for custom projects", () => {
      const projectId = db.createProject(
        "Custom Auto TM Project",
        "en",
        "zh",
        "custom",
      );
      const mounted = db.getProjectMountedTMs(projectId);
      expect(mounted).toHaveLength(0);
    });

    it("should allow creating and mounting a Main TM", () => {
      const projectId = db.createProject("Main TM Project", "en", "zh");
      const tmId = db.createTM("Global Main TM", "en", "zh", "main");

      db.mountTMToProject(projectId, tmId, 10, "read");

      const mounted = db.getProjectMountedTMs(projectId);
      expect(mounted).toHaveLength(2);

      const mainTM = mounted.find((m) => m.type === "main");
      expect(mainTM).toBeDefined();
      expect(mainTM!.name).toBe("Global Main TM");
      expect(mainTM!.permission).toBe("read");
    });

    it("should search concordance across multiple mounted TMs", () => {
      const projectId = db.createProject("Concordance Project", "en", "zh");
      const mounted = db.getProjectMountedTMs(projectId);
      const workingTmId = mounted[0].id;

      const mainTmId = db.createTM("Main Asset", "en", "zh", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      // Insert into Working TM
      db.upsertTMEntry({
        id: "e1",
        tmId: workingTmId,
        srcHash: "h1",
        matchKey: "hello",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "Hello" }],
        targetTokens: [{ type: "text", content: "你好" }],
        usageCount: 1,
      } as any);

      // Insert into Main TM
      db.upsertTMEntry({
        id: "e2",
        tmId: mainTmId,
        srcHash: "h2",
        matchKey: "world",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "World" }],
        targetTokens: [{ type: "text", content: "世界" }],
        usageCount: 1,
      } as any);

      const results = db.searchConcordance(projectId, "hello");
      expect(results).toHaveLength(1);
      expect(results[0].srcHash).toBe("h1");

      const allResults = db.searchConcordance(projectId, "world");
      expect(allResults).toHaveLength(1);
      expect(allResults[0].srcHash).toBe("h2");
    });

    it("should list TM entries with a preview-sized limit", () => {
      const tmId = db.createTM("Preview TM", "en", "zh", "main");

      for (let index = 0; index < 12; index += 1) {
        db.upsertTMEntry({
          id: `preview-entry-${index}`,
          tmId,
          srcHash: `preview-hash-${index}`,
          matchKey: `source ${index}`,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: `Source ${index}` }],
          targetTokens: [{ type: "text", content: `Target ${index}` }],
          usageCount: index,
        } as any);
      }

      const entries = db.listTMEntries(tmId, 10, 0);
      const sources = entries.map((entry) => entry.sourceTokens[0]?.content);

      expect(entries).toHaveLength(10);
      expect(sources.every((source) => /^Source \d+$/.test(String(source)))).toBe(true);
    });

    it("should keep concordance results diverse when one CJK overlap dominates", () => {
      const projectId = db.createProject("Concordance Diversity Project", "zh", "fr");
      const mainTmId = db.createTM("Main Concordance Diversity", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      [
        "台阶立柱设计图",
        "星系立柱设计图",
        "栅栏立柱设计图",
        "庄园立柱设计图",
        "星间立柱设计图",
        "夜幕立柱设计图",
        "晴光立柱设计图",
        "云纹立柱设计图",
        "森影立柱设计图",
        "月辉立柱设计图",
        "晨露立柱设计图",
        "暮色立柱设计图",
      ].forEach((sourceText, index) => {
        db.upsertTMEntry({
          id: `template-crowd-${index}`,
          tmId: mainTmId,
          srcHash: `template-crowd-${index}`,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `Modele ${index}` }],
          usageCount: 1,
        } as any);
      });

      db.upsertTMEntry({
        id: "wind-lotus-pillar-entry",
        tmId: mainTmId,
        srcHash: "wind-lotus-pillar",
        matchKey: "风荷立柱",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "风荷立柱" }],
        targetTokens: [{ type: "text", content: "Pilier Lotus ondoyant" }],
        usageCount: 1,
      } as any);

      const results = db.searchConcordance(projectId, "风荷立柱设计图", [mainTmId]);
      const topFiveHashes = results.slice(0, 5).map((row) => row.srcHash);

      expect(results.length).toBeLessThanOrEqual(10);
      expect(topFiveHashes).toContain("wind-lotus-pillar");
      expect(topFiveHashes.filter((srcHash) => srcHash.startsWith("template-crowd-"))).toHaveLength(2);
    });

    it("should recall shorter CJK TM source contained in longer active source", () => {
      const projectId = db.createProject("TM CJK Recall Contained", "zh", "fr");
      const mainTmId = db.createTM("Main CJK Recall", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "animal-party-entry",
        tmId: mainTmId,
        srcHash: "animal-party-hash",
        matchKey: "animal-party",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "动物变身聚会" }],
        targetTokens: [{ type: "text", content: "Fete de metamorphose animale" }],
        usageCount: 1,
      } as any);

      db.upsertTMEntry({
        id: "pillar-drawing-entry",
        tmId: mainTmId,
        srcHash: "pillar-drawing-hash",
        matchKey: "pillar-drawing",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "风荷立柱" }],
        targetTokens: [{ type: "text", content: "Colonne lotus venteux" }],
        usageCount: 1,
      } as any);

      const partyResults = db.searchTMRecallCandidates(
        projectId,
        "前往动物变身聚会（可选）",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(partyResults.map((row) => row.srcHash)).toContain("animal-party-hash");

      const pillarResults = db.searchTMRecallCandidates(
        projectId,
        "风荷立柱设计图",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(pillarResults.map((row) => row.srcHash)).toContain("pillar-drawing-hash");
    });

    it("should recall contained short CJK entries for active concordance recall", () => {
      const projectId = db.createProject("Active Concordance Recall", "zh", "fr");
      const mainTmId = db.createTM("Main Active Concordance", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (const [srcHash, sourceText] of [
        ["amo-glass", "阿茉玻"],
        ["fresh-king", "清新天王"],
      ] as const) {
        db.upsertTMEntry({
          id: srcHash,
          tmId: mainTmId,
          srcHash,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `${sourceText} target` }],
          usageCount: 1,
        } as any);
        db.insertTMFts(mainTmId, sourceText, `${sourceText} target`, srcHash);
      }

      const results = db.searchTMConcordanceRecallCandidates(
        projectId,
        "阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。",
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 200 },
      );

      expect(results.map((row) => row.srcHash)).toEqual(
        expect.arrayContaining(["amo-glass", "fresh-king"]),
      );
    });

    it("should still search 3-character CJK concordance terms when 4-character hits are crowded", () => {
      const projectId = db.createProject("Active Concordance Tier Diversity", "zh", "fr");
      const mainTmId = db.createTM("Main Active Concordance Tier Diversity", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let index = 0; index < 80; index += 1) {
        const sourceText = `噪声${index}清新天王`;
        db.upsertTMEntry({
          id: `fresh-king-noise-${index}`,
          tmId: mainTmId,
          srcHash: `fresh-king-noise-${index}`,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `fresh king noise ${index}` }],
          usageCount: 1,
        } as any);
        db.insertTMFts(mainTmId, sourceText, `fresh king noise ${index}`, `fresh-king-noise-${index}`);
      }

      db.upsertTMEntry({
        id: "amo-glass-entry",
        tmId: mainTmId,
        srcHash: "amo-glass",
        matchKey: "阿茉玻",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "阿茉玻" }],
        targetTokens: [{ type: "text", content: "Amorbo" }],
        usageCount: 1,
      } as any);
      db.insertTMFts(mainTmId, "阿茉玻", "Amorbo", "amo-glass-entry");

      const results = db.searchTMConcordanceRecallCandidates(
        projectId,
        "阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。",
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 200 },
      );

      expect(results.map((row) => row.srcHash)).toContain("amo-glass");
    });

    it("should keep exact contained 3-character CJK source when broad concordance FTS is crowded", () => {
      const projectId = db.createProject("Active Concordance Exact Short Source", "zh", "fr");
      const mainTmId = db.createTM("Main Active Concordance Exact Short Source", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let index = 0; index < 80; index += 1) {
        const sourceText = `清新天王将因绝望病逝世的心愿精灵噪声${index}`;
        db.upsertTMEntry({
          id: `crowded-concordance-${index}`,
          tmId: mainTmId,
          srcHash: `crowded-concordance-${index}`,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `crowded concordance ${index}` }],
          usageCount: 1,
        } as any);
      }

      db.upsertTMEntry({
        id: "amo-glass-exact-entry",
        tmId: mainTmId,
        srcHash: "amo-glass",
        matchKey: "阿茉玻",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "阿茉玻" }],
        targetTokens: [{ type: "text", content: "Amorbo" }],
        usageCount: 1,
      } as any);

      const results = db.searchTMConcordanceRecallCandidates(
        projectId,
        "阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。",
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 50 },
      );

      expect(results.map((row) => row.srcHash)).toContain("amo-glass");
    });

    it("should recall English exact phrase candidates before broad concordance FTS crowds them out", () => {
      const previousDebug = process.env.CAT_TM_RECALL_DEBUG;
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      process.env.CAT_TM_RECALL_DEBUG = "1";

      try {
        const projectId = db.createProject("English Concordance Phrase Exact", "en-US", "fr-FR");
        const mainTmId = db.createTM("English Concordance Phrase Exact TM", "en-US", "fr-FR", "main");
        db.mountTMToProject(projectId, mainTmId, 10, "read");

        const longSource =
          "Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power. If Drifting Power runs out, the bubble will automatically pop. When Drifting Power is full, movement speed increases for a certain time, and moving during this period will not consume Drifting Power. Four different Music Bubbles float within the Heartbeat Zone: Heartstring Bubbles increase Drifting Power and Heartstrings; Speed Bubbles allow Nikki dash forward quickly for a short distance and grant a small amount of Drifting Power and Heartstrings; Fish Bubbles spit out many Heartstring Bubbles, which can be collected to gain extra Heartstrings; Spike Bubbles stop Nikki in place for a short time and reduce Drifting Power. Heartstrings can also be obtained by playing with the Bom-Bom Bubble Machine in the Rest Zone or sitting in viewing chairs to enjoy the meteors.";

        for (let index = 0; index < 80; index += 1) {
          const sourceText =
            `Gravity bubble moving floating Drifting Power Heartstrings Nikki speed lights shadow crowd ${index}`;
          db.upsertTMEntry({
            id: `english-concordance-noise-${index}`,
            tmId: mainTmId,
            srcHash: `english-concordance-noise-${index}`,
            matchKey: sourceText,
            tagsSignature: "",
            sourceTokens: [{ type: "text", content: sourceText }],
            targetTokens: [{ type: "text", content: `bruit anglais ${index}` }],
            usageCount: 1,
          } as any);
        }

        db.upsertTMEntry({
          id: "heartbeat-zone-entry",
          tmId: mainTmId,
          srcHash: "heartbeat-zone",
          matchKey: "Heartbeat Zone",
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: "Heartbeat Zone" }],
          targetTokens: [{ type: "text", content: "Zone des battements" }],
          usageCount: 1,
        } as any);

        const results = db.searchTMConcordanceRecallCandidates(projectId, longSource, [mainTmId], {
          profile: "english",
          scope: "source",
          limit: 1,
          rawLimit: 1,
        });

        expect(results.map((row) => row.srcHash)).toEqual(["heartbeat-zone"]);

        const debugCall = debugSpy.mock.calls.find(([message]) =>
          String(message).includes("concordance recall"),
        );
        expect(debugCall).toBeDefined();
        expect((debugCall?.[1] as Record<string, unknown>).ftsQueryCount).toBe(0);
      } finally {
        if (previousDebug === undefined) {
          delete process.env.CAT_TM_RECALL_DEBUG;
        } else {
          process.env.CAT_TM_RECALL_DEBUG = previousDebug;
        }
        debugSpy.mockRestore();
      }
    });

    it("should leave raw budget for English phrase FTS after exact phrase hits", () => {
      const previousDebug = process.env.CAT_TM_RECALL_DEBUG;
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      process.env.CAT_TM_RECALL_DEBUG = "1";

      try {
        const projectId = db.createProject("English Concordance Phrase FTS", "en-US", "fr-FR");
        const mainTmId = db.createTM("English Concordance Phrase FTS TM", "en-US", "fr-FR", "main");
        db.mountTMToProject(projectId, mainTmId, 10, "read");

        const preamble = Array.from({ length: 40 }, (_, index) => `signal${index} vector${index}`)
          .join(" ");
        const longSource =
          `${preamble}. Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power. If Drifting Power runs out, the bubble will automatically pop. When Drifting Power is full, movement speed increases for a certain time, and moving during this period will not consume Drifting Power. Four different Music Bubbles float within the Heartbeat Zone: Heartstring Bubbles increase Drifting Power and Heartstrings; Speed Bubbles allow Nikki dash forward quickly for a short distance and grant a small amount of Drifting Power and Heartstrings; Fish Bubbles spit out many Heartstring Bubbles, which can be collected to gain extra Heartstrings; Spike Bubbles stop Nikki in place for a short time and reduce Drifting Power. Heartstrings can also be obtained by playing with the Bom-Bom Bubble Machine in the Rest Zone or sitting in viewing chairs to enjoy the meteors. The stage lights can also be controlled to reveal dazzling changes of light and shadow.`;

        for (const phrase of [
          "Heartbeat Zone",
          "Drifting Power",
          "Music Bubbles",
          "Heartstring Bubbles",
          "Speed Bubbles",
          "Fish Bubbles",
          "Spike Bubbles",
          "Rest Zone",
        ]) {
          db.upsertTMEntry({
            id: `english-exact-noise-${phrase}`,
            tmId: mainTmId,
            srcHash: `english-exact-noise-${phrase}`,
            matchKey: phrase,
            tagsSignature: "",
            sourceTokens: [{ type: "text", content: phrase }],
            targetTokens: [{ type: "text", content: `${phrase} target` }],
            usageCount: 1,
          } as any);
        }

        for (const [index, phrase] of [
          "Viewing Chairs",
          "Stage Lights",
          "Light And Shadow",
          "Certain Time",
          "Short Distance",
          "Extra Heartstrings",
          "Dazzling Changes",
          "Small Amount",
        ].entries()) {
          db.upsertTMEntry({
            id: `english-broad-noise-${index}`,
            tmId: mainTmId,
            srcHash: `english-broad-noise-${index}`,
            matchKey: phrase,
            tagsSignature: "",
            sourceTokens: [{ type: "text", content: phrase }],
            targetTokens: [{ type: "text", content: `${phrase} bruit` }],
            usageCount: 1,
          } as any);
        }

        db.upsertTMEntry({
          id: "bom-bom-bubble-machine-entry",
          tmId: mainTmId,
          srcHash: "bom-bom-bubble-machine",
          matchKey: "Bom Bom Bubble Machine",
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: "Bom Bom Bubble Machine" }],
          targetTokens: [{ type: "text", content: "Machine a bulles boum boum" }],
          usageCount: 1,
        } as any);

        const results = db.searchTMConcordanceRecallCandidates(projectId, longSource, [mainTmId], {
          profile: "english",
          scope: "source",
          limit: 8,
          rawLimit: 8,
        });

        expect(results.map((row) => row.srcHash)).toContain("bom-bom-bubble-machine");

        const debugCall = debugSpy.mock.calls.findLast(([message]) =>
          String(message).includes("concordance recall"),
        );
        expect(debugCall).toBeDefined();
        expect((debugCall?.[1] as Record<string, unknown>).ftsQueryCount).toBeGreaterThan(0);
      } finally {
        if (previousDebug === undefined) {
          delete process.env.CAT_TM_RECALL_DEBUG;
        } else {
          process.env.CAT_TM_RECALL_DEBUG = previousDebug;
        }
        debugSpy.mockRestore();
      }
    });

    it("should not accept cross-tag fake CJK containment in active concordance recall", () => {
      const projectId = db.createProject("Tag Boundary Concordance Recall", "zh", "fr");
      const mainTmId = db.createTM("Main Tag Boundary", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "cross-tag-fake",
        tmId: mainTmId,
        srcHash: "cross-tag-fake",
        matchKey: "风荷立柱",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "风荷立柱" }],
        targetTokens: [{ type: "text", content: "cross tag fake" }],
        usageCount: 1,
      } as any);
      db.insertTMFts(mainTmId, "风荷立柱", "cross tag fake", "cross-tag-fake");

      const results = db.searchTMConcordanceRecallCandidates(
        projectId,
        "风荷 立柱",
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 200 },
      );

      expect(results.map((row) => row.srcHash)).not.toContain("cross-tag-fake");
    });

    it("should clamp concordance raw limit and cap long latin recall plans", () => {
      const previousDebug = process.env.CAT_TM_RECALL_DEBUG;
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      process.env.CAT_TM_RECALL_DEBUG = "1";

      try {
        const projectId = db.createProject("Concordance Recall Guardrails", "en", "fr");
        const mainTmId = db.createTM("Main Recall Guardrails", "en", "fr", "main");
        db.mountTMToProject(projectId, mainTmId, 10, "read");
        const longLatinSource = Array.from({ length: 200 }, (_, index) => `term${index}`).join(" ");

        expect(() =>
          db.searchTMConcordanceRecallCandidates(projectId, longLatinSource, [mainTmId], {
            scope: "source",
            limit: 50,
            rawLimit: Number.POSITIVE_INFINITY,
          }),
        ).not.toThrow();

        const debugCall = debugSpy.mock.calls.find(([message]) =>
          String(message).includes("concordance recall"),
        );
        expect(debugCall).toBeDefined();
        expect((debugCall?.[1] as Record<string, unknown>).ftsQueryCount).toBeLessThanOrEqual(1);
      } finally {
        if (previousDebug === undefined) {
          delete process.env.CAT_TM_RECALL_DEBUG;
        } else {
          process.env.CAT_TM_RECALL_DEBUG = previousDebug;
        }
        debugSpy.mockRestore();
      }
    });

    it("should diversify active recall candidates before applying the result limit", () => {
      const projectId = db.createProject("TM Recall Diversity Project", "zh", "fr");
      const mainTmId = db.createTM("Main Recall Diversity", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let index = 0; index < 70; index += 1) {
        const sourceText = `噪音${index}立柱设计图`;
        db.upsertTMEntry({
          id: `active-template-crowd-${index}`,
          tmId: mainTmId,
          srcHash: `active-template-crowd-${index}`,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `Modele ${index}` }],
          usageCount: 1,
        } as any);
      }

      db.upsertTMEntry({
        id: "active-wind-lotus-pillar-entry",
        tmId: mainTmId,
        srcHash: "active-wind-lotus-pillar",
        matchKey: "风荷立柱",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "风荷立柱" }],
        targetTokens: [{ type: "text", content: "Pilier Lotus ondoyant" }],
        usageCount: 1,
      } as any);

      const results = db.searchTMRecallCandidates(
        projectId,
        "风荷立柱设计图",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      const hashes = results.map((row) => row.srcHash);

      expect(hashes).toContain("active-wind-lotus-pillar");
      expect(hashes.filter((srcHash) => srcHash.startsWith("active-template-crowd-"))).toHaveLength(2);
    });

    it("should count contained CJK recall buckets against the longest overlapping bucket", () => {
      const projectId = db.createProject("TM Recall Contained Diversity", "zh", "fr");
      const mainTmId = db.createTM("Main Recall Contained Diversity", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      [
        ["contained-long-1", "能力套装限时上架中"],
        ["contained-long-2", "能力套装限时上架中"],
        ["contained-short-1", "能力套装"],
        ["contained-short-2", "能力套装"],
      ].forEach(([srcHash, sourceText]) => {
        db.upsertTMEntry({
          id: `${srcHash}-entry`,
          tmId: mainTmId,
          srcHash,
          matchKey: sourceText,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: sourceText }],
          targetTokens: [{ type: "text", content: `Modele ${srcHash}` }],
          usageCount: 1,
        } as any);
      });

      const results = db.searchTMRecallCandidates(
        projectId,
        "能力套装限时上架中",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      const familyHashes = results
        .map((row) => row.srcHash)
        .filter((srcHash) => srcHash.startsWith("contained-"));

      expect(familyHashes).toHaveLength(2);
      expect(familyHashes.every((srcHash) => srcHash.startsWith("contained-long-"))).toBe(true);
    });

    it("should not return target-only hits for active source recall", () => {
      const projectId = db.createProject("TM Source Scope Recall", "zh", "fr");
      const mainTmId = db.createTM("Main Source Scope", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "target-only-entry",
        tmId: mainTmId,
        srcHash: "target-only-hash",
        matchKey: "unrelated-source",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "完全无关的来源文本" }],
        targetTokens: [{ type: "text", content: "风荷立柱设计图" }],
        usageCount: 100,
      } as any);

      const sourceScopeResults = db.searchTMRecallCandidates(
        projectId,
        "风荷立柱设计图",
        [mainTmId],
        { scope: "source", limit: 50 },
      );

      expect(sourceScopeResults.map((row) => row.srcHash)).not.toContain("target-only-hash");
    });

    it("should not let target-only FTS hits exhaust source-scoped recall", () => {
      const projectId = db.createProject("TM Source Scope Saturation", "en", "zh");
      const mainTmId = db.createTM("Main Source Scope Saturation", "en", "zh", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let index = 0; index < 40; index += 1) {
        db.upsertTMEntry({
          id: `target-noise-${index}`,
          tmId: mainTmId,
          srcHash: `target-noise-hash-${index}`,
          matchKey: `unrelated-source-${index}`,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: `unrelated source ${index}` }],
          targetTokens: [{ type: "text", content: "critical recall phrase" }],
          usageCount: 100,
        } as any);
      }

      db.upsertTMEntry({
        id: "source-hit-entry",
        tmId: mainTmId,
        srcHash: "source-hit-hash",
        matchKey: "critical recall phrase",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "critical recall phrase" }],
        targetTokens: [{ type: "text", content: "关键召回短语" }],
        usageCount: 1,
      } as any);

      const sourceScopeResults = db.searchTMRecallCandidates(
        projectId,
        "critical recall phrase",
        [mainTmId],
        { scope: "source", limit: 1 },
      );

      expect(sourceScopeResults.map((row) => row.srcHash)).toEqual(["source-hit-hash"]);
    });

    it("should keep highly relevant hit in top candidates under common-term noise", () => {
      const projectId = db.createProject("Concordance Ranking Project", "zh", "fr");

      const mainTmId = db.createTM("Main Corpus", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let i = 0; i < 70; i += 1) {
        db.upsertTMEntry({
          id: `noise-${i}`,
          tmId: mainTmId,
          srcHash: `noise-hash-${i}`,
          matchKey: `noise-${i}`,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: `这是一个无关样本 ${i}` }],
          targetTokens: [{ type: "text", content: `Bruit ${i}` }],
          usageCount: 1,
        } as any);
      }

      db.upsertTMEntry({
        id: "target-entry",
        tmId: mainTmId,
        srcHash: "target-hash",
        matchKey: "target",
        tagsSignature: "",
        sourceTokens: [
          {
            type: "text",
            content: "这份样本从录入到完成是需要时间的，没关系，我等你！",
          },
        ],
        targetTokens: [
          {
            type: "text",
            content:
              "Les paquerettes prennent leur temps pour grandir. Ce n'est pas grave, je t'attends !",
          },
        ],
        usageCount: 1,
      } as any);

      const results = db.searchTMRecallCandidates(
        projectId,
        "这份样本从录入到完成是需要时间的，没关系，我等你们！",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.length).toBeLessThanOrEqual(50);
      expect(results[0].srcHash).toBe("target-hash");
      expect(results.some((row) => row.srcHash === "target-hash")).toBe(true);
    });

    it("should find CJK sentence by inner phrase in concordance search", () => {
      const projectId = db.createProject("Concordance CJK Substring", "zh", "fr");
      const mainTmId = db.createTM("Main CJK", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "cjk-substring-entry",
        tmId: mainTmId,
        srcHash: "cjk-substring-hash",
        matchKey: "cjk-substring",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "甲组是怎么成为临时项目的负责人的？" }],
        targetTokens: [{ type: "text", content: "Comment l'equipe A est-elle devenue responsable du projet temporaire ?" }],
        usageCount: 1,
      } as any);

      const results = db.searchConcordance(projectId, "是怎么成为临时项目的负责人的？");
      expect(results.length).toBeLessThanOrEqual(10);
      expect(results.some((row) => row.srcHash === "cjk-substring-hash")).toBe(true);
    });

    it("should find near-identical CJK sentence when first character differs", () => {
      const projectId = db.createProject("Concordance CJK Near Match", "zh", "fr");
      const mainTmId = db.createTM("Main Near Match", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "cjk-near-entry",
        tmId: mainTmId,
        srcHash: "cjk-near-hash",
        matchKey: "cjk-near",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "甲组是怎么成为临时项目的负责人的？" }],
        targetTokens: [{ type: "text", content: "Comment l'equipe A est-elle devenue responsable du projet temporaire ?" }],
        usageCount: 1,
      } as any);

      const results = db.searchTMRecallCandidates(
        projectId,
        "乙组是怎么成为临时项目的负责人的？",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.length).toBeLessThanOrEqual(50);
      expect(results.some((row) => row.srcHash === "cjk-near-hash")).toBe(true);
    });

    it("should find short CJK item names by overlapping fragments", () => {
      const projectId = db.createProject("Concordance CJK Item Fragments", "zh", "fr");
      const mainTmId = db.createTM("Main Item Names", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "soft-pink-cloudwood-entry",
        tmId: mainTmId,
        srcHash: "soft-pink-cloudwood",
        matchKey: "soft-pink-cloudwood",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "柔粉织云木" }],
        targetTokens: [{ type: "text", content: "Bois nuageux rose doux" }],
        usageCount: 1,
      } as any);

      db.upsertTMEntry({
        id: "green-cloudwood-entry",
        tmId: mainTmId,
        srcHash: "green-cloudwood",
        matchKey: "green-cloudwood",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "岚绿织云木" }],
        targetTokens: [{ type: "text", content: "Bois nuageux vert brume" }],
        usageCount: 1,
      } as any);

      const cloudwoodResults = db.searchTMRecallCandidates(
        projectId,
        "织云木种子",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(cloudwoodResults.map((row) => row.srcHash)).toEqual(
        expect.arrayContaining(["soft-pink-cloudwood", "green-cloudwood"]),
      );

      db.upsertTMEntry({
        id: "sunny-icing-entry",
        tmId: mainTmId,
        srcHash: "sunny-icing",
        matchKey: "sunny-icing",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "晴日裱花" }],
        targetTokens: [{ type: "text", content: "Glacage jour clair" }],
        usageCount: 1,
      } as any);

      db.upsertTMEntry({
        id: "remote-dream-entry",
        tmId: mainTmId,
        srcHash: "remote-dream",
        matchKey: "remote-dream",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "遥梦花笺·困梦" }],
        targetTokens: [{ type: "text", content: "Papier de reve lointain" }],
        usageCount: 1,
      } as any);

      const dreamResults = db.searchTMRecallCandidates(
        projectId,
        "晴日裱花·困梦",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(dreamResults.map((row) => row.srcHash)).toEqual(
        expect.arrayContaining(["sunny-icing", "remote-dream"]),
      );
    });

    it("should not let single-character CJK fallback crowd out multi-character fragment matches", () => {
      const projectId = db.createProject("Concordance CJK Single Char Noise", "zh", "fr");
      const mainTmId = db.createTM("Main Single Char Noise", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      for (let index = 0; index < 10; index += 1) {
        db.upsertTMEntry({
          id: `single-char-noise-${index}`,
          tmId: mainTmId,
          srcHash: `single-char-noise-${index}`,
          matchKey: `single-char-noise-${index}`,
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: `晴噪音${index}` }],
          targetTokens: [{ type: "text", content: `Bruit ${index}` }],
          usageCount: 100 + index,
        } as any);
      }

      db.upsertTMEntry({
        id: "late-fragment-entry",
        tmId: mainTmId,
        srcHash: "late-fragment",
        matchKey: "late-fragment",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "困梦" }],
        targetTokens: [{ type: "text", content: "Reve trouble" }],
        usageCount: 1,
      } as any);

      const results = db.searchTMRecallCandidates(
        projectId,
        "晴日裱花琉璃霜雪困梦",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.map((row) => row.srcHash)).toContain("late-fragment");
    });
  });

  describe("Term Base System (v10)", () => {
    it("bumps the TB data version on structural writes but not on usage increments", () => {
      const initialVersion = db.getTBDataVersion();

      const projectId = db.createProject("TB Version Project", "en", "zh");
      const tbId = db.createTermBase("Versioned Terms", "en", "zh");
      expect(db.getTBDataVersion()).toBeGreaterThan(initialVersion);

      const afterCreate = db.getTBDataVersion();
      db.mountTermBaseToProject(projectId, tbId, 5);
      expect(db.getTBDataVersion()).toBeGreaterThan(afterCreate);

      const afterMount = db.getTBDataVersion();
      const entryId = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-version-e1",
        tbId,
        srcLang: "en-US",
        srcTerm: "Power Supply",
        tgtTerm: "电源",
      });
      expect(entryId).toBe("tb-version-e1");
      expect(db.getTBDataVersion()).toBeGreaterThan(afterMount);

      const afterInsert = db.getTBDataVersion();
      const duplicateInsert = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-version-e2",
        tbId,
        srcLang: "en-US",
        srcTerm: " power   supply ",
        tgtTerm: "供电",
      });
      expect(duplicateInsert).toBeUndefined();
      expect(db.getTBDataVersion()).toBe(afterInsert);

      db.incrementTBUsage("tb-version-e1");
      expect(db.getTBDataVersion()).toBe(afterInsert);

      db.upsertTBEntryBySrcTerm({
        id: "tb-version-e3",
        tbId,
        srcLang: "en-US",
        srcTerm: "Power Supply",
        tgtTerm: "供电模块",
      });
      expect(db.getTBDataVersion()).toBeGreaterThan(afterInsert);

      const afterUpsert = db.getTBDataVersion();
      db.unmountTermBaseFromProject(projectId, tbId);
      expect(db.getTBDataVersion()).toBeGreaterThan(afterUpsert);

      const afterUnmount = db.getTBDataVersion();
      db.deleteTermBase(tbId);
      expect(db.getTBDataVersion()).toBeGreaterThan(afterUnmount);
    });

    it("should create and mount term base to project", () => {
      const projectId = db.createProject("TB Project", "en", "zh");
      const tbId = db.createTermBase("Product Terms", "en", "zh");

      db.mountTermBaseToProject(projectId, tbId, 5);

      const mounted = db.getProjectMountedTermBases(projectId);
      expect(mounted).toHaveLength(1);
      expect(mounted[0].id).toBe(tbId);
      expect(mounted[0].name).toBe("Product Terms");
    });

    it("should insert and upsert term entries by normalized source term", () => {
      const tbId = db.createTermBase("Glossary", "en", "zh");

      const firstInsert = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-e1",
        tbId,
        srcLang: "en-US",
        srcTerm: "Power Supply",
        tgtTerm: "电源",
      });
      expect(firstInsert).toBe("tb-e1");

      const duplicateInsert = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-e2",
        tbId,
        srcLang: "en-US",
        srcTerm: " power   supply ",
        tgtTerm: "供电",
      });
      expect(duplicateInsert).toBeUndefined();

      const upserted = db.upsertTBEntryBySrcTerm({
        id: "tb-e3",
        tbId,
        srcLang: "en-US",
        srcTerm: "Power Supply",
        tgtTerm: "供电模块",
      });
      expect(upserted).toBe("tb-e1");

      const entries = db.listTBEntries(tbId, 20, 0);
      expect(entries).toHaveLength(1);
      expect(entries[0].srcNorm).toBe("power supply");
      expect(entries[0].tgtTerm).toBe("供电模块");
    });

    it("should normalize width variants into the same TB source norm", () => {
      const tbId = db.createTermBase("Width Normalized", "en-US", "ja-JP");

      const firstInsert = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-width-1",
        tbId,
        srcLang: "en-US",
        srcTerm: "API Key",
        tgtTerm: "APIキー",
      });
      const duplicateInsert = db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-width-2",
        tbId,
        srcLang: "en-US",
        srcTerm: "ＡＰＩ Key",
        tgtTerm: "別訳",
      });

      expect(firstInsert).toBe("tb-width-1");
      expect(duplicateInsert).toBeUndefined();
      expect(db.listTBEntries(tbId, 20, 0)[0].srcNorm).toBe("api key");
    });

    it("should search mounted term entries through tb_fts and respect mounted priority order", () => {
      const projectId = db.createProject("TB Search", "zh-CN", "en-US");
      const highTbId = db.createTermBase("High TB", "zh-CN", "en-US");
      const lowTbId = db.createTermBase("Low TB", "zh-CN", "en-US");

      db.mountTermBaseToProject(projectId, highTbId, 1);
      db.mountTermBaseToProject(projectId, lowTbId, 9);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-search-1",
        tbId: highTbId,
        srcLang: "zh-CN",
        srcTerm: "设置页面",
        tgtTerm: "settings page",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-search-2",
        tbId: lowTbId,
        srcLang: "zh-CN",
        srcTerm: "打开设置页面",
        tgtTerm: "open settings page",
      });

      const results = db.searchProjectTermEntries(projectId, "请先打开设置页面，然后继续。", {
        srcLang: "zh-CN",
        limit: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0].tbName).toBe("High TB");
      expect(results[0].srcTerm).toBe("设置页面");
      expect(results[1].tbName).toBe("Low TB");
      expect(results[1].srcTerm).toBe("打开设置页面");
    });

    it("should return Chinese and Latin TB candidates from mixed-source text via trigram search", () => {
      const projectId = db.createProject("TB Search Mixed", "zh-CN", "ko-KR");
      const tbId = db.createTermBase("Mixed TB", "zh-CN", "ko-KR");
      db.mountTermBaseToProject(projectId, tbId, 5);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-mixed-zh",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "设置页面",
        tgtTerm: "설정 페이지",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-mixed-en",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "API key",
        tgtTerm: "API 키",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "请保护你的ＡＰＩ key，然后打开设置页面。",
        {
          srcLang: "zh-CN",
          limit: 10,
        },
      );

      expect(results.map((row) => row.srcTerm)).toEqual(
        expect.arrayContaining(["设置页面", "API key"]),
      );
    });

    it("should recall short non-cjk exact terms alongside longer FTS matches", () => {
      const projectId = db.createProject("TB Search Short Exact", "zh-CN", "en-US");
      const tbId = db.createTermBase("Short Exact TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-short-exact-long",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "设置页面",
        tgtTerm: "settings page",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-short-exact-ai",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "AI",
        tgtTerm: "artificial intelligence",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "请先打开设置页面，然后检查 AI 配置。",
        {
          srcLang: "zh-CN",
          limit: 10,
        },
      );

      expect(results.map((row) => row.srcTerm)).toEqual(
        expect.arrayContaining(["设置页面", "AI"]),
      );
    });

    it("should recall 3-character Chinese terms from long source text", () => {
      const projectId = db.createProject("TB Search Long CJK", "zh-CN", "en-US");
      const tbId = db.createTermBase("Long CJK TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-long-zh-3",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "领奖台",
        tgtTerm: "podium",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-long-zh-4",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "闭幕式",
        tgtTerm: "closing ceremony",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "赛事公告说明领奖台区域将在闭幕式开始前开放，获奖名单与奖章组会同时完成终审流程。",
        {
          srcLang: "zh-CN",
          limit: 20,
        },
      );

      expect(results.map((row) => row.srcTerm)).toEqual(
        expect.arrayContaining(["领奖台", "闭幕式"]),
      );
    });

    it("should recall mixed-script embedded CJK exact terms when FTS candidates are crowded", () => {
      const projectId = db.createProject("TB Search Mixed CJK Exact", "zh-CN", "fr-FR");
      const tbId = db.createTermBase("Mixed CJK Exact TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-mixed-cjk-exact-hit",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "喵居商店",
        tgtTerm: "Boutique Miaou Maison",
      });

      for (let index = 0; index < 220; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-mixed-cjk-noise-${index}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: `喵居商店冗余候选${String(index).padStart(3, "0")}`,
          tgtTerm: `candidat-bruit-${index}`,
        });
      }

      const results = db.searchProjectTermEntries(projectId, "AI喵居商店suffix", {
        srcLang: "zh-CN",
        limit: 200,
      });

      expect(results.map((row) => row.srcTerm)).toContain("喵居商店");
    });

    it("should recall short CJK exact matches even when mounted TB has more than 5000 rows", () => {
      const projectId = db.createProject("TB Short CJK Fallback", "zh-CN", "en-US");
      const tbId = db.createTermBase("Large TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (let index = 0; index < 5200; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-large-${index}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: `大型术语条目${String(index).padStart(4, "0")}`,
          tgtTerm: `large-term-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-short-cjk-hit",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "领奖台",
        tgtTerm: "podium",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "在赛季总决赛的最终通告里，主办方确认领奖台区域将在闭幕仪式开始前再次开放给获奖选手和彩排人员。",
        {
          srcLang: "zh-CN",
          limit: 20,
        },
      );

      expect(results.map((row) => row.srcTerm)).toContain("领奖台");
    }, 15_000);

    it("should not recall single-character CJK exact terms while preserving longer candidates", () => {
      const projectId = db.createProject("TB Search Single CJK", "zh-CN", "en-US");
      const tbId = db.createTermBase("Single CJK TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-single-cjk-char",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "奖",
        tgtTerm: "award",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-single-cjk-long",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "领奖台",
        tgtTerm: "podium",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "请前往领奖台领取奖章。",
        {
          srcLang: "zh-CN",
          limit: 10,
        },
      );

      expect(results.map((row) => row.srcTerm)).toContain("领奖台");
      expect(results.map((row) => row.srcTerm)).not.toContain("奖");
    });

    it("should include FTS candidates when exact CJK candidates fill the candidate limit", () => {
      const projectId = db.createProject("TB Search Exact Crowds FTS", "zh-CN", "fr-FR");
      const tbId = db.createTermBase("Exact Crowds FTS TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      const exactTerms = Array.from({ length: 201 }, (_, index) => {
        const firstVariant = String.fromCodePoint(0x4e00 + Math.floor(index / 32));
        const secondVariant = String.fromCodePoint(0x4e80 + (index % 32));
        return `测${firstVariant}试${secondVariant}词`;
      });
      const longFtsOnlyTerm = "超长术语候选尾部项目";

      for (const [index, term] of exactTerms.entries()) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-exact-crowds-fts-${index}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: term,
          tgtTerm: `terme-exact-${index}`,
        });
      }
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-long-cjk-fts-only",
        tbId,
        srcLang: "zh-CN",
        srcTerm: longFtsOnlyTerm,
        tgtTerm: "terme-long",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        [...exactTerms, longFtsOnlyTerm].join("、"),
        {
          srcLang: "zh-CN",
          limit: 200,
        },
      );

      expect(results.length).toBeLessThanOrEqual(200);
      expect(results.map((row) => row.srcTerm)).toContain(longFtsOnlyTerm);
    });

    it("should keep the top CJK exact candidate when the requested limit is one", () => {
      const projectId = db.createProject("TB Search CJK Tiny Limit", "zh-CN", "fr-FR");
      const tbId = db.createTermBase("CJK Tiny Limit TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-cjk-tiny-limit-exact",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "领奖台",
        tgtTerm: "podium",
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-cjk-tiny-limit-fts",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "领奖台超长候选噪声",
        tgtTerm: "bruit long",
      });

      const results = db.searchProjectTermEntries(projectId, "领奖台", {
        srcLang: "zh-CN",
        limit: 1,
      });

      expect(results.map((row) => row.srcTerm)).toEqual(["领奖台"]);
    });

    it("preserves CJK legacy combined FTS recall for Latin single fragments", () => {
      const projectId = db.createProject("TB Search CJK Legacy FTS", "zh-CN", "fr-FR");
      const tbId = db.createTermBase("CJK Legacy FTS TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-cjk-legacy-fts-midnight",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "midnight sun",
        tgtTerm: "soleil de minuit",
      });

      const results = db.searchProjectTermEntries(projectId, "midnight", {
        srcLang: "zh-CN",
        limit: 10,
      });

      expect(results.map((row) => row.srcTerm)).toContain("midnight sun");
    });

    it("does not use EN/general per-fragment fallback for CJK source projects", () => {
      const projectId = db.createProject("TB Search CJK General Guard", "zh-CN", "fr-FR");
      const tbId = db.createTermBase("CJK General Guard TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 10);

      for (let index = 0; index < 20; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-cjk-general-noise-${index}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: `Change Details: Configuration Panel Option ${index} Settings`,
          tgtTerm: `bruit-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-cjk-general-target",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "midnight sun",
        tgtTerm: "soleil de minuit",
      });

      const results = db.searchProjectTermEntries(projectId, "Change Details celebrating midnight ceremonies.", {
        srcLang: "zh-CN",
        limit: 10,
      });

      expect(results.map((row) => row.srcTerm)).not.toContain("midnight sun");
    });

    it("should keep English exact candidates ahead of FTS when exact lookup fills the candidate limit", () => {
      const projectId = db.createProject("TB Search English Exact Crowds FTS", "en-US", "fr-FR");
      const tbId = db.createTermBase("English Exact Crowds FTS TB", "en-US", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      const exactTerms = Array.from({ length: 201 }, (_, index) => {
        const first = String.fromCharCode(97 + Math.floor(index / 26));
        const second = String.fromCharCode(97 + (index % 26));
        return `x${first}${second}`;
      });
      const longFtsOnlyTerm = `${exactTerms[0]} ${exactTerms[1]} noisy fts candidate`;

      for (const [index, term] of exactTerms.entries()) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-english-exact-crowds-fts-${index}`,
          tbId,
          srcLang: "en-US",
          srcTerm: term,
          tgtTerm: `terme-exact-${index}`,
        });
      }
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-english-long-fts-only",
        tbId,
        srcLang: "en-US",
        srcTerm: longFtsOnlyTerm,
        tgtTerm: "terme-long",
      });

      const results = db.searchProjectTermEntries(projectId, exactTerms.join(" "), {
        srcLang: "en-US",
        limit: 200,
      });

      expect(results).toHaveLength(200);
      expect(results.map((row) => row.srcTerm)).not.toContain(longFtsOnlyTerm);
    });

    it("should recall an English exact term when broad trigram FTS noise exceeds the candidate limit", () => {
      const projectId = db.createProject("TB Search English Trigram Noise", "en-US", "fr-FR");
      const tbId = db.createTermBase("English Trigram Noise TB", "en-US", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (let index = 0; index < 230; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-english-shroomsera-noise-${index}`,
          tbId,
          srcLang: "en-US",
          srcTerm: `Sketch: Tumbler Doll: Variant ${index} Shroomsera`,
          tgtTerm: `noise-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-english-shroomseras",
        tbId,
        srcLang: "en-US",
        srcTerm: "Shroomseras",
        tgtTerm: "Champicetes",
      });

      const results = db.searchProjectTermEntries(
        projectId,
        "The intersecting streets offer plenty of room for the passing Mechadolls and the occasional frolicking Shroomseras.",
        {
          srcLang: "en-US",
          limit: 200,
        },
      );

      expect(results.map((row) => row.srcTerm)).toContain("Shroomseras");
    });

    it("should reapply the requested limit after merging exact lookup candidates", () => {
      const projectId = db.createProject("TB Search Exact Limit", "zh-CN", "en-US");
      const tbId = db.createTermBase("Exact Limit TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (const term of ["甲乙", "丙丁", "戊己", "庚辛", "壬癸", "子丑", "寅卯", "辰巳"]) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-exact-limit-${term}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: term,
          tgtTerm: `term-${term}`,
        });
      }

      const results = db.searchProjectTermEntries(projectId, "甲乙、丙丁、戊己、庚辛、壬癸、子丑、寅卯、辰巳", {
        srcLang: "zh-CN",
        limit: 3,
      });

      expect(results).toHaveLength(3);
      expect(results.every((row) => row.srcTerm.length === 2)).toBe(true);
    });

    it("should recall a short single-word-matched entry even when phrase-matched noise fills the pool", () => {
      const projectId = db.createProject("TB Tiered Merge", "en-US", "fr-FR");
      const tbId = db.createTermBase("Tiered Merge TB", "en-US", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 1);

      // Create 220 long entries matching phrase fragment "change details"
      for (let index = 0; index < 220; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-tiered-noise-${index}`,
          tbId,
          srcLang: "en-US",
          srcTerm: `Change Details: Configuration Panel Option ${index} Settings`,
          tgtTerm: `noise-${index}`,
        });
      }

      // Target entry: only recallable via single-word FTS "midnight"
      // (no article prefix in source, no phrase containing "midnight")
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-tiered-target",
        tbId,
        srcLang: "en-US",
        srcTerm: "Midnight Sun",
        tgtTerm: "Soleil de minuit",
      });

      // Source text: "midnight" appears but not preceded by an article,
      // and no multi-word phrase involving "midnight" survives stopword filter.
      // The 220 noise entries match phrase fragment "change details".
      const results = db.searchProjectTermEntries(
        projectId,
        "Change Details: The Self Reclaimed (Backpiece) celebrating midnight ceremonies Configuration Panel Option",
        { srcLang: "en-US", limit: 200 },
      );

      expect(results.map((row) => row.srcTerm)).toContain("Midnight Sun");
    });

    it("uses EN/general single-fragment fallback for non-CJK source projects", () => {
      const projectId = db.createProject("TB Search French General Profile", "fr-FR", "en-US");
      const tbId = db.createTermBase("French General Profile TB", "fr-FR", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 10);

      for (let index = 0; index < 20; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-french-general-noise-${index}`,
          tbId,
          srcLang: "fr-FR",
          srcTerm: `Change Details: Configuration Panel Option ${index} Settings`,
          tgtTerm: `archive-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-french-general-target",
        tbId,
        srcLang: "fr-FR",
        srcTerm: "Midnight Sun",
        tgtTerm: "soleil de minuit",
      });

      const results = db.searchProjectTermEntries(projectId, "Change Details celebrating midnight ceremonies.", {
        srcLang: "fr-FR",
        limit: 10,
      });

      expect(results.map((row) => row.srcTerm)).toContain("Midnight Sun");
    });

    it("ranks single-fragment FTS candidates before applying the per-fragment limit", () => {
      const projectId = db.createProject("TB Search Single Fragment SQL Limit", "en-US", "fr-FR");
      const tbId = db.createTermBase("Single Fragment SQL Limit TB", "en-US", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 10);

      for (let index = 0; index < 12; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-single-fragment-limit-noise-${index}`,
          tbId,
          srcLang: "en-US",
          srcTerm: `Midnight Configuration Archive Variant ${index} Long Name`,
          tgtTerm: `noise-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-single-fragment-limit-target",
        tbId,
        srcLang: "en-US",
        srcTerm: "Midnight Sun",
        tgtTerm: "soleil de minuit",
      });

      const results = db.searchProjectTermEntries(projectId, "The archive opens at midnight.", {
        srcLang: "en-US",
        limit: 5,
      });

      expect(results.map((row) => row.srcTerm)).toContain("Midnight Sun");
    });
  });
});

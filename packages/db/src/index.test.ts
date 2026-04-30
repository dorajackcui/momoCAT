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
    expect(project?.aiModel).toBe("builtin:openai:gpt-5.4-mini");
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
      "gpt-5-mini",
    );

    const project = db.getProject(projectId);
    expect(project?.aiPrompt).toBe("Keep product names untranslated.");
    expect(project?.aiModel).toBe("builtin:openai:gpt-5-mini");
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
    });

    it("should recall single-character CJK terms alongside longer candidates", () => {
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

      expect(results.map((row) => row.srcTerm)).toEqual(
        expect.arrayContaining(["奖", "领奖台"]),
      );
    });

    it("should reapply the requested limit after merging exact lookup candidates", () => {
      const projectId = db.createProject("TB Search Exact Limit", "zh-CN", "en-US");
      const tbId = db.createTermBase("Exact Limit TB", "zh-CN", "en-US");
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (const term of ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"]) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-exact-limit-${term}`,
          tbId,
          srcLang: "zh-CN",
          srcTerm: term,
          tgtTerm: `term-${term}`,
        });
      }

      const results = db.searchProjectTermEntries(projectId, "甲乙丙丁戊己庚辛", {
        srcLang: "zh-CN",
        limit: 3,
      });

      expect(results).toHaveLength(3);
      expect(results.every((row) => row.srcTerm.length === 1)).toBe(true);
    });
  });
});

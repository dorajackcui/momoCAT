import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
          sourceTokens: [{ type: "text", content: `没关系，这是一条噪声语料 ${i}` }],
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
            content: "小绵菊从种下到长大是需要时间的，没关系，我等你！",
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

      const results = db.searchConcordance(
        projectId,
        "小绵菊从种下到长大是需要时间的 OR 没关系 OR 我等你们",
      );
      expect(results).toHaveLength(10);
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
        sourceTokens: [{ type: "text", content: "老大是怎么成为遗忘者聚落的领袖的？" }],
        targetTokens: [{ type: "text", content: "Comment est-il devenu le chef du camp des Oublies ?" }],
        usageCount: 1,
      } as any);

      const results = db.searchConcordance(projectId, "是怎么成为遗忘者聚落的领袖的？");
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
        sourceTokens: [{ type: "text", content: "老大是怎么成为遗忘者聚落的领袖的？" }],
        targetTokens: [{ type: "text", content: "Comment est-il devenu le chef du camp des Oublies ?" }],
        usageCount: 1,
      } as any);

      const results = db.searchConcordance(projectId, "老三是怎么成为遗忘者聚落的领袖的？");
      expect(results.length).toBeLessThanOrEqual(10);
      expect(results.some((row) => row.srcHash === "cjk-near-hash")).toBe(true);
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
  });
});

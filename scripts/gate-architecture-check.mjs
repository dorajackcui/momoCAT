import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const PROJECT_SERVICE_PATH = path.join(
  ROOT,
  'apps/desktop/src/main/services/ProjectService.ts',
);
const CAT_DATABASE_PATH = path.join(ROOT, 'packages/db/src/index.ts');
const GUARDRAILS_PATH = path.join(ROOT, 'DOCS/architecture/GATE05_GUARDRAILS.json');

const guardrails = JSON.parse(fs.readFileSync(GUARDRAILS_PATH, 'utf8'));
const errors = [];

const CONTROL_FLOW_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.TryStatement,
]);

function readSourceFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
}

function hasModifier(node, modifierKind) {
  return node.modifiers?.some((modifier) => modifier.kind === modifierKind) ?? false;
}

function getClassOrThrow(sourceFile, className) {
  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === className) {
      return statement;
    }
  }
  throw new Error(`Class "${className}" not found in ${sourceFile.fileName}`);
}

function getPublicMethods(classDeclaration) {
  return classDeclaration.members.filter((member) => {
    if (!ts.isMethodDeclaration(member)) return false;
    if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) return false;
    if (hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) return false;
    return true;
  });
}

function getMethodName(method) {
  if (ts.isIdentifier(method.name)) return method.name.text;
  if (ts.isStringLiteral(method.name)) return method.name.text;
  return '<computed>';
}

function collectMethodFacts(method) {
  const thisProperties = new Set();
  const delegatedFields = new Set();
  const controlFlowKinds = new Set();

  const walk = (node) => {
    if (CONTROL_FLOW_KINDS.has(node.kind)) {
      controlFlowKinds.add(ts.SyntaxKind[node.kind]);
    }

    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      thisProperties.add(node.name.text);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const outer = node.expression;
      if (ts.isPropertyAccessExpression(outer.expression)) {
        const inner = outer.expression;
        if (inner.expression.kind === ts.SyntaxKind.ThisKeyword) {
          delegatedFields.add(inner.name.text);
        }
      }
    }

    ts.forEachChild(node, walk);
  };

  if (method.body) {
    ts.forEachChild(method.body, walk);
  }

  return { thisProperties, delegatedFields, controlFlowKinds };
}

function compareSetWithAllowlist(actualSet, allowlist) {
  return [...actualSet].filter((value) => !allowlist.has(value));
}

function listSourceFiles(rootDir) {
  const result = [];

  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
        result.push(fullPath);
      }
    }
  };

  walk(rootDir);
  return result;
}

function getImportSpecifiers(sourceFile) {
  return sourceFile.statements
    .filter((statement) => ts.isImportDeclaration(statement))
    .map((statement) => statement.moduleSpecifier.text)
    .filter((specifier) => typeof specifier === 'string');
}

function resolveImportTarget(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function validateProjectService() {
  const sourceFile = readSourceFile(PROJECT_SERVICE_PATH);
  const classDeclaration = getClassOrThrow(sourceFile, 'ProjectService');
  const methods = getPublicMethods(classDeclaration);

  const allowedDelegateFields = new Set(guardrails.projectService.allowedDelegateFields);
  const delegationExceptions = new Set(guardrails.projectService.delegationExceptions);

  for (const method of methods) {
    const methodName = getMethodName(method);
    const { thisProperties, delegatedFields, controlFlowKinds } = collectMethodFacts(method);

    if (delegationExceptions.has(methodName)) {
      continue;
    }

    const unknownThisProperties = compareSetWithAllowlist(thisProperties, allowedDelegateFields);
    if (unknownThisProperties.length > 0) {
      errors.push(
        `ProjectService.${methodName} references disallowed fields: ${unknownThisProperties.join(', ')}`,
      );
    }

    const usesAllowedDelegate = [...delegatedFields].some((field) =>
      allowedDelegateFields.has(field),
    );
    if (!usesAllowedDelegate) {
      errors.push(
        `ProjectService.${methodName} must delegate to a module/use-case field (${[
          ...allowedDelegateFields,
        ].join(', ')})`,
      );
    }

    if (controlFlowKinds.size > 0) {
      errors.push(
        `ProjectService.${methodName} contains business control flow (${[
          ...controlFlowKinds,
        ].join(', ')}); move logic to services/modules`,
      );
    }
  }
}

function validateCatDatabase() {
  const sourceFile = readSourceFile(CAT_DATABASE_PATH);
  const classDeclaration = getClassOrThrow(sourceFile, 'CATDatabase');
  const methods = getPublicMethods(classDeclaration);

  const publicMethodNames = methods.map(getMethodName).sort();
  const expectedPublicMethodNames = [...guardrails.catDatabase.publicMethods].sort();

  const missingMethods = expectedPublicMethodNames.filter(
    (methodName) => !publicMethodNames.includes(methodName),
  );
  const addedMethods = publicMethodNames.filter(
    (methodName) => !expectedPublicMethodNames.includes(methodName),
  );

  if (missingMethods.length > 0 || addedMethods.length > 0) {
    errors.push(
      `CATDatabase public API changed. Missing: ${
        missingMethods.join(', ') || '(none)'
      } | Added: ${addedMethods.join(', ') || '(none)'}`,
    );
  }

  const repoFields = new Set(['projectRepo', 'segmentRepo', 'settingsRepo', 'tbRepo', 'tmRepo']);
  const legacyMultiRepoMethods = new Set(guardrails.catDatabase.legacyMultiRepoMethods);
  const allowedDirectDbMethods = new Set(guardrails.catDatabase.allowedDirectDbMethods);

  for (const method of methods) {
    const methodName = getMethodName(method);
    const { thisProperties } = collectMethodFacts(method);

    const touchedRepoFields = [...thisProperties].filter((field) => repoFields.has(field));
    const uniqueTouchedRepos = new Set(touchedRepoFields);

    if (uniqueTouchedRepos.size > 1 && !legacyMultiRepoMethods.has(methodName)) {
      errors.push(
        `CATDatabase.${methodName} touches multiple repos (${[
          ...uniqueTouchedRepos,
        ].join(', ')}); orchestration must move to use-case/module layer`,
      );
    }

    if (thisProperties.has('db') && !allowedDirectDbMethods.has(methodName)) {
      errors.push(
        `CATDatabase.${methodName} touches raw db directly; keep db access inside repos`,
      );
    }
  }
}

function validateCatCoreImports() {
  const catCoreGuard = guardrails.catCore;
  const rootBarrelModule = catCoreGuard.rootBarrelModule;
  const rootBarrelPath = path.join(ROOT, catCoreGuard.rootBarrelPath);
  const checkedRoots = catCoreGuard.checkedRoots.map((checkedRoot) => path.join(ROOT, checkedRoot));
  const allowedRootBarrelImportFiles = new Set(catCoreGuard.allowedRootBarrelImportFiles);
  const allowedInternalRootIndexImportFiles = new Set(
    catCoreGuard.allowedInternalRootIndexImportFiles,
  );
  const coreSourceRoot = path.join(ROOT, 'packages/core/src');

  for (const checkedRoot of checkedRoots) {
    const files = listSourceFiles(checkedRoot);

    for (const filePath of files) {
      const relativeFilePath = path.relative(ROOT, filePath);
      const sourceFile = readSourceFile(filePath);
      const importSpecifiers = getImportSpecifiers(sourceFile);

      for (const specifier of importSpecifiers) {
        if (
          specifier === rootBarrelModule &&
          !allowedRootBarrelImportFiles.has(relativeFilePath)
        ) {
          errors.push(
            `${relativeFilePath} imports root ${rootBarrelModule}; use a slice entrypoint instead`,
          );
        }

        if (!filePath.startsWith(coreSourceRoot) || !specifier.startsWith('.')) {
          continue;
        }

        const resolvedTarget = resolveImportTarget(filePath, specifier);
        if (!resolvedTarget) {
          continue;
        }

        if (
          path.normalize(resolvedTarget) === path.normalize(rootBarrelPath) &&
          !allowedInternalRootIndexImportFiles.has(relativeFilePath)
        ) {
          errors.push(
            `${relativeFilePath} imports packages/core root index via "${specifier}"; import the needed slice or sibling module instead`,
          );
        }
      }
    }
  }
}

try {
  validateProjectService();
  validateCatDatabase();
  validateCatCoreImports();
} catch (error) {
  console.error('[gate:arch] Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (errors.length > 0) {
  console.error('[gate:arch] Architecture guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[gate:arch] Architecture guard passed.');

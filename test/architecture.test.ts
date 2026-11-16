import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const backend = fileURLToPath(new URL('../src/', import.meta.url));
const frontend = fileURLToPath(new URL('../../frontend/src/', import.meta.url));
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
function parse(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
function visit(node: ts.Node, callback: (node: ts.Node) => void) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

test('database operations remain in repositories and controllers only depend on the service layer', () => {
  for (const path of files(backend)) {
    const name = relative(backend, path).replaceAll('\\', '/');
    const ast = parse(path);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const dependency = statement.moduleSpecifier.text;
      if (name.startsWith('controllers/'))
        assert.ok(
          !dependency.includes('/repositories/') && !dependency.includes('/db/'),
          `${name}: HTTP layer cannot access persistence`,
        );
      if (name.startsWith('services/') || name.startsWith('controllers/')) {
        assert.ok(!dependency.startsWith('drizzle-orm'), `${name}: SQL belongs in repositories`);
        assert.ok(
          !/\/db\/index\.js$/.test(dependency),
          `${name}: database instance belongs in repositories`,
        );
      }
    }
    if (name.startsWith('repositories/') || name.startsWith('db/')) continue;
    visit(ast, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      const receiver = node.expression.expression.getText(ast);
      assert.ok(
        !(
          ['select', 'insert', 'update', 'delete', 'execute', 'transaction'].includes(method) &&
          /^(db|tx|context)$/.test(receiver)
        ),
        `${name}: direct database operation`,
      );
      assert.ok(!/^(db|tx|context)\.query\./.test(receiver), `${name}: direct relational query`);
    });
  }
});

test('backend routes reference controllers and request validation stays outside controllers', () => {
  for (const path of files(join(backend, 'routes'))) {
    const ast = parse(path);
    visit(ast, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (['get', 'post', 'patch', 'put', 'delete'].includes(node.expression.name.text)) {
        assert.ok(
          node.arguments.every(
            (argument) => !ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument),
          ),
          `${path}: inline route handler`,
        );
      }
    });
  }
  for (const path of files(join(backend, 'controllers'))) {
    assert.ok(
      !/\.parse\(req\./.test(readFileSync(path, 'utf8')),
      `${path}: request parsing belongs in validation middleware`,
    );
  }
});

test('frontend page composition and feature HTTP boundaries remain separate', () => {
  assert.ok(!existsSync(join(dirname(frontend), 'app')), 'root app would override src/app');
  const page = readFileSync(join(frontend, 'app/page.tsx'), 'utf8');
  assert.ok(
    !page.includes('use client') && !page.includes('useEffect'),
    'page must remain server composition',
  );
  for (const path of files(frontend).filter((path) => /[\\/]components[\\/]/.test(path))) {
    const ast = parse(path);
    visit(ast, (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        assert.ok(
          !['api', 'fetch'].includes(node.expression.text),
          `${path}: HTTP calls belong in feature services`,
        );
    });
  }
});

test('production TypeScript avoids explicit any and keeps strict compiler settings', () => {
  for (const root of [backend, frontend]) {
    const config = JSON.parse(readFileSync(join(dirname(root), 'tsconfig.json'), 'utf8'));
    assert.equal(config.compilerOptions.strict, true);
    for (const path of files(root)) {
      visit(parse(path), (node) =>
        assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, `${path}: explicit any`),
      );
    }
  }
});

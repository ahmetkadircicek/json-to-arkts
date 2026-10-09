// Type checks and lints .ets files with ohos-typescript, the TypeScript fork
// DevEco Studio builds ArkTS with, including its ArkTS linter (strict mode
// rules such as arkts-no-any-unknown and arkts-no-untyped-obj-literals).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('ohos-typescript');

// The ArkUI decorators the generated code uses, as the SDK declares them.
const DECLARATIONS = `
declare const Observed: ClassDecorator;
declare const ObservedV2: ClassDecorator;
declare const Trace: PropertyDecorator;
`;

/**
 * Checks a set of projects. Each project is { name, files: [{ name, content }] }
 * and gets its own directory so files may import each other.
 * Returns a list of "project/file:line:col message" strings.
 */
export function checkArkTS(projects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-check-'));
  try {
    const rootNames = [path.join(root, 'decorators.d.ts')];
    fs.writeFileSync(rootNames[0], DECLARATIONS);
    for (const project of projects) {
      const dir = path.join(root, project.name);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of project.files) {
        const fileName = path.join(dir, file.name);
        fs.writeFileSync(fileName, file.content);
        rootNames.push(fileName);
      }
    }

    const options = {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      experimentalDecorators: true,
      lib: ['lib.es2020.d.ts'],
    };
    const host = ts.createIncrementalCompilerHost(options);
    const builder = ts.createIncrementalProgram({ rootNames, options, host });
    const diagnostics = [
      ...ts.getPreEmitDiagnostics(builder.getProgram()),
      ...ts.ArkTSLinter_1_1.runArkTSLinter(builder, undefined, undefined, 'ArkTS_1_1'),
    ];
    return diagnostics.map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (!d.file) return message;
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${path.relative(root, d.file.fileName)}:${line + 1}:${character + 1} ${message}`;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const cache = new Map();
// Local test loader only. Runtime dependencies can be replaced with fake modules.
export async function typescriptModule(path, replacements = {}) {
  const filename = new URL(path, import.meta.url);
  const key = filename.href + JSON.stringify(replacements);
  if (cache.has(key)) return cache.get(key);
  let source = (await readFile(filename, 'utf8')).replace("import 'server-only';", '');
  for (const [specifier, url] of Object.entries(replacements)) source = source.replaceAll(`'${specifier}'`, `'${url}'`);
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const specifier of new Set(Array.from(output.matchAll(/from ['"](@\/[^'"]+)['"]/g), match => match[1]))) {
    const url = await typescriptModule(`../src/${specifier.slice(2)}.ts`, replacements);
    output = output.replaceAll(`'${specifier}'`, `'${url}'`).replaceAll(`"${specifier}"`, `"${url}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  cache.set(key, url);
  return url;
}

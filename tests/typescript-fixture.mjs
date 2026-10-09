import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const cache = new Map();
// Local test loader only. Runtime dependencies can be replaced with fake modules.
export async function typescriptModule(path, replacements = {}) {
  let filename = new URL(path, import.meta.url);
  const key = filename.href + JSON.stringify(replacements);
  if (cache.has(key)) return cache.get(key);
  let source;
  try { source = await readFile(filename, 'utf8'); }
  catch (error) {
    if (!filename.pathname.endsWith('.ts') || error.code !== 'ENOENT') throw error;
    filename = new URL(filename.href.replace(/\.ts$/, '.tsx'));
    source = await readFile(filename, 'utf8');
  }
  source = source.replace("import 'server-only';", '');
  for (const [specifier, url] of Object.entries(replacements)) source = source.replaceAll(`'${specifier}'`, `'${url}'`);
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const specifier of new Set(Array.from(output.matchAll(/from ['"]([^'"]+)['"]/g), match => match[1]))) {
    let url;
    if (specifier.endsWith('.css')) url = 'data:text/javascript,export default new Proxy({}, {get: (_, key) => String(key)});';
    else if (specifier.startsWith('@/')) url = await typescriptModule(`../src/${specifier.slice(2)}.ts`, replacements);
    else if (specifier.startsWith('.')) url = await typescriptModule(new URL(`${specifier}.ts`, filename).href, replacements);
    else if (specifier === 'react' || specifier.startsWith('react/')) url = pathToFileURL(require.resolve(specifier)).href;
    else continue;
    output = output.replaceAll(`'${specifier}'`, `'${url}'`).replaceAll(`"${specifier}"`, `"${url}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  cache.set(key, url);
  return url;
}

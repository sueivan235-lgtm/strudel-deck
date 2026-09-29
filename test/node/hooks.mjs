import { readFile } from 'node:fs/promises';

const KABEL = new URL('../../node_modules/@kabelsalat/web/dist/index.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@kabelsalat/web') return next(KABEL, context);
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.strudel')) {
    const src = await readFile(new URL(url), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(src)};`, shortCircuit: true };
  }
  return next(url, context);
}

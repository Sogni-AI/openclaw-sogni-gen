// ESM loader hook: intercepts '@sogni-ai/sogni-client-wrapper' and redirects
// to the local test stub. Used via module.register() in test/register.mjs.
// Note: resolve() uses 2-arg nextResolve(specifier, context) for Node v24+.
const STUB_URL = new URL('./sogni-client-stub.mjs', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@sogni-ai/sogni-client-wrapper') {
    return {
      url: STUB_URL.href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}

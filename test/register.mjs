import { register } from 'node:module';

// Register the ESM loader hook using the modern module.register() API
const loaderURL = new URL('./loader.mjs', import.meta.url);
register(loaderURL.href);

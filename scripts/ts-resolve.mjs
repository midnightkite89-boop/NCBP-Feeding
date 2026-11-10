// Lets plain `node` run the TypeScript sources, whose imports leave off the .ts extension.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/test-stops.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});

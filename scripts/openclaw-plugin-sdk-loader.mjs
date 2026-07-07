import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginSdkRoot = "/Applications/AutoClaw.app/Contents/Resources/gateway/openclaw/dist/plugin-sdk";
const prefix = "openclaw/plugin-sdk";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
    const subpath = specifier === prefix ? "index" : specifier.slice(prefix.length + 1);
    return {
      url: pathToFileURL(path.join(pluginSdkRoot, `${subpath}.js`)).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

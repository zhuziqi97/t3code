// Eval-only helper: it reads the local Codex config through python3 at startup.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";

// Read credentials into memory only. Python's TOML parser avoids another runner dependency.
const decodeProxyConfig = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, headers: Schema.Record(Schema.String, Schema.String) }),
);
/** Reads the configured proxy, retaining the legacy vibeproxy default. */
export const proxyConfig = (configDirectory?: string) =>
  decodeProxyConfig(
    JSON.parse(
      NodeChildProcess.execFileSync(
        "python3",
        [
          "-c",
          `
import json, os, pathlib, sys, tomllib
home = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / '.codex'
config = tomllib.loads((home / 'config.toml').read_text())
providers = config['model_providers']
provider = config.get('model_provider') or ('vibeproxy' if 'vibeproxy' in providers else next(iter(providers)) if len(providers) == 1 else None)
if provider is None: raise ValueError('Select model_provider in the Codex config before running evals with multiple providers.')
p = providers[provider]
h = p.get('http_headers', {}).copy()
h.update({k: os.environ[v] for k,v in p.get('env_http_headers', {}).items()})
key = os.environ[p['env_key']] if p.get('env_key') else p.get('experimental_bearer_token')
if not key and p.get('requires_openai_auth'): key = json.loads((home / 'auth.json').read_text()).get('OPENAI_API_KEY')
if key: h['Authorization'] = 'Bearer ' + key
print(json.dumps({'url': p['base_url'].rstrip('/'), 'headers': h}))
`,
          ...(configDirectory === undefined ? [] : [configDirectory]),
        ],
        { encoding: "utf8" },
      ),
    ),
  );

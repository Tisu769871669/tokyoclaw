const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 10000;

function cleanText(value) {
  return String(value || '').trim();
}

function parseTenantCredentials(env = process.env) {
  const raw = cleanText(env.FRIEND_WELCOME_TENANT_CREDENTIALS);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveOrderingCredentials(candidate = {}, env = process.env) {
  const directKey = cleanText(env.XCDHT_MCP_KEY);
  const directSecret = cleanText(env.XCDHT_MCP_SECRET);
  if (directKey && directSecret) {
    return {
      key: directKey,
      secret: directSecret,
      source: 'xcdht_env'
    };
  }

  const tenantId = cleanText(
    candidate.tenantId ||
    env.WXID_BINDING_DEFAULT_TENANT_ID ||
    env.ORDERING_LOOKUP_TENANT_ID ||
    '125'
  );
  const tenantCredentials = parseTenantCredentials(env);
  const scopedCredentials = tenantCredentials[tenantId] || {};
  const tenantKey = cleanText(scopedCredentials.mcpKey || scopedCredentials.mcp_key);
  const tenantSecret = cleanText(scopedCredentials.mcpSecret || scopedCredentials.mcp_secret);
  if (tenantKey && tenantSecret) {
    return {
      key: tenantKey,
      secret: tenantSecret,
      source: 'tenant_credentials'
    };
  }

  const globalKey = cleanText(env.FRIEND_WELCOME_MCP_KEY);
  const globalSecret = cleanText(env.FRIEND_WELCOME_MCP_SECRET);
  if (globalKey && globalSecret) {
    return {
      key: globalKey,
      secret: globalSecret,
      source: 'friend_welcome_global'
    };
  }

  return {
    key: '',
    secret: '',
    source: 'missing'
  };
}

function resolveLookupScript(env = process.env) {
  const explicit = cleanText(env.ORDERING_LOOKUP_SCRIPT || env.XCDHT_LOOKUP_SCRIPT);
  if (explicit) return explicit;

  return path.resolve(
    __dirname,
    '..',
    '..',
    'openclaw-skills',
    'snowchuang',
    'xuechuang-ordering',
    'scripts',
    'xcdht_api.py'
  );
}

function buildOrderingLookupEnv(candidate = {}, env = process.env) {
  const credentials = resolveOrderingCredentials(candidate, env);
  return {
    ...env,
    XCDHT_MCP_KEY: credentials.key,
    XCDHT_MCP_SECRET: credentials.secret
  };
}

function buildOrderingLookupRequest(orderUserId, candidate = {}, env = process.env) {
  const command = cleanText(env.ORDERING_LOOKUP_PYTHON || env.PYTHON_BIN) || 'python3';
  const args = [
    resolveLookupScript(env),
    'user',
    '--user-id',
    cleanText(orderUserId)
  ];
  const maxPages = cleanText(env.ORDERING_LOOKUP_MAX_PAGES);
  if (maxPages) {
    args.push('--max-pages', maxPages);
  }

  return {
    command,
    args,
    env: buildOrderingLookupEnv(candidate, env),
    timeoutMs: Number(env.ORDERING_LOOKUP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function runCommand(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeoutMs = Math.max(Number(request.timeoutMs) || DEFAULT_TIMEOUT_MS, 1);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`ordering user lookup timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(cleanText(stderr) || `ordering user lookup exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function lookupOrderingUserById(orderUserId, candidate = {}, options = {}) {
  const env = options.env || process.env;
  const credentials = resolveOrderingCredentials(candidate, env);
  if (!credentials.key || !credentials.secret) {
    throw new Error('ordering lookup credentials are not configured');
  }

  const request = buildOrderingLookupRequest(orderUserId, candidate, env);
  const runner = typeof options.runCommand === 'function' ? options.runCommand : runCommand;
  const result = await runner(request);
  const text = cleanText(result.stdout);
  if (!text) return null;
  return JSON.parse(text);
}

module.exports = {
  buildOrderingLookupEnv,
  buildOrderingLookupRequest,
  lookupOrderingUserById,
  resolveLookupScript,
  resolveOrderingCredentials,
  runCommand
};

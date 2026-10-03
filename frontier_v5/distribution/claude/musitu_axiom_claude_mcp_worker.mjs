const VERSION = "1.0.0";
const DEFAULTS = {
  axiomBase: "https://axiom.mftintelligence.com",
  publicBase: "https://connect.mftintelligence.com",
  authIssuer: "https://auth-connect.mftintelligence.com",
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const SAFE_TOOLS = [
  ["investment_npv", "Investment NPV", "finance.npv", "Compute net present value from a discount rate and cash-flow series."],
  ["compound_growth", "Compound Growth", "finance.compound", "Compute compounded growth using supplied Axiom inputs."],
  ["option_black_scholes", "Black-Scholes Option Value", "finance.black_scholes", "Compute a Black-Scholes option value from supplied model inputs."],
  ["option_greeks", "Option Greeks", "finance.greeks", "Compute option sensitivity measures from supplied model inputs."],
  ["implied_volatility", "Implied Volatility", "finance.implied_vol", "Estimate implied volatility from supplied option inputs."],
  ["historical_var", "Historical VaR", "finance.var_historical", "Estimate historical value at risk from a supplied return series."],
  ["parametric_var", "Parametric VaR", "finance.var_parametric", "Estimate parametric value at risk from returns and confidence alpha."],
  ["historical_cvar", "Historical CVaR", "finance.cvar_historical", "Estimate historical conditional value at risk from supplied returns."],
  ["portfolio_metrics", "Portfolio Metrics", "finance.portfolio_metrics", "Compute portfolio metrics from supplied portfolio inputs."],
  ["returns_analysis", "Returns Analysis", "finance.returns", "Analyze a supplied return series."],
  ["market_beta", "Market Beta", "finance.beta", "Estimate beta from supplied asset and market return inputs."],
  ["drawdown_analysis", "Drawdown Analysis", "finance.drawdown", "Measure drawdown characteristics from a supplied series."],
  ["monte_carlo_scenario", "Monte Carlo Scenario", "finance.monte_carlo_gbm", "Run a geometric-Brownian-motion scenario simulation from supplied assumptions."],
  ["bond_price", "Bond Price", "finance.bond_price", "Compute a bond price from supplied bond and yield inputs."],
  ["bond_yield", "Bond Yield", "finance.bond_yield", "Estimate bond yield from supplied bond pricing inputs."],
  ["bond_duration", "Bond Duration", "finance.duration", "Compute bond duration from supplied bond inputs."],
  ["rolling_volatility", "Rolling Volatility", "timeseries.rolling_volatility", "Compute rolling volatility for a supplied time series."],
  ["moving_average", "Moving Average", "timeseries.moving_average", "Compute a moving average over a supplied time series."],
  ["ewma_forecast", "EWMA Forecast", "timeseries.ewma", "Compute an exponentially weighted moving estimate from supplied observations."],
  ["regression_analysis", "Regression Analysis", "statistics.regression", "Fit a linear regression to supplied x and y observations."],
  ["correlation_analysis", "Correlation Analysis", "statistics.correlation", "Compute correlation from supplied paired observations."],
  ["covariance_analysis", "Covariance Analysis", "statistics.covariance", "Compute covariance from supplied paired observations."],
  ["descriptive_statistics", "Descriptive Statistics", "statistics.describe", "Compute descriptive statistics for supplied observations."],
  ["quantile_analysis", "Quantile Analysis", "statistics.quantile", "Compute requested quantiles for supplied observations."],
  ["zscore_analysis", "Z-Score Analysis", "statistics.zscore", "Compute z-scores for supplied observations."],
  ["linear_optimization", "Linear Optimization", "optimization.linear_program", "Solve a supplied linear optimization problem."],
  ["quadratic_optimization", "Quadratic Optimization", "optimization.quadratic", "Solve a supplied quadratic optimization problem."],
  ["least_squares", "Least Squares", "numeric.least_squares", "Solve a supplied least-squares problem."],
  ["interpolate_series", "Interpolate Series", "numeric.interpolate", "Interpolate values from supplied numeric series inputs."],
  ["verify_calculation", "Verify Calculation", "verify.crosscheck", "Cross-check a supplied quantitative calculation with the Axiom verification primitive."],
];

const TOOL_BY_NAME = new Map(
  SAFE_TOOLS.map(([name, title, operation, description]) => [
    name,
    { name, title, operation, description },
  ]),
);
const EXPECTED_OPERATIONS = new Set(SAFE_TOOLS.map((row) => row[2]));

function cfg(env) {
  return {
    axiomBase: env.AXIOM_BASE || DEFAULTS.axiomBase,
    publicBase: env.MCP_PUBLIC_BASE || DEFAULTS.publicBase,
    authIssuer: env.AUTH_ISSUER || DEFAULTS.authIssuer,
    supportContact: String(env.SUPPORT_CONTACT || "").trim(),
    axiomService: env.AXIOM_SERVICE || null,
  };
}

function response(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function rpc(id, result) {
  return response(200, { jsonrpc: "2.0", id, result });
}

function toolResult(text, structuredContent = {}, isError = false, meta) {
  const result = {
    content: [{ type: "text", text }],
    structuredContent,
  };
  if (isError) result.isError = true;
  if (meta) result._meta = meta;
  return result;
}

async function jsonFetch(service, url, init = {}) {
  try {
    const res = service?.fetch ? await service.fetch(url, init) : await fetch(url, init);
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text || "{}");
    } catch {}
    return { status: res.status, body, text };
  } catch (error) {
    return { status: 0, body: {}, text: String(error) };
  }
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

function htmlPage(title, body) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f6f7f8;color:#111}.c{max-width:820px;margin:5vh auto;background:white;border:1px solid #ddd;border-radius:18px;padding:32px;line-height:1.55}h1{margin-top:0}code{background:#f0f1f2;padding:.1rem .3rem;border-radius:5px}a{color:#1648a8}</style></head><body><main class="c"><h1>${esc(title)}</h1>${body}</main></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

function supportLink(c) {
  if (!c.supportContact) return "";
  if (/^https:\/\//i.test(c.supportContact)) {
    return `<a href="${esc(c.supportContact)}">${esc(c.supportContact)}</a>`;
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.supportContact)) {
    return `<a href="mailto:${esc(c.supportContact)}">${esc(c.supportContact)}</a>`;
  }
  return esc(c.supportContact);
}

function docsPage(c) {
  return htmlPage(
    "MUSITU Axiom Documentation",
    `<p>MUSITU Axiom provides a curated remote MCP surface for quantitative finance, risk, forecasting, time-series analysis, statistics, optimization and calculation verification.</p>
    <h2>Connect</h2>
    <p>MCP endpoint: <code>${esc(c.publicBase + "/mcp")}</code></p>
    <p>Authentication uses OAuth dynamic client registration with PKCE S256. The only requested execution scope is <code>axiom.execute</code>.</p>
    <h2>Capability boundary</h2>
    <p>This profile is analysis-only. It does not execute financial transactions, place trades or orders, move assets, or expose subscription checkout.</p>
    <h2>Example inputs</h2>
    <ul>
      <li><strong>Investment NPV:</strong> <code>{"args":{"rate":0.12,"cashflows":[-1000000,300000,350000,400000,450000]}}</code></li>
      <li><strong>Parametric VaR:</strong> use <code>alpha</code> for confidence probability, for example <code>0.95</code>.</li>
      <li><strong>Regression:</strong> provide equally sized numeric arrays <code>x</code> and <code>y</code>.</li>
    </ul>
    <h2>Troubleshooting</h2>
    <ul>
      <li>Authentication errors: reconnect the MUSITU Axiom account.</li>
      <li>A 503 health response means the facade has failed closed because the approved upstream operation registry cannot be verified.</li>
      <li>Calculation errors should be checked against the tool's declared input schema.</li>
    </ul>
    <h2>Policies and help</h2>
    <p><a href="${esc(c.publicBase + "/privacy")}">Privacy policy</a> · <a href="${esc(c.publicBase + "/terms")}">Terms of use</a> · <a href="${esc(c.publicBase + "/support")}">Support</a></p>`,
  );
}

function privacyPage(c) {
  return htmlPage(
    "MUSITU Axiom Privacy Policy",
    `<p>This policy describes data handled by the MUSITU Axiom provider-neutral remote MCP connection and account-linking service.</p>
    <h2>Data processed</h2>
    <ul>
      <li><strong>Account and entitlement data:</strong> the existing MUSITU customer record associated with the account you connect.</li>
      <li><strong>OAuth security data:</strong> registered client identifiers, requested scope, authorization-flow and code metadata, hashed access and refresh tokens, expiry and revocation state.</li>
      <li><strong>Usage and audit data:</strong> requested Axiom operation, compute usage, status, timing, internal request identifier, and cryptographic request/result evidence where produced by the underlying service.</li>
      <li><strong>Calculation inputs:</strong> only the operation arguments sent to the selected analytical tool. The connector does not independently request an entire assistant conversation history.</li>
    </ul>
    <h2>Why it is processed</h2>
    <p>To authenticate the connected MUSITU account, execute requested analytical operations, enforce entitlements and quotas, meter usage, prevent abuse, troubleshoot failures, and preserve security/audit integrity.</p>
    <h2>Service providers</h2>
    <p>Data may be processed by MUSITU and infrastructure providers used to operate the service, including Cloudflare and private compute-hosting infrastructure. MUSITU does not sell connector user data to advertisers. This analysis-only profile does not collect card data or initiate subscription checkout.</p>
    <h2>Retention</h2>
    <p>Authorization flows expire after approximately 10 minutes, authorization codes after approximately 5 minutes, access tokens after approximately 1 hour, and refresh tokens after approximately 30 days. Security, entitlement, metering and audit records may be retained longer where reasonably necessary for account operation, security, fraud prevention, accounting, dispute resolution or legal obligations.</p>
    <h2>Your controls</h2>
    <p>OAuth access can be revoked independently of the original MUSITU account credential. Requests concerning access, correction or deletion of account-linked personal data can be made through <a href="${esc(c.publicBase + "/support")}">Support</a>, subject to applicable retention obligations.</p>`,
  );
}

function termsPage(c) {
  return htmlPage(
    "MUSITU Axiom Terms of Use",
    `<p>MUSITU Axiom provides quantitative calculation and analytical tools. Outputs are informational, may contain errors, and are not a guarantee of investment performance, financial advice, or an instruction to transact.</p>
    <h2>Existing account access</h2>
    <p>The remote MCP service connects an existing MUSITU Axiom account through OAuth and may use that account's existing entitlement when an analytical capability is invoked.</p>
    <h2>Analysis-only boundary</h2>
    <p>This profile does not execute financial transactions, transfer money or other financial assets, place investment trades or orders, or complete subscription purchases.</p>
    <h2>Acceptable use</h2>
    <p>Do not use the service for unlawful activity, fraud, market manipulation, credential sharing, or attempts to bypass authentication, quotas, security controls or provider policies.</p>
    <h2>Verification</h2>
    <p>Independently verify material financial and operational decisions before acting on analytical output.</p>
    <h2>Contact</h2>
    <p>Use <a href="${esc(c.publicBase + "/support")}">Support</a> for account, privacy or service questions.</p>`,
  );
}

function supportPage(c) {
  if (!c.supportContact) {
    return response(503, {
      error: "support_contact_not_configured",
      message: "A verified support contact must be configured before public distribution.",
    });
  }
  return htmlPage(
    "MUSITU Axiom Support",
    `<p>For account-linking, connector, privacy, security or service questions, contact: ${supportLink(c)}</p>
    <p>When reporting a calculation issue, include the operation name and non-secret request identifier when available. Never send account keys, OAuth codes, access tokens, refresh tokens or other credentials in a support request.</p>`,
  );
}

function authorizationHeader(req) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") && value.length > 12 ? value : "";
}

function oauthScheme() {
  return [{ type: "oauth2", scopes: ["axiom.execute"] }];
}

function genericArgsSchema() {
  return {
    type: "object",
    properties: {
      args: {
        type: "object",
        description: "Inputs for this MUSITU Axiom analytical operation.",
        additionalProperties: true,
      },
    },
    required: ["args"],
    additionalProperties: false,
  };
}

function npvArgsSchema() {
  return {
    type: "object",
    properties: {
      args: {
        type: "object",
        properties: {
          rate: { type: "number", description: "Discount rate as a decimal, for example 0.12 for 12%." },
          cashflows: {
            type: "array",
            minItems: 1,
            items: { type: "number" },
            description: "Ordered cash flows beginning with the initial period when applicable.",
          },
        },
        required: ["rate", "cashflows"],
        additionalProperties: false,
      },
    },
    required: ["args"],
    additionalProperties: false,
  };
}

function parametricVarArgsSchema() {
  return {
    type: "object",
    properties: {
      args: {
        type: "object",
        properties: {
          returns: {
            type: "array",
            minItems: 2,
            items: { type: "number" },
            description: "Observed returns as decimals.",
          },
          alpha: {
            type: "number",
            exclusiveMinimum: 0,
            exclusiveMaximum: 1,
            description: "Confidence probability, for example 0.95.",
          },
        },
        required: ["returns", "alpha"],
        additionalProperties: false,
      },
    },
    required: ["args"],
    additionalProperties: false,
  };
}

function regressionArgsSchema() {
  return {
    type: "object",
    properties: {
      args: {
        type: "object",
        properties: {
          x: {
            type: "array",
            minItems: 2,
            items: { type: "number" },
            description: "Independent-variable observations.",
          },
          y: {
            type: "array",
            minItems: 2,
            items: { type: "number" },
            description: "Dependent-variable observations with the same length as x.",
          },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    required: ["args"],
    additionalProperties: false,
  };
}

function schemaFor(name) {
  if (name === "investment_npv") return npvArgsSchema();
  if (name === "parametric_var") return parametricVarArgsSchema();
  if (name === "regression_analysis") return regressionArgsSchema();
  return genericArgsSchema();
}

export function claudeToolDefinitions() {
  return SAFE_TOOLS.map(([name, title, operation, description]) => ({
    name,
    title,
    description,
    inputSchema: schemaFor(name),
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: name !== "monte_carlo_scenario",
    },
    securitySchemes: oauthScheme(),
    _meta: {
      "musitu/operation": operation,
      "musitu/profile": "claude-analysis-only",
    },
  }));
}

export function resolveTool(name) {
  return TOOL_BY_NAME.get(String(name || "")) || null;
}

export function missingOperations(registryOperations) {
  const available = new Set(registryOperations || []);
  return [...EXPECTED_OPERATIONS].filter((operation) => !available.has(operation));
}

function normalizeRegistry(body) {
  const raw = Array.isArray(body?.tools) ? body.tools : [];
  return raw
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : String(entry?.operation || entry?.name || entry?.id || ""),
    )
    .filter(Boolean);
}

async function registry(c) {
  const result = await jsonFetch(c.axiomService, c.axiomBase + "/v1/tools", {
    headers: {
      accept: "application/json",
      "user-agent": "MUSITU-Axiom-Claude-MCP/1.0",
    },
  });
  if (result.status !== 200) {
    throw new Error("Axiom registry unavailable");
  }
  const operations = normalizeRegistry(result.body);
  const missing = missingOperations(operations);
  if (missing.length) {
    throw new Error("Claude profile registry coverage incomplete");
  }
  return operations;
}

function authRequired(c) {
  return toolResult(
    "Connect your MUSITU Axiom account to use this analytical capability.",
    { authenticated: false },
    true,
    {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${c.publicBase}/.well-known/oauth-protected-resource", scope="axiom.execute", error="insufficient_scope"`,
      ],
    },
  );
}

async function execute(req, c, tool, args) {
  const auth = authorizationHeader(req);
  if (!auth) return authRequired(c);

  const requestId =
    req.headers.get("x-musitu-request-id") ||
    "MUSITU-CLAUDE-" + crypto.randomUUID().replaceAll("-", "").toUpperCase();

  const upstream = await jsonFetch(c.axiomService, c.axiomBase + "/v1/compute", {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
      accept: "application/json",
      "x-musitu-request-id": requestId,
      "user-agent": "MUSITU-Axiom-Claude-MCP/1.0",
    },
    body: JSON.stringify({
      operation: tool.operation,
      args: args || {},
    }),
  });

  if (upstream.status === 401 || upstream.status === 403) return authRequired(c);
  if (upstream.status < 200 || upstream.status >= 300) {
    return toolResult(
      "MUSITU Axiom could not complete the analytical operation.",
      {
        operation: tool.operation,
        request_id: requestId,
        http_status: upstream.status,
      },
      true,
    );
  }

  return toolResult(
    `Completed ${tool.title}.`,
    {
      operation: tool.operation,
      request_id: requestId,
      result: upstream.body,
    },
  );
}

async function callTool(req, c, name, supplied) {
  const tool = resolveTool(name);
  if (!tool) {
    return toolResult(
      "This capability is not available in the Claude analysis-only profile.",
      { tool: String(name || "") },
      true,
    );
  }
  await registry(c);
  const args = supplied?.args && typeof supplied.args === "object" ? supplied.args : {};
  return execute(req, c, tool, args);
}

async function mcp(req, c) {
  if (req.method !== "POST") {
    return response(405, { error: "method_not_allowed" }, { allow: "POST" });
  }

  let message;
  try {
    message = await req.json();
  } catch {
    return rpc(null, { error: { code: -32700, message: "Parse error" } });
  }

  const id = message?.id ?? null;
  if (message?.jsonrpc !== "2.0" || typeof message?.method !== "string") {
    return rpc(id, { error: { code: -32600, message: "Invalid Request" } });
  }

  if (message.method === "initialize") {
    return rpc(id, {
      protocolVersion: String(message.params?.protocolVersion || "2025-06-18"),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "musitu-axiom-claude", version: VERSION },
      instructions:
        "MUSITU Axiom Claude profile provides quantitative analysis, risk, forecasting, statistics, optimization and verification only. It does not perform financial transactions.",
    });
  }

  if (
    message.method === "notifications/initialized" ||
    message.method === "notifications/cancelled"
  ) {
    return new Response(null, { status: 202 });
  }

  if (message.method === "ping") return rpc(id, {});

  if (message.method === "tools/list") {
    try {
      await registry(c);
      return rpc(id, { tools: claudeToolDefinitions() });
    } catch {
      return rpc(id, {
        error: {
          code: -32603,
          message: "Axiom registry unavailable or Claude profile incomplete",
        },
      });
    }
  }

  if (message.method === "tools/call") {
    const name = String(message.params?.name || "");
    const supplied =
      message.params?.arguments && typeof message.params.arguments === "object"
        ? message.params.arguments
        : {};
    if (!name) {
      return rpc(id, {
        error: { code: -32602, message: "Tool name required" },
      });
    }
    try {
      return rpc(id, await callTool(req, c, name, supplied));
    } catch {
      return rpc(
        id,
        toolResult(
          "MUSITU Axiom failed closed because the approved Claude capability set could not be verified.",
          {},
          true,
        ),
      );
    }
  }

  return rpc(id, { error: { code: -32601, message: "Method not found" } });
}

async function health(c) {
  const upstream = await jsonFetch(c.axiomService, c.axiomBase + "/health", {
    headers: {
      accept: "application/json",
      "user-agent": "MUSITU-Axiom-Claude-MCP/1.0",
    },
  });
  let missing = SAFE_TOOLS.map((x) => x[2]);
  try {
    const operations = await registry(c);
    missing = missingOperations(operations);
  } catch {}
  const ok = upstream.status === 200 && missing.length === 0;
  return {
    ok,
    service: "MUSITU Axiom Claude MCP",
    version: VERSION,
    profile: "analysis_only",
    tool_count: SAFE_TOOLS.length,
    missing_operations: missing,
    oauth_scope: "axiom.execute",
  };
}

export default {
  async fetch(req, env) {
    const c = cfg(env);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers":
            "authorization,content-type,mcp-session-id,x-musitu-request-id",
        },
      });
    }

    if (url.pathname === "/" && req.method === "GET") {
      return response(200, {
        service: "MUSITU Axiom Claude MCP",
        endpoint: c.publicBase + "/mcp",
        health: c.publicBase + "/health",
        profile: "analysis_only",
      });
    }

    if (
      url.pathname === "/.well-known/oauth-protected-resource" &&
      req.method === "GET"
    ) {
      return response(200, {
        resource: c.publicBase,
        authorization_servers: [c.authIssuer],
        scopes_supported: ["axiom.execute"],
        resource_documentation: c.publicBase + "/docs",
      });
    }

    if (url.pathname === "/docs" && req.method === "GET") return docsPage(c);
    if (url.pathname === "/privacy" && req.method === "GET") return privacyPage(c);
    if (url.pathname === "/terms" && req.method === "GET") return termsPage(c);
    if (url.pathname === "/support" && req.method === "GET") return supportPage(c);

    if (url.pathname === "/health" && req.method === "GET") {
      const result = await health(c);
      return response(result.ok ? 200 : 503, result);
    }

    if (url.pathname === "/mcp") return mcp(req, c);
    return response(404, { error: "not_found" });
  },
};

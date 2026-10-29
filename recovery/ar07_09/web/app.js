"use strict";

const state = {
  csrf: "",
  projectId: "",
  manifest: null,
  workspace: null,
  selectedTaskId: "",
};

const byId = (id) => document.getElementById(id);
const authDialog = byId("auth-dialog");
const commandDialog = byId("command-panel");
const statusToast = byId("global-status");

function setStatus(message, kind = "info") {
  statusToast.textContent = message || "";
  statusToast.dataset.kind = kind;
  if (message) window.setTimeout(() => {
    if (statusToast.textContent === message) statusToast.textContent = "";
  }, 5000);
}

function makeRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    if (state.csrf) headers["X-Axiom-CSRF"] = state.csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) { payload = {}; }
  if (!response.ok) {
    const message = payload.message || payload.error || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatTimestamp(value) {
  if (!Number.isFinite(Number(value))) return "Unknown time";
  return new Date(Number(value)).toLocaleString();
}

function enableWorkspace() {
  byId("expression").disabled = false;
  byId("run-button").disabled = false;
  byId("refresh-button").disabled = false;
  byId("memory-title").disabled = false;
  byId("memory-content").disabled = false;
  byId("memory-save").disabled = false;
  byId("logout-button").hidden = false;
  byId("project-object").textContent = state.projectId;
}

function disableWorkspace() {
  state.csrf = "";
  state.projectId = "";
  state.workspace = null;
  state.selectedTaskId = "";
  byId("expression").disabled = true;
  byId("run-button").disabled = true;
  byId("refresh-button").disabled = true;
  byId("memory-title").disabled = true;
  byId("memory-content").disabled = true;
  byId("memory-save").disabled = true;
  byId("logout-button").hidden = true;
  byId("project-object").textContent = "Not connected";
  byId("work-object").textContent = "0 tasks";
  byId("artifact-object").textContent = "0 outputs";
  byId("evidence-object").textContent = "Awaiting session";
  renderWorkspace({tasks: [], artifacts: [], memory: [], approval_cards: [], limitations: state.manifest ? state.manifest.limitations : []});
}

function renderManifest(manifest) {
  state.manifest = manifest;
  const summary = byId("manifest-summary");
  summary.replaceChildren();
  const facts = [
    ["Production authority", manifest.production_authority ? "Yes" : "No"],
    ["Provider execution", manifest.provider_execution ? "Yes" : "No"],
    ["Formal gate", manifest.phase_gate || "Unknown"],
    ["Connected surfaces", String(Object.values(manifest.surfaces || {}).filter((item) => item.state === "CONNECTED").length)],
  ];
  for (const [label, value] of facts) {
    const row = document.createElement("div");
    row.append(textNode("dt", label), textNode("dd", value));
    summary.append(row);
  }
  renderLimitations(manifest.limitations || []);
}

function renderLimitations(items) {
  const list = byId("limitations-list");
  list.replaceChildren();
  for (const item of items) list.append(textNode("li", item));
  if (!items.length) list.append(textNode("li", "No limitation data returned."));
}

function renderTasks(tasks) {
  const list = byId("task-list");
  list.replaceChildren();
  byId("tasks-empty").hidden = tasks.length > 0;
  for (const task of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-row";
    button.dataset.taskId = task.task_id;
    button.setAttribute("aria-label", `Inspect task ${task.task_id}, state ${task.state}`);
    button.append(
      textNode("span", task.task_id, "task-id"),
      textNode("span", task.state, "state-pill"),
      textNode("span", `Budget ${task.budget_used}/${task.budget_max} · ${formatTimestamp(task.updated_at_ms)}`, "task-meta")
    );
    button.querySelector(".state-pill").dataset.state = task.state;
    button.addEventListener("click", () => loadTask(task.task_id));
    list.append(button);
  }
}

function renderRecords(containerId, items, type) {
  const list = byId(containerId);
  list.replaceChildren();
  if (!items.length) {
    list.append(textNode("p", type === "artifact" ? "No artifacts loaded." : "No project memory loaded.", "muted"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "record";
    if (type === "artifact") {
      const body = item.body || {};
      card.append(
        textNode("strong", body.kind || "Artifact"),
        textNode("p", `${body.expression || "Expression unavailable"} → ${body.result ?? "No result"}`),
        textNode("p", `Provenance: ${(item.provenance || {}).source || "Unavailable"}`)
      );
    } else {
      const body = item.body || {};
      card.append(textNode("strong", body.title || "Untitled memory"), textNode("p", body.content || ""));
    }
    list.append(card);
  }
}

function renderApprovals(items) {
  const host = byId("approval-list");
  host.replaceChildren();
  if (!items.length) {
    host.append(textNode("p", "No approval cards loaded.", "muted"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "record";
    card.append(
      textNode("strong", `${item.risk_class} · ${item.operation}`),
      textNode("p", `Task ${item.task_id}`)
    );
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "secondary-button";
    approve.textContent = "Approve eligible step";
    approve.addEventListener("click", () => approveStep(item.task_id, item.step_id));
    card.append(approve);
    host.append(card);
  }
}

function renderWorkspace(workspace) {
  state.workspace = workspace;
  const tasks = workspace.tasks || [];
  const artifacts = workspace.artifacts || [];
  const memory = workspace.memory || [];
  byId("work-object").textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  byId("artifact-object").textContent = `${artifacts.length} output${artifacts.length === 1 ? "" : "s"}`;
  byId("evidence-object").textContent = state.projectId ? "Durable records connected" : "Awaiting session";
  renderTasks(tasks);
  renderRecords("artifact-list", artifacts, "artifact");
  renderRecords("memory-list", memory, "memory");
  renderApprovals(workspace.approval_cards || []);
  renderLimitations(workspace.limitations || (state.manifest ? state.manifest.limitations : []));
}

async function refreshWorkspace() {
  if (!state.projectId) return;
  try {
    const workspace = await api(`/api/workspace?project_id=${encodeURIComponent(state.projectId)}`);
    renderWorkspace(workspace);
  } catch (error) {
    if (error.status === 401) {
      disableWorkspace();
      if (!authDialog.open) authDialog.showModal();
    }
    setStatus(error.message, "error");
  }
}

function renderTaskDetail(detail) {
  const host = byId("task-detail");
  host.replaceChildren();
  const task = detail.task || {};
  const integrity = detail.integrity || {};
  host.append(
    textNode("p", `${task.state || "UNKNOWN"} · ${task.task_id || "Unknown task"}`, "task-id"),
    textNode("p", `Integrity: ${integrity.status || "UNKNOWN"}`, integrity.status === "PASS" ? "integrity-pass" : "integrity-fail")
  );

  const eventTitle = textNode("h4", `Persisted events (${(detail.timeline || []).length})`);
  const events = document.createElement("ol");
  for (const event of detail.timeline || []) {
    events.append(textNode("li", `${event.sequence}. ${event.type}`));
  }
  host.append(eventTitle, events);

  const receiptTitle = textNode("h4", `Tool receipts (${(detail.tool_activity || []).length})`);
  const receipts = document.createElement("ul");
  for (const receipt of detail.tool_activity || []) {
    receipts.append(textNode("li", `${receipt.operation} · ${receipt.status} · ${receipt.qualification}`));
  }
  host.append(receiptTitle, receipts);

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const retry = textNode("button", "Retry task", "quiet-button");
  retry.type = "button";
  retry.addEventListener("click", () => taskAction(task.task_id, "retry"));
  const cancel = textNode("button", "Request cancel", "quiet-button");
  cancel.type = "button";
  cancel.addEventListener("click", () => taskAction(task.task_id, "cancel"));
  const redirect = textNode("button", "Test blocked redirect", "quiet-button");
  redirect.type = "button";
  redirect.addEventListener("click", () => taskAction(task.task_id, "redirect", {operation: "research.search"}));
  actions.append(retry, cancel, redirect);
  host.append(actions);
}

async function loadTask(taskId) {
  if (!state.projectId || !taskId) return;
  try {
    state.selectedTaskId = taskId;
    const detail = await api(`/api/tasks/${encodeURIComponent(taskId)}?project_id=${encodeURIComponent(state.projectId)}`);
    renderTaskDetail(detail);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function taskAction(taskId, action, body = {}) {
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {method: "POST", body});
    if (action === "redirect" && result.state === "BLOCKED") {
      setStatus(`Redirect blocked: ${result.reason_code}.`, "info");
    } else {
      setStatus(`${action === "cancel" ? "Cancel requested" : "Task action completed"}.`, "info");
    }
    await refreshWorkspace();
    await loadTask(taskId);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function approveStep(taskId, stepId) {
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/approve`, {method: "POST", body: {step_id: stepId}});
    setStatus("Approval signed in the candidate kernel.", "info");
    await refreshWorkspace();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function openAuth() {
  byId("auth-status").textContent = "";
  if (!authDialog.open) authDialog.showModal();
}

function selectAuthMode(mode) {
  const create = mode === "create";
  byId("tab-create").classList.toggle("is-active", create);
  byId("tab-login").classList.toggle("is-active", !create);
  byId("tab-create").setAttribute("aria-selected", String(create));
  byId("tab-login").setAttribute("aria-selected", String(!create));
  byId("create-panel").hidden = !create;
  byId("login-panel").hidden = create;
  (create ? byId("create-email") : byId("login-email")).focus();
}

authDialog.addEventListener("cancel", (event) => {
  if (!state.projectId) event.preventDefault();
});

byId("tab-create").addEventListener("click", () => selectAuthMode("create"));
byId("tab-login").addEventListener("click", () => selectAuthMode("login"));

for (const tab of [byId("tab-create"), byId("tab-login")]) {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" || event.key === "ArrowLeft" ? "create" : "login";
    selectAuthMode(target);
    byId(target === "create" ? "tab-create" : "tab-login").focus();
  });
}

byId("create-panel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = byId("auth-status");
  status.textContent = "Creating local identity…";
  try {
    const result = await api("/api/onboard", {
      method: "POST",
      body: {
        email: byId("create-email").value,
        password: byId("create-password").value,
        organization_name: byId("create-org").value,
      },
    });
    state.csrf = result.csrf_token;
    state.projectId = result.project_id;
    enableWorkspace();
    authDialog.close();
    setStatus(`Local project connected: ${state.projectId}. Keep this project ID for future sign-in.`, "info");
    await refreshWorkspace();
    byId("expression").focus();
  } catch (error) {
    status.textContent = error.message;
  }
});

byId("login-panel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = byId("auth-status");
  status.textContent = "Signing in…";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: {email: byId("login-email").value, password: byId("login-password").value},
    });
    state.csrf = result.csrf_token;
    state.projectId = byId("login-project").value.trim();
    enableWorkspace();
    await refreshWorkspace();
    authDialog.close();
    byId("expression").focus();
  } catch (error) {
    status.textContent = error.message;
  }
});

byId("composer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const expression = byId("expression").value.trim();
  if (!expression || !state.projectId) return;
  byId("run-button").disabled = true;
  try {
    const result = await api("/api/tasks", {
      method: "POST",
      body: {project_id: state.projectId, expression, request_id: makeRequestId()},
    });
    byId("expression").value = "";
    setStatus(`Work ${result.state.toLowerCase()}; durable evidence recorded.`, "info");
    await refreshWorkspace();
    await loadTask(result.task_id);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    byId("run-button").disabled = false;
    byId("expression").focus();
  }
});

byId("memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.projectId) return;
  try {
    await api("/api/memory", {
      method: "POST",
      body: {
        project_id: state.projectId,
        title: byId("memory-title").value.trim(),
        content: byId("memory-content").value.trim(),
      },
    });
    byId("memory-title").value = "";
    byId("memory-content").value = "";
    setStatus("Project memory saved with user-authored provenance.", "info");
    await refreshWorkspace();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

byId("refresh-button").addEventListener("click", refreshWorkspace);
byId("logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", {method: "POST", body: {}});
  } catch (error) {
    setStatus(error.message, "error");
  }
  disableWorkspace();
  openAuth();
});

byId("open-command").addEventListener("click", () => commandDialog.showModal());
byId("close-command").addEventListener("click", () => commandDialog.close());
commandDialog.addEventListener("click", (event) => {
  if (event.target.tagName === "A") commandDialog.close();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!commandDialog.open) commandDialog.showModal();
  }
  if (event.key === "Escape" && commandDialog.open) commandDialog.close();
});

(async function bootstrap() {
  try {
    const manifest = await api("/api/manifest");
    renderManifest(manifest);
  } catch (error) {
    setStatus(`Manifest unavailable: ${error.message}`, "error");
  }
  disableWorkspace();
  openAuth();
})();

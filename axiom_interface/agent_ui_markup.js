import {ACTION_SCOPES,AUTONOMY_LEVELS,DATA_SCOPES,EVENT_TRIGGERS,TOOL_SCOPES} from './agent_security.js';

const options=values=>values.map(value=>`<option value="${value}">${value}</option>`).join('');

export function agentWorkspaceMarkup(){return `<section id="agents-space" class="agents-space" aria-labelledby="agents-title" hidden>
  <div class="section-heading"><div><span class="eyebrow">Governed local workloads</span><h2 id="agents-title">Agents & automations</h2></div><span id="agents-integrity" class="status-pill neutral" role="status" aria-live="polite">Integrity pending</span></div>
  <p class="boundary-note">Phase 9 registers persistent browser-local agents and evaluates bounded schedule, event, and condition triggers. Every grant is explicit, delegation can only reduce authority, automation requires exact configuration approval, and the kill switch cascades. This surface performs local previews only: no cloud scheduler, external action, plaintext secret access, or hidden workload privilege.</p>
  <div class="agent-project-bar"><label>Project<select id="agents-project"><option value="">No project available</option></select></label><span id="agents-status" role="status" aria-live="polite">Choose a project to manage governed agents.</span></div>
  <div class="agent-grid">
    <section class="project-card" aria-labelledby="agent-register-title"><h3 id="agent-register-title">Register agent</h3><form id="agent-create-form">
      <label>Name<input id="agent-name" required maxlength="120"></label>
      <label>Declared purpose<textarea id="agent-purpose" required rows="3" maxlength="1000"></textarea></label>
      <label>Tool scopes<select id="agent-tools" multiple size="6" required>${options(TOOL_SCOPES)}</select><span class="field-help">Select only capabilities this workload needs.</span></label>
      <label>Data scopes<select id="agent-data" multiple size="4" required>${options(DATA_SCOPES)}</select></label>
      <label>Autonomy<select id="agent-autonomy">${options(AUTONOMY_LEVELS)}</select></label>
      <div class="agent-budget"><label>Maximum runs<input id="agent-max-runs" type="number" min="1" max="1000" value="10" required></label><label>Compute units<input id="agent-max-compute" type="number" min="1" max="100000" value="20" required></label></div>
      <button class="button primary" type="submit">Register agent</button>
    </form></section>
    <section class="project-card" aria-labelledby="agent-delegate-title"><h3 id="agent-delegate-title">Delegate narrower authority</h3><form id="agent-delegate-form">
      <label>Parent agent<select id="delegate-parent" required><option value="">No eligible agent</option></select></label>
      <label>Child name<input id="delegate-name" required maxlength="120"></label>
      <label>Child purpose<textarea id="delegate-purpose" required rows="3" maxlength="1000"></textarea></label>
      <label>Child tool scopes<select id="delegate-tools" multiple size="6" required>${options(TOOL_SCOPES)}</select></label>
      <label>Child data scopes<select id="delegate-data" multiple size="4" required>${options(DATA_SCOPES)}</select></label>
      <label>Child autonomy<select id="delegate-autonomy">${options(AUTONOMY_LEVELS)}</select></label>
      <div class="agent-budget"><label>Maximum runs<input id="delegate-max-runs" type="number" min="1" max="1000" value="2" required></label><label>Compute units<input id="delegate-max-compute" type="number" min="1" max="100000" value="2" required></label></div>
      <button class="button secondary" type="submit">Create delegated agent</button>
    </form></section>
    <section class="project-card" aria-labelledby="automation-create-title"><h3 id="automation-create-title">Create automation draft</h3><form id="automation-create-form">
      <label>Agent<select id="automation-agent" required><option value="">No active agent</option></select></label>
      <label>Name<input id="automation-name" required maxlength="120"></label>
      <label>Objective<textarea id="automation-objective" required rows="3" maxlength="1000"></textarea></label>
      <label>Trigger type<select id="automation-trigger-kind"><option value="schedule">Schedule</option><option value="event">Event</option><option value="condition">Condition</option></select></label>
      <label>Trigger value<input id="automation-trigger-value" value="30" required maxlength="180" aria-describedby="automation-trigger-help"></label><span id="automation-trigger-help" class="field-help">Schedule: minutes. Event: ${EVENT_TRIGGERS.join(', ')}. Condition: field|operator|number.</span>
      <label>Action scope<select id="automation-action" required>${options(ACTION_SCOPES)}</select></label>
      <button class="button secondary" type="submit">Create approval-bound draft</button>
    </form></section>
  </div>
  <div class="agent-list-grid">
    <section class="project-card" aria-labelledby="registered-agents-title"><div class="section-heading"><h3 id="registered-agents-title">Registered agents</h3><button id="agents-refresh" class="button secondary" type="button">Refresh</button></div><div id="agent-list" class="agent-list"></div></section>
    <section class="project-card" aria-labelledby="registered-automations-title"><h3 id="registered-automations-title">Automation approvals & previews</h3><div id="automation-list" class="agent-list"></div></section>
  </div>
</section>`;}

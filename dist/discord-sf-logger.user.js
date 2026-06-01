// ==UserScript==
// @name         Discord → Salesforce Logger
// @namespace    https://github.com/liortal-wolf/sf-logger
// @version      0.3.4
// @author       Overwolf
// @description  Log highlighted Discord conversations to Salesforce Opportunities with AI summaries
// @supportURL   https://github.com/liortal-wolf/sf-logger/issues
// @downloadURL  https://raw.githubusercontent.com/liortal-wolf/sf-logger/main/dist/discord-sf-logger.user.js
// @updateURL    https://raw.githubusercontent.com/liortal-wolf/sf-logger/main/dist/discord-sf-logger.user.js
// @match        https://discord.com/*
// @match        https://*.lightning.force.com/*
// @connect      api.anthropic.com
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

(function() {
  'use strict';
	function injectButton(onClick) {
		const ensureButton = () => {
			if (document.getElementById("dsfl-btn")) return;
			const btn = document.createElement("button");
			btn.id = "dsfl-btn";
			btn.textContent = "📋 Log to SF";
			btn.title = "Capture the current selection and log to Salesforce";
			Object.assign(btn.style, {
				position: "fixed",
				bottom: "24px",
				right: "24px",
				zIndex: "2147483646",
				padding: "10px 14px",
				borderRadius: "8px",
				border: "none",
				background: "#5865f2",
				color: "#fff",
				cursor: "pointer",
				fontSize: "13px",
				fontWeight: "600",
				boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
				fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
			});
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				onClick();
			});
			document.body.appendChild(btn);
		};
		if (document.body) ensureButton();
		else document.addEventListener("DOMContentLoaded", ensureButton);
		new MutationObserver(() => ensureButton()).observe(document.documentElement, {
			childList: true,
			subtree: true
		});
	}
	var TYPING_RE = /\[?\s*[\w_]+ is typing\.+\s*\]?/gi;
	var DEFAULT_FALLBACK_MESSAGE_COUNT = 8;
	var MESSAGE_NODE_SELECTOR = "[id^=\"chat-messages-\"], li[id*=\"message\"], [class*=\"messageListItem\"]";
	function extractFromSelectionText(rawText) {
		return rawText.split("\n").map((line) => line.replace(TYPING_RE, "").trim()).filter((line) => line.length > 0).join("\n");
	}
	function detectCounterpartyFromDocumentTitle(title) {
		const match = title.replace(/^\s*\(\d+\)\s*/, "").match(/@([a-zA-Z0-9_.\-]+)/);
		return match ? match[1] : "";
	}
	function detectCounterparty(currentUserId) {
		const username = detectCounterpartyFromDocumentTitle(document.title);
		const userId = pickCounterpartyUserId(currentUserId);
		if (!username && !userId) {
			console.warn("[discord-sf-logger] could not detect counterparty", {
				title: document.title,
				url: window.location.pathname,
				authorIdElementCount: document.querySelectorAll("[data-author-id]").length
			});
			return null;
		}
		return {
			username,
			userId
		};
	}
	function pickCounterpartyUserId(currentUserId) {
		const messages = Array.from(document.querySelectorAll("[data-author-id]"));
		const ids = new Set();
		for (const m of messages) {
			const id = m.getAttribute("data-author-id");
			if (id && id !== currentUserId) ids.add(id);
		}
		if (ids.size === 1) return Array.from(ids)[0];
	}
	function captureDiscordTranscript() {
		const selection = window.getSelection();
		const selectionText = selection?.toString() ?? "";
		if (selection && selection.rangeCount > 0 && selectionText.trim().length > 0) {
			const fromSelection = captureFromSelection(selection);
			if (fromSelection.text.length > 0) return fromSelection;
		}
		return captureLastVisibleMessages(DEFAULT_FALLBACK_MESSAGE_COUNT);
	}
	function captureFromSelection(selection) {
		const range = selection.getRangeAt(0);
		const inRange = Array.from(document.querySelectorAll(MESSAGE_NODE_SELECTOR)).filter((node) => {
			try {
				return range.intersectsNode(node);
			} catch {
				return false;
			}
		});
		if (inRange.length > 0) {
			const lines = inRange.map(formatMessageNode).filter((l) => l.length > 0);
			if (lines.length > 0) return {
				text: lines.join("\n\n"),
				source: "selection",
				messageCount: lines.length
			};
		}
		return {
			text: extractFromSelectionText(selection.toString()),
			source: "selection",
			messageCount: 0
		};
	}
	function captureLastVisibleMessages(count) {
		const allMessages = Array.from(document.querySelectorAll(MESSAGE_NODE_SELECTOR));
		if (allMessages.length === 0) return {
			text: "",
			source: "empty",
			messageCount: 0
		};
		const lines = allMessages.slice(-count).map(formatMessageNode).filter((l) => l.length > 0);
		return {
			text: lines.join("\n\n"),
			source: "fallback-last-messages",
			messageCount: lines.length
		};
	}
	function formatMessageNode(node) {
		const usernameEl = node.querySelector("[id^=\"message-username-\"], [class*=\"username\"]");
		const contentEl = node.querySelector("[id^=\"message-content-\"], [class*=\"markup\"][class*=\"messageContent\"], [class*=\"messageContent\"]");
		const timestampEl = node.querySelector("time");
		const username = usernameEl?.textContent?.trim() ?? "";
		const content = contentEl?.textContent?.trim() ?? node.textContent?.trim() ?? "";
		const timestamp = timestampEl?.getAttribute("datetime") ?? "";
		if (!content) return "";
		const header = username ? timestamp ? `${username} [${timestamp}]` : username : "";
		return header ? `${header}:\n${content}` : content;
	}
	var STORAGE_KEY$1 = "settings";
	var DEFAULTS = {
		anthropicApiKey: "",
		anthropicModel: "claude-haiku-4-5-20251001",
		subjectPrefix: "Discord: ",
		skipPopupWhenConfident: false,
		sfDomain: "overwolf.lightning.force.com"
	};
	function getSettings() {
		const stored = GM_getValue(STORAGE_KEY$1, {});
		return {
			...DEFAULTS,
			...stored
		};
	}
	function setSetting(key, value) {
		const current = getSettings();
		GM_setValue(STORAGE_KEY$1, {
			...current,
			[key]: value
		});
	}
	var SYSTEM_PROMPT = `You generate a Salesforce activity headline + TL;DR from a Discord conversation excerpt.

Output a single JSON object with exactly two string fields:
- "subject": one short sentence (max 80 chars) capturing what happened. DO NOT start with "Discord" or "Discord:" — the caller adds that prefix. Be specific ("Joe confirmed Q2 renewal", "Pricing pushback on enterprise tier", "Forwarded email asking about beta access timing").
- "tldr": 1-3 short bullet points, each on its own line prefixed with "- ", covering outcomes, commitments, action items, asks. Skip pleasantries. Aim for ~30-60 words total. If the conversation is too sparse to bullet, write a single short sentence summary instead.

Output only the JSON object. No markdown fences. No commentary.`;
	async function summarizeForSalesforce(input) {
		const userPrompt = `Conversation with @${input.counterparty || "unknown"}:\n\n${input.transcript}`;
		const parsed = tryParseJson(await callAnthropic(input.apiKey, input.model, [{
			role: "user",
			content: userPrompt
		}]));
		if (parsed && typeof parsed.subject === "string") return {
			subject: stripDiscordPrefix(parsed.subject),
			tldr: typeof parsed.tldr === "string" ? parsed.tldr.trim() : ""
		};
		return {
			subject: "general update",
			tldr: ""
		};
	}
	function composeDescription(tldr, verbatimTranscript) {
		const trimmedTldr = tldr.trim();
		const trimmedTranscript = verbatimTranscript.trim();
		if (trimmedTldr && trimmedTranscript) return `TL;DR\n${trimmedTldr}\n\n---\n\nFull conversation:\n${trimmedTranscript}`;
		if (trimmedTranscript) return trimmedTranscript;
		if (trimmedTldr) return `TL;DR\n${trimmedTldr}`;
		return "";
	}
	function tryParseJson(text) {
		const trimmed = text.trim();
		const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		const candidate = fenced ? fenced[1] : trimmed;
		try {
			return JSON.parse(candidate);
		} catch {
			const braceMatch = candidate.match(/\{[\s\S]*\}/);
			if (braceMatch) try {
				return JSON.parse(braceMatch[0]);
			} catch {
				return null;
			}
			return null;
		}
	}
	function stripDiscordPrefix(subject) {
		return subject.replace(/^\s*discord\s*:?\s*/i, "").trim() || "general update";
	}
	function callAnthropic(apiKey, model, messages) {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json"
				},
				data: JSON.stringify({
					model,
					max_tokens: 600,
					system: SYSTEM_PROMPT,
					messages
				}),
				onload: (response) => {
					if (response.status !== 200) {
						reject(new Error(`Anthropic API returned ${response.status}: ${response.responseText}`));
						return;
					}
					try {
						const text = JSON.parse(response.responseText)?.content?.[0]?.text;
						if (typeof text !== "string") {
							reject(new Error("Anthropic response missing content[0].text"));
							return;
						}
						resolve(text);
					} catch (e) {
						reject(e);
					}
				},
				onerror: (err) => reject(err)
			});
		});
	}
	var OPPS_KEY = "recent_sf_records";
	var CONTACTS_KEY = "recent_contacts";
	var MAX_ENTRIES = 20;
	function listRecent() {
		return GM_getValue(OPPS_KEY, []).filter((r) => !r.type || r.type === "Opportunity").map((r) => ({
			id: r.id,
			name: r.name,
			visitedAt: r.visitedAt,
			lastFocusedAt: r.lastFocusedAt,
			account: r.account ?? (r.accountId && r.accountName ? {
				id: r.accountId,
				name: r.accountName
			} : void 0),
			contacts: r.contacts
		}));
	}
	var MAX_CONTACTS_PER_OPP = 10;
	function recordVisit(input) {
		const now = new Date().toISOString();
		const existing = listRecent();
		const idx = existing.findIndex((r) => r.id === input.id);
		let updated;
		if (idx >= 0) {
			updated = {
				...existing[idx],
				name: input.name,
				lastFocusedAt: now,
				account: input.account,
				contacts: mergeContacts(existing[idx].contacts, input.contacts)
			};
			existing.splice(idx, 1);
		} else updated = {
			id: input.id,
			name: input.name,
			visitedAt: now,
			lastFocusedAt: now,
			account: input.account,
			contacts: input.contacts ? capContacts(input.contacts) : void 0
		};
		existing.unshift(updated);
		GM_setValue(OPPS_KEY, existing.slice(0, MAX_ENTRIES));
	}
	function bumpLastFocused(id) {
		const all = GM_getValue(OPPS_KEY, []);
		const idx = all.findIndex((r) => r && r.id === id);
		if (idx < 0) return;
		all[idx] = {
			...all[idx],
			lastFocusedAt: new Date().toISOString()
		};
		GM_setValue(OPPS_KEY, all);
	}
	function clearLastFocused(id) {
		const all = GM_getValue(OPPS_KEY, []);
		const idx = all.findIndex((r) => r && r.id === id);
		if (idx < 0) return;
		all[idx] = {
			...all[idx],
			lastFocusedAt: "1970-01-01T00:00:00.000Z"
		};
		GM_setValue(OPPS_KEY, all);
	}
	function mergeContacts(existing, incoming) {
		if (!incoming || incoming.length === 0) return existing;
		const byId = new Map();
		for (const c of existing ?? []) byId.set(c.id, c);
		for (const c of incoming) {
			const prior = byId.get(c.id);
			byId.set(c.id, {
				...prior,
				...c
			});
		}
		return capContacts(Array.from(byId.values()));
	}
	function capContacts(contacts) {
		return [...contacts].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, MAX_CONTACTS_PER_OPP);
	}
	function getMostRecentlyFocused() {
		return listRecent()[0] ?? null;
	}
	function listRecentContacts() {
		return GM_getValue(CONTACTS_KEY, []);
	}
	var MAX_OPPS_PER_CONTACT = 10;
	function recordContactVisit(input) {
		const now = new Date().toISOString();
		const existing = listRecentContacts();
		const idx = existing.findIndex((r) => r.id === input.id);
		let updated;
		if (idx >= 0) {
			updated = {
				...existing[idx],
				name: input.name,
				lastFocusedAt: now,
				discordUsername: input.discordUsername ?? existing[idx].discordUsername,
				discordUserId: input.discordUserId ?? existing[idx].discordUserId,
				opps: mergeOpps(existing[idx].opps, input.opps)
			};
			existing.splice(idx, 1);
		} else updated = {
			id: input.id,
			name: input.name,
			visitedAt: now,
			lastFocusedAt: now,
			discordUsername: input.discordUsername,
			discordUserId: input.discordUserId,
			opps: input.opps ? capOpps(input.opps) : void 0
		};
		existing.unshift(updated);
		GM_setValue(CONTACTS_KEY, existing.slice(0, MAX_ENTRIES));
	}
	function mergeOpps(existing, incoming) {
		if (!incoming || incoming.length === 0) return existing;
		const byId = new Map();
		for (const o of existing ?? []) byId.set(o.id, o);
		for (const o of incoming) {
			const prior = byId.get(o.id);
			byId.set(o.id, {
				...prior,
				...o
			});
		}
		return capOpps(Array.from(byId.values()));
	}
	function capOpps(opps) {
		return [...opps].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, MAX_OPPS_PER_CONTACT);
	}
	var STORAGE_KEY = "learned_mappings";
	function userIdKey(userId) {
		return `uid:${userId}`;
	}
	function usernameKey(username) {
		return `un:${normalizeDiscordHandle(username)}`;
	}
	function listMappings() {
		return GM_getValue(STORAGE_KEY, {});
	}
	function getMappingFor(cp) {
		const all = listMappings();
		if (cp.userId) {
			const byId = all[userIdKey(cp.userId)];
			if (byId) return byId;
		}
		if (cp.username) {
			const byName = all[usernameKey(cp.username)];
			if (byName) return byName;
		}
		return null;
	}
	function recordMapping(cp, oppId, oppName) {
		const all = listMappings();
		const entry = {
			oppId,
			oppName,
			lastUsed: new Date().toISOString()
		};
		if (cp.userId) all[userIdKey(cp.userId)] = entry;
		else if (cp.username) all[usernameKey(cp.username)] = entry;
		else return;
		GM_setValue(STORAGE_KEY, all);
	}
	function normalizeDiscordHandle(s) {
		return s.trim().replace(/^@/, "").toLowerCase();
	}
	function identifyTarget(input) {
		const openOpp = getMostRecentlyFocused();
		if (openOpp && isRecent(openOpp.lastFocusedAt)) return {
			kind: "open-sf-tab",
			record: openOpp
		};
		const mapping = getMappingFor(input.counterparty);
		if (mapping) return {
			kind: "learned-mapping",
			record: {
				id: mapping.oppId,
				name: mapping.oppName,
				visitedAt: mapping.lastUsed,
				lastFocusedAt: mapping.lastUsed
			}
		};
		const contact = findContactForCounterparty(input.counterparty);
		if (contact && contact.opps && contact.opps.length > 0) return {
			kind: "contact-scoped-picker",
			contact: {
				id: contact.id,
				name: contact.name,
				discordUsername: contact.discordUsername,
				discordUserId: contact.discordUserId
			},
			choices: contact.opps.map((o) => ({
				id: o.id,
				name: o.name,
				accountName: o.accountName,
				stage: o.stage
			}))
		};
		const recent = listRecent();
		if (recent.length > 0) return {
			kind: "picker",
			choices: recent
		};
		return { kind: "manual" };
	}
	function findContactForCounterparty(cp) {
		const all = listRecentContacts();
		const byMostRecent = (a, b) => b.lastFocusedAt.localeCompare(a.lastFocusedAt);
		if (cp.userId) {
			const byUserId = all.filter((c) => c.discordUserId === cp.userId).sort(byMostRecent)[0];
			if (byUserId) return byUserId;
		}
		const normCp = normalizeDiscordHandle(cp.username);
		if (!normCp) return void 0;
		const byDiscordField = all.filter((c) => c.discordUsername && normalizeDiscordHandle(c.discordUsername) === normCp).sort(byMostRecent)[0];
		if (byDiscordField) return byDiscordField;
		return all.filter((c) => {
			return normalizeDiscordHandle(c.name.split(/\s+/)[0] ?? "") === normCp;
		}).sort(byMostRecent)[0];
	}
	var OPEN_TAB_PRESENCE_MS = 10 * 1e3;
	function isRecent(iso) {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return false;
		return Date.now() - t < OPEN_TAB_PRESENCE_MS;
	}
	var popupHTML = (data) => `
<div class="dsfl-popup">
  <header class="dsfl-popup__header">
    <h2>Log to Salesforce</h2>
    <button class="dsfl-popup__close" data-action="close" aria-label="Close">×</button>
  </header>

  <div class="dsfl-popup__body">
    <div class="dsfl-popup__field">
      <label class="dsfl-popup__strategy-label">Source <span class="dsfl-popup__strategy">(${escapeHTML(data.strategyLabel)})</span></label>
      ${data.contactScopedHint ? `<div class="dsfl-popup__hint">${escapeHTML(data.contactScopedHint)}</div>` : ""}
      <div class="dsfl-popup__target-grid">
        <div class="dsfl-popup__target-row">
          <span class="dsfl-popup__target-key">Opportunity</span>
          <span class="dsfl-popup__target-val" id="dsfl-opp-name">${escapeHTML(data.opportunityName || "(none)")}</span>
        </div>
        <div class="dsfl-popup__target-row">
          <span class="dsfl-popup__target-key">Account</span>
          <span class="dsfl-popup__target-val" id="dsfl-acc-name">${escapeHTML(data.accountName || "(not detected)")}</span>
        </div>
      </div>
      ${data.showPicker ? `
        <select class="dsfl-popup__picker" data-action="pick-target">
          <option value="">Pick an Opportunity…</option>
          ${data.pickerChoices.map((c) => {
		const label = c.accountName ? `${c.name} — ${c.accountName}` : c.name;
		return `<option value="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}" data-account="${escapeHTML(c.accountName ?? "")}">${escapeHTML(label)}</option>`;
	}).join("")}
        </select>
      ` : ""}
      ${data.showManual ? `
        <input class="dsfl-popup__manual-id" data-action="manual-id" placeholder="Paste Opportunity ID (e.g. 006Hu000ABC)" />
      ` : ""}
    </div>

    <div class="dsfl-popup__field">
      <label>Contact (optional, links activity to a Person)</label>
      ${data.contactChoices.length > 0 ? `
        <select class="dsfl-popup__contact-picker" data-action="pick-contact">
          <option value="">No contact</option>
          ${data.contactChoices.map((c) => {
		const label = c.discordUsername ? `${c.name} — @${c.discordUsername}` : c.name;
		return `<option value="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}">${escapeHTML(label)}</option>`;
	}).join("")}
        </select>
      ` : `
        <div class="dsfl-popup__empty-hint">
          No tracked contacts yet. Open a Contact page in Salesforce (e.g. via the
          "Search" bar) to add it here. Or paste a Contact ID below.
        </div>
      `}
      <input class="dsfl-popup__contact-id" data-action="contact-id" placeholder="Or paste Contact ID (e.g. 003Hu000XYZ)" />
    </div>

    <div class="dsfl-popup__field">
      <label>Subject</label>
      <input class="dsfl-popup__subject" data-action="edit-subject" value="${escapeHTML(data.subject)}" />
    </div>

    <div class="dsfl-popup__field">
      <label>Description (TL;DR + full transcript)</label>
      <textarea class="dsfl-popup__description" data-action="edit-description" rows="8">${escapeHTML(data.description)}</textarea>
      <div class="dsfl-popup__hint" id="dsfl-length-hint"></div>
    </div>
  </div>

  <footer class="dsfl-popup__footer">
    <button data-action="cancel">Cancel</button>
    <button data-action="send" class="dsfl-popup__send">Send to Salesforce</button>
  </footer>
</div>
`;
	function escapeHTML(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	var popupCSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dsfl-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 560px;
  max-width: 90vw;
  max-height: 88vh;
  background: #fff;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  z-index: 2147483647;
  color: #1f1f1f;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dsfl-popup__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #eee;
  flex: 0 0 auto;
}
.dsfl-popup__header h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dsfl-popup__close {
  background: none; border: none; font-size: 22px; cursor: pointer; line-height: 1;
}
.dsfl-popup__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 0;
}
.dsfl-popup__field { padding: 10px 20px; }
.dsfl-popup__field label, .dsfl-popup__strategy-label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #555;
}
.dsfl-popup__strategy { font-weight: 400; color: #888; font-size: 11px; }
.dsfl-popup__target-grid {
  background: #f4f4f4;
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsfl-popup__target-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  line-height: 1.4;
}
.dsfl-popup__target-key {
  flex: 0 0 90px;
  color: #666;
  font-weight: 600;
}
.dsfl-popup__target-val { flex: 1; color: #1f1f1f; font-weight: 500; }
.dsfl-popup__picker, .dsfl-popup__manual-id, .dsfl-popup__subject,
.dsfl-popup__contact-picker, .dsfl-popup__contact-id {
  width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc;
  border-radius: 4px; margin-top: 6px; box-sizing: border-box;
}
.dsfl-popup__description {
  width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #ccc;
  border-radius: 4px; font-family: monospace; box-sizing: border-box; resize: vertical;
  min-height: 120px;
}
.dsfl-popup__hint {
  font-size: 11px; color: #888; margin-top: 4px;
}
.dsfl-popup__hint--warn { color: #c47900; }
.dsfl-popup__empty-hint {
  font-size: 12px; color: #777; padding: 6px 0; line-height: 1.4;
}
.dsfl-popup__footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px; border-top: 1px solid #eee;
  background: #fafafa;
  flex: 0 0 auto;
}
.dsfl-popup__footer button {
  padding: 8px 14px; font-size: 14px; border-radius: 4px; cursor: pointer;
  border: 1px solid #ccc; background: #fff; color: #1f1f1f;
}
.dsfl-popup__footer button.dsfl-popup__send {
  background: #5865f2; color: #fff; border-color: #5865f2; font-weight: 600;
}
.dsfl-popup__footer button.dsfl-popup__send:hover {
  background: #4752c4; border-color: #4752c4;
}
`;
	function applyDiscordHandleLearning(contactId, counterparty) {
		if (!contactId) return false;
		if (!counterparty.username && !counterparty.userId) return false;
		const existing = listRecentContacts().find((c) => c.id === contactId);
		if (!existing) return false;
		recordContactVisit({
			id: existing.id,
			name: existing.name,
			discordUsername: counterparty.username || existing.discordUsername,
			discordUserId: counterparty.userId ?? existing.discordUserId,
			opps: existing.opps
		});
		return true;
	}
	function shouldLearnHandle(chosenContactId, contactChoices) {
		if (!chosenContactId) return void 0;
		const matched = contactChoices.find((c) => c.id === chosenContactId);
		if (matched && !matched.discordUsername) return chosenContactId;
	}
	var URL_WARN_THRESHOLD = 1200;
	function showPopup(input) {
		return new Promise((resolve) => {
			const host = document.createElement("div");
			host.id = "dsfl-popup-host";
			const shadow = host.attachShadow({ mode: "closed" });
			document.body.appendChild(host);
			const style = document.createElement("style");
			style.textContent = popupCSS;
			shadow.appendChild(style);
			const initial = initialTarget(input.strategy);
			const strategyLabel = strategyDescriptor(input.strategy);
			const showPicker = input.strategy.kind === "picker" || input.strategy.kind === "contact-scoped-picker";
			const showManual = input.strategy.kind === "manual";
			const pickerChoices = input.strategy.kind === "picker" ? input.strategy.choices.map((c) => ({
				id: c.id,
				name: c.name,
				accountName: c.account?.name
			})) : input.strategy.kind === "contact-scoped-picker" ? input.strategy.choices.map((c) => ({
				id: c.id,
				name: c.name,
				accountName: c.accountName
			})) : [];
			const container = document.createElement("div");
			const contactScopedHint = input.strategy.kind === "contact-scoped-picker" ? `Showing ${input.strategy.choices.length} ${input.strategy.choices.length === 1 ? "Opp" : "Opps"} for ${input.strategy.contact.name}${input.strategy.contact.discordUsername ? " (@" + input.strategy.contact.discordUsername + ")" : ""}` : void 0;
			container.innerHTML = popupHTML({
				opportunityName: initial.oppName,
				accountName: initial.accountName,
				strategyLabel,
				contactScopedHint,
				subject: input.initialSubject,
				description: input.initialDescription,
				pickerChoices,
				showPicker,
				showManual,
				contactChoices: input.contactChoices
			});
			shadow.appendChild(container);
			let chosenOppId = initial.oppId;
			let chosenOppName = initial.oppName;
			let chosenAccountName = initial.accountName;
			let chosenContactId = "";
			if (input.strategy.kind === "contact-scoped-picker") {
				const sel = shadow.querySelector("select[data-action=\"pick-contact\"]");
				if (sel) {
					sel.value = input.strategy.contact.id;
					chosenContactId = input.strategy.contact.id;
				}
			}
			const keyHandler = (e) => {
				if ((e.composedPath?.() ?? []).includes(host)) e.stopImmediatePropagation();
			};
			const KEY_EVENTS = [
				"keydown",
				"keyup",
				"keypress"
			];
			for (const evt of KEY_EVENTS) window.addEventListener(evt, keyHandler, true);
			const updateLengthHint = () => {
				const desc = shadow.querySelector(".dsfl-popup__description")?.value ?? "";
				const subj = shadow.querySelector(".dsfl-popup__subject")?.value ?? "";
				const approxLen = desc.length * 2 + subj.length * 2 + 200;
				const hint = shadow.querySelector("#dsfl-length-hint");
				if (!hint) return;
				if (approxLen > URL_WARN_THRESHOLD) {
					hint.textContent = `${desc.length} chars — description will auto-fill via DOM after SF opens (URL would truncate).`;
					hint.className = "dsfl-popup__hint dsfl-popup__hint--warn";
				} else {
					hint.textContent = `${desc.length} characters`;
					hint.className = "dsfl-popup__hint";
				}
			};
			updateLengthHint();
			const close = (result) => {
				for (const evt of KEY_EVENTS) window.removeEventListener(evt, keyHandler, true);
				host.remove();
				resolve(result);
			};
			shadow.addEventListener("click", (e) => {
				const action = e.target.getAttribute("data-action");
				if (!action) return;
				if (action === "close" || action === "cancel") close(null);
				if (action === "send") {
					if (!chosenOppId) {
						alert("Please pick a Salesforce target first.");
						return;
					}
					const subject = shadow.querySelector(".dsfl-popup__subject").value;
					const description = shadow.querySelector(".dsfl-popup__description").value;
					const learnHandleForContactId = shouldLearnHandle(chosenContactId, input.contactChoices);
					close({
						oppId: chosenOppId,
						oppName: chosenOppName,
						accountName: chosenAccountName,
						whoId: chosenContactId,
						subject,
						description,
						learnHandleForContactId
					});
				}
			});
			shadow.addEventListener("change", (e) => {
				const t = e.target;
				const action = t.getAttribute("data-action");
				if (action === "pick-target") {
					const opt = t.selectedOptions[0];
					if (opt) {
						chosenOppId = opt.value;
						chosenOppName = opt.getAttribute("data-name") ?? opt.textContent ?? "";
						chosenAccountName = opt.getAttribute("data-account") ?? "";
						const oppEl = shadow.querySelector("#dsfl-opp-name");
						if (oppEl) oppEl.textContent = chosenOppName || "(none)";
						const accEl = shadow.querySelector("#dsfl-acc-name");
						if (accEl) accEl.textContent = chosenAccountName || "(not detected)";
					}
				} else if (action === "pick-contact") {
					chosenContactId = t.selectedOptions[0]?.value ?? "";
					const manualEl = shadow.querySelector(".dsfl-popup__contact-id");
					if (manualEl && chosenContactId) manualEl.value = "";
				}
			});
			shadow.addEventListener("input", (e) => {
				const t = e.target;
				const action = t.getAttribute("data-action");
				if (action === "manual-id") {
					chosenOppId = t.value.trim();
					chosenOppName = chosenOppId;
					chosenAccountName = "";
					const oppEl = shadow.querySelector("#dsfl-opp-name");
					if (oppEl) oppEl.textContent = chosenOppName || "(none)";
					const accEl = shadow.querySelector("#dsfl-acc-name");
					if (accEl) accEl.textContent = "(not detected)";
				} else if (action === "contact-id") chosenContactId = t.value.trim();
				else if (action === "edit-description" || action === "edit-subject") updateLengthHint();
			});
		});
	}
	function initialTarget(s) {
		if (s.kind === "open-sf-tab" || s.kind === "learned-mapping") return {
			oppId: s.record.id,
			oppName: s.record.name,
			accountName: s.record.account?.name ?? ""
		};
		if (s.kind === "contact-scoped-picker" && s.choices.length === 1) {
			const only = s.choices[0];
			return {
				oppId: only.id,
				oppName: only.name,
				accountName: only.accountName ?? ""
			};
		}
		return {
			oppId: "",
			oppName: "",
			accountName: ""
		};
	}
	function strategyDescriptor(s) {
		switch (s.kind) {
			case "open-sf-tab": return "detected from open SF tab";
			case "learned-mapping": return "remembered from last log";
			case "contact-scoped-picker": return `Opps for ${s.contact.name}`;
			case "picker": return "pick from recent records";
			case "manual": return "paste manually";
		}
	}
	function buildSFTaskUrl(input) {
		const fields = {
			Subject: input.subject,
			Description: input.description,
			WhatId: input.whatId,
			Status: "Completed",
			ActivityDate: input.activityDate
		};
		if (input.whoId) fields.WhoId = input.whoId;
		const inner = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(",");
		const url = new URL(`https://${input.sfDomain}/lightning/o/Task/new`);
		url.searchParams.set("defaultFieldValues", inner);
		return url.toString();
	}
	function readCurrentDiscordUserId() {
		for (const sel of [
			"[class*=\"panels\"] [class*=\"avatar\"]",
			"[data-list-item-id^=\"me-\"]",
			"[class*=\"container\"][class*=\"userPanelOuter\"]"
		]) {
			const el = document.querySelector(sel);
			const id = el?.getAttribute("data-user-id") ?? el?.closest("[data-user-id]")?.getAttribute("data-user-id") ?? el?.closest("[data-list-item-id^=\"me-\"]")?.getAttribute("data-list-item-id")?.replace(/^me-/, "");
			if (id && /^\d{15,21}$/.test(id)) return id;
		}
		return null;
	}
	var URL_DESCRIPTION_LIMIT = 1200;
	var PENDING_FILL_KEY$1 = "pending_task_fill";
	var PENDING_FILL_TTL_MS = 90 * 1e3;
	function startDiscordIntegration() {
		injectButton(handleLogClick);
	}
	async function handleLogClick() {
		const settings = getSettings();
		if (!settings.anthropicApiKey) {
			alert("Discord → SF Logger: please set your Anthropic API key in the Tampermonkey menu first.");
			return;
		}
		const captured = captureDiscordTranscript();
		if (!captured.text.trim()) {
			alert("Discord → SF Logger: no messages found to log. Try again from inside the channel.");
			return;
		}
		console.log(`[discord-sf-logger] captured ${captured.messageCount} messages via ${captured.source}:`, captured.text);
		const counterparty = detectCounterparty(readCurrentDiscordUserId());
		if (!counterparty) {
			alert("Discord → SF Logger: could not detect the conversation. Open a 1:1 DM or channel and try again.");
			return;
		}
		const strategy = identifyTarget({ counterparty });
		let aiSummary;
		try {
			aiSummary = await summarizeForSalesforce({
				apiKey: settings.anthropicApiKey,
				model: settings.anthropicModel,
				transcript: captured.text,
				counterparty: counterparty.username
			});
		} catch (err) {
			console.error("[discord-sf-logger] Anthropic call failed, falling back to subject=\"general update\"", err);
			aiSummary = {
				subject: "general update",
				tldr: ""
			};
		}
		const description = composeDescription(aiSummary.tldr, captured.text);
		const cleanedSubject = aiSummary.subject.replace(/^\s*discord\s*:?\s*/i, "").trim() || "general update";
		const result = await showPopup({
			strategy,
			initialSubject: `${settings.subjectPrefix}${cleanedSubject}`,
			initialDescription: description,
			contactChoices: listRecentContacts().slice(0, 10).map((r) => ({
				id: r.id,
				name: r.name,
				discordUsername: r.discordUsername
			}))
		});
		if (!result) return;
		if (result.learnHandleForContactId) {
			if (applyDiscordHandleLearning(result.learnHandleForContactId, counterparty)) console.log(`[discord-sf-logger] learned Discord handle for Contact ${result.learnHandleForContactId} = ${counterparty.username}${counterparty.userId ? ` (id ${counterparty.userId})` : ""}`);
		}
		const today = new Date().toISOString().slice(0, 10);
		GM_setValue(PENDING_FILL_KEY$1, {
			description: result.description,
			expiresAt: Date.now() + PENDING_FILL_TTL_MS
		});
		const urlDescription = result.description.length <= URL_DESCRIPTION_LIMIT ? result.description : "";
		const fullUrl = buildSFTaskUrl({
			sfDomain: settings.sfDomain,
			subject: result.subject,
			description: urlDescription,
			whatId: result.oppId,
			whoId: result.whoId || void 0,
			activityDate: today
		});
		GM_openInTab(fullUrl, { active: true });
		recordMapping(counterparty, result.oppId, result.oppName);
	}
	var API_BASE = `/services/data/v60.0/ui-api`;
	var sessionBlocked = false;
	function logFetchFailure(endpoint, reason) {
		console.warn(`[discord-sf-logger] UI API ${endpoint} failed: ${reason}`);
	}
	async function fetchJson(path) {
		if (sessionBlocked) return null;
		let res;
		try {
			res = await fetch(path, { credentials: "same-origin" });
		} catch (err) {
			logFetchFailure(path, `network error: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
		if (res.status === 401 || res.status === 403) {
			sessionBlocked = true;
			logFetchFailure(path, `auth ${res.status} — pausing UI API for the rest of this session`);
			return null;
		}
		if (!res.ok) {
			logFetchFailure(path, `HTTP ${res.status}`);
			return null;
		}
		try {
			return await res.json();
		} catch (err) {
			logFetchFailure(path, `malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	}
	function readFieldValue(field) {
		if (!field) return null;
		const v = field.value;
		return typeof v === "string" ? v : null;
	}
	function readAccountFromRecord(fields) {
		if (!fields) return void 0;
		const accountField = fields.Account;
		const accountId = readFieldValue(fields.AccountId);
		const accountName = accountField?.displayValue ?? null;
		const nestedId = accountField?.value && typeof accountField.value === "object" && "id" in accountField.value ? accountField.value.id : void 0;
		const id = accountId ?? (typeof nestedId === "string" ? nestedId : null);
		if (id && accountName) return {
			id,
			name: accountName
		};
	}
	async function fetchContact(id) {
		const body = await fetchJson(`${API_BASE}/records/${id}?fields=${[
			"Contact.Name",
			"Contact.Discord__c",
			"Contact.AccountId",
			"Contact.Account.Name"
		].join(",")}`);
		if (!body?.fields) return null;
		const name = readFieldValue(body.fields.Name);
		if (!name || !body.id) return null;
		return {
			id: body.id,
			name,
			discordUsername: readFieldValue(body.fields.Discord__c),
			account: readAccountFromRecord(body.fields)
		};
	}
	async function fetchOpportunity(id) {
		const body = await fetchJson(`${API_BASE}/records/${id}?fields=${[
			"Opportunity.Name",
			"Opportunity.StageName",
			"Opportunity.AccountId",
			"Opportunity.Account.Name"
		].join(",")}`);
		if (!body) return null;
		return parseOppRecord(body);
	}
	function parseOppRecord(rec) {
		if (!rec.fields || !rec.id) return null;
		const name = readFieldValue(rec.fields.Name);
		if (!name) return null;
		const stage = rec.fields.StageName?.displayValue ?? readFieldValue(rec.fields.StageName) ?? void 0;
		return {
			id: rec.id,
			name,
			stage,
			account: readAccountFromRecord(rec.fields)
		};
	}
	async function fetchContactRelatedOpps(contactId) {
		const body = await fetchJson(`${API_BASE}/related-list-records/${contactId}/Opportunities?fields=${[
			"Opportunity.Name",
			"Opportunity.StageName",
			"Opportunity.Account.Name"
		].join(",")}`);
		if (!body?.records) return [];
		const out = [];
		for (const rec of body.records) {
			const parsed = parseOppRecord(rec);
			if (parsed) out.push(parsed);
		}
		return out;
	}
	async function fetchOppContactRoles(oppId) {
		const body = await fetchJson(`${API_BASE}/related-list-records/${oppId}/OpportunityContactRoles?fields=${["OpportunityContactRole.ContactId", "OpportunityContactRole.Contact.Name"].join(",")}`);
		if (!body?.records) return [];
		const out = [];
		for (const rec of body.records) {
			const contactId = readFieldValue(rec.fields?.ContactId);
			if (!contactId) continue;
			const contactName = rec.fields?.Contact?.displayValue ?? "";
			if (!contactName) continue;
			out.push({
				contactId,
				contactName
			});
		}
		return out;
	}
	var POLL_INTERVAL_MS = 2e3;
	var PENDING_FILL_KEY = "pending_task_fill";
	var apiFetchState = new Map();
	function shouldCallApi(key) {
		return !apiFetchState.has(key);
	}
	function markApiInFlight(key) {
		apiFetchState.set(key, "in-flight");
	}
	function recordApiAttemptResult(key, ok) {
		apiFetchState.set(key, ok ? "success" : "failed");
	}
	function startSalesforceWatcher() {
		const tick = () => {
			const page = parseLightningUrl(window.location.href);
			if (page) {
				if (page.type === "Opportunity") updateOpportunity(page.id);
				else if (page.type === "Contact") updateContact(page.id);
			}
			tryFillPendingTask();
		};
		window.addEventListener("beforeunload", () => {
			const page = parseLightningUrl(window.location.href);
			if (page?.type === "Opportunity") clearLastFocused(page.id);
		});
		window.addEventListener("popstate", tick);
		window.addEventListener("hashchange", tick);
		window.addEventListener("focus", tick);
		setInterval(tick, POLL_INTERVAL_MS);
		tick();
	}
	function updateOpportunity(id) {
		bumpLastFocused(id);
		const key = `opp:${id}`;
		if (!shouldCallApi(key)) return;
		markApiInFlight(key);
		(async () => {
			try {
				const [opp, contactRoles] = await Promise.all([fetchOpportunity(id), fetchOppContactRoles(id)]);
				if (!opp) {
					recordApiAttemptResult(key, false);
					return;
				}
				const now = new Date().toISOString();
				recordVisit({
					id: opp.id,
					name: opp.name,
					account: opp.account,
					contacts: contactRoles.map((r) => ({
						id: r.contactId,
						name: r.contactName,
						lastSeenAt: now
					}))
				});
				recordApiAttemptResult(key, true);
				const parts = [opp.name];
				if (opp.account?.name) parts.push(`(${opp.account.name})`);
				showToast(`Cached Opportunity ${parts.join(" ")}`, "success");
			} catch {
				recordApiAttemptResult(key, false);
			}
		})();
	}
	function updateContact(id) {
		const key = `contact:${id}`;
		if (!shouldCallApi(key)) return;
		markApiInFlight(key);
		(async () => {
			try {
				const [contact, opps] = await Promise.all([fetchContact(id), fetchContactRelatedOpps(id)]);
				if (!contact) {
					recordApiAttemptResult(key, false);
					return;
				}
				const now = new Date().toISOString();
				recordContactVisit({
					id: contact.id,
					name: contact.name,
					discordUsername: contact.discordUsername ?? void 0,
					opps: opps.map((o) => ({
						id: o.id,
						name: o.name,
						stage: o.stage,
						accountName: o.account?.name,
						lastSeenAt: now
					}))
				});
				recordApiAttemptResult(key, true);
				const parts = [contact.name];
				if (contact.discordUsername) parts.push(`(@${contact.discordUsername})`);
				const tail = opps.length > 0 ? ` — ${opps.length} ${opps.length === 1 ? "Opp" : "Opps"}` : "";
				showToast(`Cached Contact ${parts.join(" ")}${tail}`, "success");
			} catch {
				recordApiAttemptResult(key, false);
			}
		})();
	}
	function parseLightningUrl(url) {
		const match = url.match(/\/lightning\/r\/(Opportunity|Account|Contact)\/([a-zA-Z0-9]{11,18})/);
		if (!match) return null;
		return {
			type: match[1],
			id: match[2]
		};
	}
	function findAllInShadow(selector) {
		const results = [];
		const visited = new WeakSet();
		const walk = (root) => {
			if (visited.has(root)) return;
			visited.add(root);
			for (const el of Array.from(root.querySelectorAll(selector))) results.push(el);
			for (const el of Array.from(root.querySelectorAll("*"))) {
				const sr = el.shadowRoot;
				if (sr) walk(sr);
			}
		};
		walk(document);
		return results;
	}
	function tryFillPendingTask() {
		if (!/\/lightning\/o\/Task\/new/.test(window.location.href)) return;
		const pending = GM_getValue(PENDING_FILL_KEY, null);
		if (!pending) return;
		if (Date.now() > pending.expiresAt) {
			GM_deleteValue(PENDING_FILL_KEY);
			return;
		}
		const textarea = findCommentsTextarea();
		if (!textarea) return;
		if (textarea.value === pending.description) {
			GM_deleteValue(PENDING_FILL_KEY);
			return;
		}
		setNativeValue(textarea, pending.description);
		console.log("[discord-sf-logger] auto-filled Comments textarea via DOM");
		showToast("Description auto-filled", "success");
		GM_deleteValue(PENDING_FILL_KEY);
	}
	function findCommentsTextarea() {
		const all = findAllInShadow("textarea");
		if (all.length === 0) return null;
		if (all.length === 1) return all[0];
		for (const ta of all) {
			const label = ta.closest("lightning-textarea, [data-target-selection-name*=\"Description\"], .slds-form-element")?.textContent?.toLowerCase() ?? "";
			if (label.includes("comment") || label.includes("description")) return ta;
		}
		all.sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
		return all[0];
	}
	function setNativeValue(el, value) {
		const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
		if (descriptor?.set) descriptor.set.call(el, value);
		else el.value = value;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	}
	var toastContainer = null;
	function showToast(message, kind = "info") {
		ensureToastContainer();
		if (!toastContainer) return;
		console.log(`[discord-sf-logger] toast: ${message}`);
		const toast = document.createElement("div");
		toast.textContent = `✓ ${message}`;
		Object.assign(toast.style, {
			background: kind === "success" ? "#04844b" : "#16325c",
			color: "#fff",
			padding: "14px 18px",
			borderRadius: "6px",
			fontSize: "14px",
			fontWeight: "600",
			boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
			opacity: "0",
			transition: "opacity 200ms ease, transform 200ms ease",
			transform: "translateY(12px)",
			maxWidth: "360px",
			fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
			pointerEvents: "auto",
			border: "2px solid rgba(255,255,255,0.2)"
		});
		toastContainer.appendChild(toast);
		requestAnimationFrame(() => {
			toast.style.opacity = "1";
			toast.style.transform = "translateY(0)";
		});
		setTimeout(() => {
			toast.style.opacity = "0";
			toast.style.transform = "translateY(12px)";
			setTimeout(() => toast.remove(), 250);
		}, 5500);
	}
	function ensureToastContainer() {
		if (toastContainer && document.body.contains(toastContainer)) return;
		toastContainer = document.createElement("div");
		toastContainer.id = "dsfl-toast-container";
		Object.assign(toastContainer.style, {
			position: "fixed",
			bottom: "32px",
			right: "32px",
			zIndex: "2147483647",
			display: "flex",
			flexDirection: "column",
			gap: "10px",
			pointerEvents: "none"
		});
		(document.body || document.documentElement).appendChild(toastContainer);
	}
	function registerSettingsMenu() {
		GM_registerMenuCommand("Discord → SF: Set Anthropic API key", () => {
			const current = getSettings().anthropicApiKey;
			const next = prompt("Paste your Anthropic API key (sk-ant-...). Leave blank to clear.", current);
			if (next === null) return;
			setSetting("anthropicApiKey", next.trim());
			alert("API key saved.");
		});
		GM_registerMenuCommand("Discord → SF: Set SF domain", () => {
			const current = getSettings().sfDomain;
			const next = prompt("Salesforce Lightning domain (e.g. overwolf.lightning.force.com).", current);
			if (next === null) return;
			setSetting("sfDomain", next.trim());
			alert("SF domain saved.");
		});
		GM_registerMenuCommand("Discord → SF: Set subject prefix", () => {
			const current = getSettings().subjectPrefix;
			const next = prompt("Subject prefix added to every logged conversation (default 'Discord: ').", current);
			if (next === null) return;
			setSetting("subjectPrefix", next);
			alert("Subject prefix saved.");
		});
		GM_registerMenuCommand("Discord → SF: Clear local cache", () => {
			if (!confirm("Clear all local Discord-SF Logger caches?\n\nWill delete:\n  • recent_sf_records (visited Opps + cached related Contacts)\n  • recent_contacts (visited Contacts + cached related Opps + Discord handles)\n  • learned_mappings (Discord counterparty → Opp memory)\n\nSettings (API key, SF domain, subject prefix) are preserved.")) return;
			clearLocalCache();
			alert("Local cache cleared. Tool will rebuild as you browse Salesforce.");
		});
	}
	function clearLocalCache() {
		GM_deleteValue("recent_sf_records");
		GM_deleteValue("recent_contacts");
		GM_deleteValue("learned_mappings");
		console.log("[discord-sf-logger] local cache cleared");
	}
	console.log(`%c[discord-sf-logger] loaded build 2026-06-01-polish on ${window.location.hostname}`, "background: #5865f2; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600;");
	registerSettingsMenu();
	var host = window.location.hostname;
	if (host === "discord.com") startDiscordIntegration();
	else if (host.endsWith(".lightning.force.com")) startSalesforceWatcher();
})();

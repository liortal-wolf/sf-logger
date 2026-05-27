// ==UserScript==
// @name         Discord → Salesforce Logger
// @namespace    https://github.com/liortal-wolf/sf-logger
// @version      0.1.0
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
		const match = title.match(/@([a-zA-Z0-9_.]+)\s*-\s*Discord$/);
		return match ? match[1] : "";
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
			} : void 0)
		}));
	}
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
				account: input.account
			};
			existing.splice(idx, 1);
		} else updated = {
			id: input.id,
			name: input.name,
			visitedAt: now,
			lastFocusedAt: now,
			account: input.account
		};
		existing.unshift(updated);
		GM_setValue(OPPS_KEY, existing.slice(0, MAX_ENTRIES));
	}
	function getMostRecentlyFocused() {
		return listRecent()[0] ?? null;
	}
	function listRecentContacts() {
		return GM_getValue(CONTACTS_KEY, []);
	}
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
				discordUsername: input.discordUsername ?? existing[idx].discordUsername
			};
			existing.splice(idx, 1);
		} else updated = {
			id: input.id,
			name: input.name,
			visitedAt: now,
			lastFocusedAt: now,
			discordUsername: input.discordUsername
		};
		existing.unshift(updated);
		GM_setValue(CONTACTS_KEY, existing.slice(0, MAX_ENTRIES));
	}
	var STORAGE_KEY = "learned_mappings";
	function listMappings() {
		return GM_getValue(STORAGE_KEY, {});
	}
	function getMappingFor(discordUsername) {
		return listMappings()[discordUsername] ?? null;
	}
	function recordMapping(discordUsername, oppId, oppName) {
		const all = listMappings();
		all[discordUsername] = {
			oppId,
			oppName,
			lastUsed: new Date().toISOString()
		};
		GM_setValue(STORAGE_KEY, all);
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
		const recent = listRecent();
		if (recent.length > 0) return {
			kind: "picker",
			choices: recent
		};
		return { kind: "manual" };
	}
	var RECENCY_THRESHOLD_MS = 14400 * 1e3;
	function isRecent(iso) {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return false;
		return Date.now() - t < RECENCY_THRESHOLD_MS;
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
			const showPicker = input.strategy.kind === "picker";
			const showManual = input.strategy.kind === "manual";
			const pickerChoices = input.strategy.kind === "picker" ? input.strategy.choices.map((c) => ({
				id: c.id,
				name: c.name,
				accountName: c.account?.name
			})) : [];
			const container = document.createElement("div");
			container.innerHTML = popupHTML({
				opportunityName: initial.oppName,
				accountName: initial.accountName,
				strategyLabel,
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
					close({
						oppId: chosenOppId,
						oppName: chosenOppName,
						accountName: chosenAccountName,
						whoId: chosenContactId,
						subject,
						description
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
		const counterparty = detectCounterpartyFromDocumentTitle(document.title);
		const strategy = identifyTarget({ counterparty });
		let aiSummary;
		try {
			aiSummary = await summarizeForSalesforce({
				apiKey: settings.anthropicApiKey,
				model: settings.anthropicModel,
				transcript: captured.text,
				counterparty
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
		if (counterparty) recordMapping(counterparty, result.oppId, result.oppName);
	}
	var POLL_INTERVAL_MS = 2e3;
	var PENDING_FILL_KEY = "pending_task_fill";
	var RELATED_LIST_COUNT_RE = /\(\s*\d+\s*\)\s*$/;
	var ACTION_LABEL_RE = /^(View|Add|Edit|New|Delete|Show|Hide|Clone|Share|Print|Export|Import|Manage|All|Save|Cancel)\b/i;
	var RELATED_LIST_LABEL_RE = /^(Account Team|Contact Roles|Notes|Files|Activity|Activities|Cases|Opportunities|Tasks|Events|Campaign History|Quotes|Orders)\b/i;
	function startSalesforceWatcher() {
		const tick = () => {
			const page = parseLightningUrl(window.location.href);
			if (page) {
				if (page.type === "Opportunity") updateOpportunity(page.id);
				else if (page.type === "Contact") updateContact(page.id);
			}
			tryFillPendingTask();
		};
		window.addEventListener("popstate", tick);
		window.addEventListener("hashchange", tick);
		window.addEventListener("focus", tick);
		setInterval(tick, POLL_INTERVAL_MS);
		tick();
	}
	function updateOpportunity(id) {
		const name = readRecordName();
		const account = readLinkedAccount();
		const existing = listRecent().find((r) => r.id === id);
		const hasGoodName = existing && existing.name !== existing.id;
		const cachedAccountIsBad = existing?.account?.name ? isBadAccountName(existing.account.name) : false;
		if (!(!existing || name && !hasGoodName || account && (!existing.account || cachedAccountIsBad) || cachedAccountIsBad)) {
			recordVisit({
				id,
				name: existing.name,
				account: existing.account
			});
			return;
		}
		const finalAccount = account ?? (cachedAccountIsBad ? void 0 : existing?.account);
		recordVisit({
			id,
			name: name ?? existing?.name ?? id,
			account: finalAccount
		});
		if (!existing || name && !hasGoodName || account && (!existing.account || cachedAccountIsBad)) {
			const parts = [];
			if (name) parts.push(name);
			if (finalAccount?.name) parts.push(`(${finalAccount.name})`);
			showToast(`Cached Opportunity ${parts.join(" ")}`, "success");
		} else if (!account) console.log(`[discord-sf-logger] no canonical Account link found yet for Opp ${id} — will keep trying`);
	}
	function updateContact(id) {
		const name = readRecordName();
		const discordUsername = readContactDiscordUsername();
		const existing = listRecentContacts().find((c) => c.id === id);
		const hasGoodName = existing && existing.name !== existing.id;
		const hasDiscordUsername = !!existing?.discordUsername;
		if (!(!existing || name && !hasGoodName || discordUsername && !hasDiscordUsername)) {
			recordContactVisit({
				id,
				name: existing.name,
				discordUsername: existing.discordUsername
			});
			return;
		}
		recordContactVisit({
			id,
			name: name ?? existing?.name ?? id,
			discordUsername: discordUsername ?? existing?.discordUsername
		});
		if (!existing || name && !hasGoodName || discordUsername && !hasDiscordUsername) {
			const parts = [];
			if (name) parts.push(name);
			if (discordUsername) parts.push(`(@${discordUsername})`);
			showToast(`Cached Contact ${parts.join(" ")}`, "success");
		}
	}
	function parseLightningUrl(url) {
		const match = url.match(/\/lightning\/r\/(Opportunity|Account|Contact)\/([a-zA-Z0-9]{11,18})/);
		if (!match) return null;
		return {
			type: match[1],
			id: match[2]
		};
	}
	function readRecordName() {
		const fromTitle = parseSFTitle(document.title);
		if (fromTitle) return fromTitle;
		const headerText = document.querySelector("h1.slds-page-header__title, h1.slds-var-p-around_xx-small")?.textContent?.trim();
		if (headerText && headerText.length > 0 && !looksLikeSFId(headerText)) return headerText;
		const lwcText = document.querySelector("records-highlights2 lightning-formatted-text, records-highlights2 lightning-formatted-name, [data-target-selection-name*=\"Name\"] lightning-formatted-text")?.textContent?.trim();
		if (lwcText && lwcText.length > 0 && !looksLikeSFId(lwcText)) return lwcText;
		return null;
	}
	function parseSFTitle(title) {
		const m1 = title.match(/^(.+?)\s*\|\s*(?:Opportunity|Account|Contact)\s*\|\s*Salesforce/i);
		if (m1) return m1[1].trim();
		const m2 = title.match(/^(.+?)\s*\|\s*Salesforce\s*$/i);
		if (m2 && !looksLikeSFId(m2[1].trim())) return m2[1].trim();
		return null;
	}
	function looksLikeSFId(s) {
		return /^[a-zA-Z0-9]{15,18}$/.test(s);
	}
	function isBadAccountName(s) {
		return RELATED_LIST_COUNT_RE.test(s) || ACTION_LABEL_RE.test(s) || RELATED_LIST_LABEL_RE.test(s) || looksLikeSFId(s);
	}
	function findAllAccountLinks() {
		const results = [];
		const visited = new WeakSet();
		const walk = (root) => {
			if (visited.has(root)) return;
			visited.add(root);
			const anchors = root.querySelectorAll("a[href*=\"/Account/\"]");
			for (const a of anchors) if (/\/Account\/[a-zA-Z0-9]{11,18}/.test(a.href)) results.push(a);
			for (const el of Array.from(root.querySelectorAll("*"))) {
				const sr = el.shadowRoot;
				if (sr) walk(sr);
			}
		};
		walk(document);
		return results;
	}
	function locateAnchor(link) {
		let el = link;
		while (el) {
			if (el instanceof Element) {
				const tag = el.tagName.toUpperCase();
				if (tag === "RECORDS-HIGHLIGHTS2" || tag === "FORCE-HIGHLIGHTS" || el.classList.contains("slds-page-header")) return "highlights";
				if (tag.startsWith("FORCE-RELATED-LIST") || tag === "FORCE-LST-COMMON-LIST-VIEW" || el.classList.contains("slds-card") && el.querySelector("header")?.textContent?.match(/\(\d+\)/)) return "related-list";
			}
			const root = el.getRootNode();
			if (root instanceof ShadowRoot) el = root.host;
			else if (el instanceof Element) el = el.parentElement;
			else el = null;
		}
		return "other";
	}
	function readLinkedAccount() {
		const scored = findAllAccountLinks().map((link) => {
			const text = readVisibleText(link);
			const id = link.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/)?.[1] ?? "";
			if (!id || !text) return {
				link,
				text,
				id,
				score: 9999,
				reason: "no id/text"
			};
			if (isBadAccountName(text)) return {
				link,
				text,
				id,
				score: 9999,
				reason: "bad text"
			};
			let score = 0;
			const reasons = [];
			const loc = locateAnchor(link);
			if (loc === "highlights") {
				score -= 50;
				reasons.push("highlights");
			} else if (loc === "related-list") {
				score += 100;
				reasons.push("related-list");
			} else reasons.push("other-location");
			if (/\/Account\/[a-zA-Z0-9]+\/view\s*$/.test(link.href)) {
				score -= 10;
				reasons.push("clean-view");
			} else if (/\/Account\/[a-zA-Z0-9]+\/view\?/.test(link.href)) {
				score += 30;
				reasons.push("view-with-query");
			} else if (/\/Account\/[a-zA-Z0-9]+\/related\//.test(link.href)) {
				score += 100;
				reasons.push("related-path");
			} else reasons.push("other-href");
			return {
				link,
				text,
				id,
				score,
				reason: reasons.join(",")
			};
		});
		scored.sort((a, b) => a.score - b.score);
		console.log(`[discord-sf-logger] account candidates: ${scored.length} found`, scored.slice(0, 6).map((c) => ({
			text: c.text,
			href: c.link.href,
			score: c.score,
			reason: c.reason
		})));
		const best = scored[0];
		if (best && best.score < 100) return {
			name: best.text,
			id: best.id
		};
		const fromLabel = readAccountFromLabeledField();
		if (fromLabel) {
			console.log("[discord-sf-logger] account captured via label fallback:", fromLabel);
			return fromLabel;
		}
		return null;
	}
	function readAccountFromLabeledField() {
		const items = findAllInShadow("records-record-layout-item, records-highlights-details-item, force-record-layout-item, .slds-form-element");
		for (const item of items) {
			const labelText = readLabelInside(item);
			if (!labelText) continue;
			const labelLower = labelText.toLowerCase();
			if (labelLower !== "account name" && labelLower !== "account") continue;
			let id = "";
			const innerAnchor = queryDeep(item, "a[href*=\"/Account/\"]");
			if (innerAnchor) {
				const m = innerAnchor.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
				if (m) id = m[1];
			}
			const text = readValueInside(item, labelText);
			if (text && !isBadAccountName(text)) {
				if (id) return {
					name: text,
					id
				};
				console.log("[discord-sf-logger] account name found but no id; storing name only", text);
				return {
					name: text,
					id: ""
				};
			}
		}
		return null;
	}
	function readContactDiscordUsername() {
		const items = findAllInShadow("records-record-layout-item, records-highlights-details-item, force-record-layout-item, .slds-form-element");
		for (const item of items) {
			const labelText = readLabelInside(item);
			if (!labelText || !/^discord\b/i.test(labelText)) continue;
			const value = readValueInside(item, labelText);
			if (value && value !== "-" && value !== "—") return value.replace(/^@/, "");
		}
		return readDiscordFromVisibleText();
	}
	function queryDeep(el, selector) {
		const light = el.querySelector(selector);
		if (light) return light;
		if (el.shadowRoot) {
			const shadowMatch = el.shadowRoot.querySelector(selector);
			if (shadowMatch) return shadowMatch;
		}
		return null;
	}
	function readLabelInside(item) {
		const el = queryDeep(item, ".slds-form-element__label, .test-id__field-label, label, .field-label");
		if (!el) return null;
		return readVisibleText(el) || null;
	}
	function readValueInside(item, labelText) {
		const el = queryDeep(item, "a[href*=\"/Account/\"], lightning-formatted-text, lightning-formatted-name, lightning-formatted-rich-text, records-formula-output, records-output-field, .slds-form-element__static, .test-id__field-value");
		if (el) {
			const t = readVisibleText(el);
			if (t && t !== "-" && t !== "—" && t.toLowerCase() !== labelText.toLowerCase()) return t;
		}
		const itemText = readVisibleText(item);
		if (itemText) {
			const remainder = itemText.startsWith(labelText) ? itemText.slice(labelText.length).trim() : itemText;
			if (remainder && remainder !== "-" && remainder !== "—" && remainder.length < 200) return remainder;
		}
		return null;
	}
	function readVisibleText(el) {
		return (el.innerText ?? el.textContent ?? "").trim();
	}
	function readDiscordFromVisibleText() {
		const match = (document.body?.innerText ?? "").match(/(?:^|\n)\s*Discord\s*\n+\s*([^\n]+?)\s*(?:\n|$)/);
		if (!match) return null;
		const value = match[1].trim();
		if (!value || value === "-" || value === "—" || value.length > 80) return null;
		if (/^(Edit|Title|Phone|Email|Account|Owner|Department|Mailing|Other|Reports To|Birthdate)\b/i.test(value)) return null;
		return value.replace(/^@/, "");
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
	}
	console.log(`%c[discord-sf-logger] loaded build 2026-05-27-fix on ${window.location.hostname}`, "background: #5865f2; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600;");
	registerSettingsMenu();
	var host = window.location.hostname;
	if (host === "discord.com") startDiscordIntegration();
	else if (host.endsWith(".lightning.force.com")) startSalesforceWatcher();
})();

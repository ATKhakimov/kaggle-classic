"use strict";

const toggle = document.getElementById("enabled");
const toggleLabel = document.getElementById("toggle-label");
const popupRow = document.getElementById("popup-row");
const status = document.getElementById("status");
let savedEnabled = true;
let settingChanged = false;

function setEnabled(enabled) {
  savedEnabled = enabled;
  toggle.setAttribute("aria-checked", String(enabled));
  toggleLabel.textContent = enabled ? "On" : "Off";
  document.documentElement.dataset.enabled = String(enabled);
}

function showStatus(message, isError = false) {
  status.textContent = message;
  toggle.title = message;
  popupRow.title = message;
  toggle.dataset.error = String(isError);
}

async function loadSetting() {
  try {
    const settings = await chrome.storage.local.get({ enabled: true });
    if (!settingChanged) setEnabled(typeof settings.enabled === "boolean" ? settings.enabled : true);
    toggle.disabled = false;
    showStatus("");
  } catch (error) {
    setEnabled(savedEnabled);
    toggle.disabled = false;
    showStatus("Не удалось прочитать настройку. Попробуйте переключить ещё раз.", true);
  }
}

toggle.addEventListener("click", async () => {
  const requestedEnabled = toggle.getAttribute("aria-checked") !== "true";
  toggle.disabled = true;
  showStatus("Сохранение настройки…");
  try {
    await chrome.storage.local.set({ enabled: requestedEnabled });
    setEnabled(requestedEnabled);
    showStatus("");
  } catch (error) {
    setEnabled(savedEnabled);
    showStatus("Не удалось сохранить настройку. Попробуйте ещё раз.", true);
  } finally {
    toggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, "enabled")) return;
  settingChanged = true;
  setEnabled(typeof changes.enabled.newValue === "boolean" ? changes.enabled.newValue : true);
  if (!toggle.disabled) showStatus("");
});

document.documentElement.dataset.enabled = "true";
loadSetting();

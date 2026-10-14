(() => {
  "use strict";

  let latestEnabled = true;
  let waitingForRoot = false;

  function applyEnabled(enabled) {
    latestEnabled = enabled !== false;
    globalThis.KcrClassic?.setEnabled(latestEnabled);
    const root = document.documentElement;
    if (!root) {
      if (!waitingForRoot) {
        waitingForRoot = true;
        document.addEventListener("DOMContentLoaded", () => {
          waitingForRoot = false;
          applyEnabled(latestEnabled);
        }, { once: true });
      }
      return;
    }
    root.setAttribute("data-kcr-enabled", String(latestEnabled));
  }

  let settingChanged = false;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, "enabled")) return;
    settingChanged = true;
    applyEnabled(changes.enabled.newValue);
  });

  chrome.storage.local.get({ enabled: true }).then(
    settings => { if (!settingChanged) applyEnabled(settings.enabled); },
    () => { if (!settingChanged) applyEnabled(true); }
  );
})();

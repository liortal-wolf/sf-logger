// Floating "Log to SF" button anchored to the page (not Discord's DOM).
// Survives Discord SPA navigation and DOM changes — the button is appended
// directly to <body> at a fixed screen position.

export function injectButton(onClick: () => void): void {
  const ensureButton = () => {
    if (document.getElementById('dsfl-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'dsfl-btn';
    btn.textContent = '📋 Log to SF';
    btn.title = 'Capture the current selection and log to Salesforce';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483646',
      padding: '10px 14px',
      borderRadius: '8px',
      border: 'none',
      background: '#5865f2',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    document.body.appendChild(btn);
  };

  // Inject as soon as body exists, and re-inject if Discord rebuilds the DOM.
  if (document.body) {
    ensureButton();
  } else {
    document.addEventListener('DOMContentLoaded', ensureButton);
  }

  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

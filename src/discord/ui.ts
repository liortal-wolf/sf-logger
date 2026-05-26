// Injects a small "Log to SF" button into Discord's chat-header area.

export function injectButton(onClick: () => void): void {
  let injected = false;

  const tryInject = () => {
    if (injected && document.contains(document.getElementById('dsfl-btn'))) return;
    const header = document.querySelector('[role="main"] section[aria-label]');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = 'dsfl-btn';
    btn.textContent = 'Log to SF';
    btn.title = 'Capture the current selection and log to Salesforce';
    Object.assign(btn.style, {
      marginLeft: '8px',
      padding: '4px 10px',
      borderRadius: '4px',
      border: '1px solid #5865f2',
      background: '#5865f2',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '600',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    header.appendChild(btn);
    injected = true;
  };

  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });
  tryInject();
}

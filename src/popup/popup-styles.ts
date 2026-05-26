export const popupCSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dsfl-popup {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 520px;
  max-width: 90vw;
  background: #fff;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  z-index: 2147483647;
  color: #1f1f1f;
  padding: 0;
}
.dsfl-popup__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}
.dsfl-popup__header h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dsfl-popup__close {
  background: none; border: none; font-size: 22px; cursor: pointer; line-height: 1;
}
.dsfl-popup__field { padding: 12px 20px; }
.dsfl-popup__field label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #555;
}
.dsfl-popup__strategy { font-weight: 400; color: #888; font-size: 11px; }
.dsfl-popup__target { font-size: 14px; padding: 8px 10px; background: #f4f4f4; border-radius: 4px; }
.dsfl-popup__picker, .dsfl-popup__manual-id, .dsfl-popup__subject {
  width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc;
  border-radius: 4px; margin-top: 6px; box-sizing: border-box;
}
.dsfl-popup__description {
  width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #ccc;
  border-radius: 4px; font-family: monospace; box-sizing: border-box; resize: vertical;
}
.dsfl-popup__footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px; border-top: 1px solid #eee;
}
.dsfl-popup__footer button {
  padding: 8px 14px; font-size: 14px; border-radius: 4px; cursor: pointer;
  border: 1px solid #ccc; background: #fff;
}
.dsfl-popup__send {
  background: #5865f2; color: #fff; border-color: #5865f2;
}
`;

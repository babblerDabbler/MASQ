// toast.js - Simple toast notification system

// Create toast container on load
function createToastContainer() {
  if (document.getElementById('toast-container')) return;

  const container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  `;
  document.body.appendChild(container);
}

// Show toast notification
export function showToast(message, type = 'info', duration = 4000) {
  createToastContainer();
  const container = document.getElementById('toast-container');

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Set colors based on type
  const colors = {
    success: { bg: '#1a472a', border: '#2ecc71' },
    error: { bg: '#4a1a1a', border: '#e74c3c' },
    warning: { bg: '#4a3a1a', border: '#f39c12' },
    info: { bg: '#1a2a4a', border: '#3498db' }
  };
  const color = colors[type] || colors.info;

  toast.style.cssText = `
    background: ${color.bg};
    border: 2px solid ${color.border};
    border-radius: 8px;
    padding: 12px 20px;
    color: #fff;
    font-family: 'Orbitron', sans-serif;
    font-size: 14px;
    max-width: 350px;
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  `;

  // Add animation keyframes if not exists
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  toast.textContent = message;
  container.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);

  return toast;
}

// Convenience methods
export const toast = {
  success: (msg, duration) => showToast(msg, 'success', duration),
  error: (msg, duration) => showToast(msg, 'error', duration),
  warning: (msg, duration) => showToast(msg, 'warning', duration),
  info: (msg, duration) => showToast(msg, 'info', duration)
};

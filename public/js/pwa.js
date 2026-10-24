// Registers the service worker and wires any [data-install] button to the browser's install prompt.
(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let deferred = null;
  const buttons = () => document.querySelectorAll('[data-install]');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) document.documentElement.classList.add('is-installed');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    buttons().forEach((b) => { b.hidden = false; });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    buttons().forEach((b) => { b.hidden = true; });
    document.documentElement.classList.add('is-installed');
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]');
    if (!b || !deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
  });
})();

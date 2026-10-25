// Runs before styles and application startup so a saved theme never flashes light.
(() => {
  const key = 'orbit-theme';
  const choices = new Set(['system', 'light', 'dark']);
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const read = () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const stored = read();
  let preference = choices.has(stored) ? stored : 'system';
  function apply() {
    const resolved = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = resolved === 'dark' ? '#111916' : '#f5f6f2';
    const status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (status) status.content = resolved === 'dark' ? 'black-translucent' : 'default';
    document.querySelectorAll('select[data-theme-preference]').forEach((select) => {
      select.value = preference;
    });
    window.dispatchEvent(
      new CustomEvent('orbit-theme-change', { detail: { preference, resolved } }),
    );
  }
  window.orbitTheme = Object.freeze({
    getPreference: () => preference,
    setPreference(value) {
      if (!choices.has(value)) return;
      preference = value;
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Keep this session usable without storage. */
      }
      apply();
    },
  });
  system.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('select[data-theme-preference]'))
      window.orbitTheme.setPreference(event.target.value);
  });
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    const stored = read();
    preference = choices.has(stored) ? stored : 'system';
    apply();
  });
  apply();
})();

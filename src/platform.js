export const isMac = window.pageportDesktop?.platform === 'darwin' ||
  (!window.pageportDesktop && /Mac|iPhone|iPad/.test(navigator.platform));
export const shortcutLabel = label => isMac ? label
  : label.replaceAll('⇧', 'Shift+').replaceAll('⌥', 'Alt+').replaceAll('⌘', 'Ctrl+').replaceAll('↩', 'Enter');

export function navigateToHeading(editor, pos) {
  if (!editor || editor.isDestroyed) return;
  editor.commands.setTextSelection(pos + 1);
  editor.commands.focus(undefined, { scrollIntoView: false });
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const node = editor.view.nodeDOM(pos);
    const scroller = editor.view.dom.closest('.rich-document-scroll');
    if (!node || !scroller) return;
    scroller.scrollTo({ top: scroller.scrollTop + node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20 });
  });
}

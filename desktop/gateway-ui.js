const openButton = document.getElementById('open');
openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  try { await window.pageportGateway.open(); }
  catch { document.getElementById('message').textContent = '无法打开浏览器，请重新启动网关后再试。'; }
  finally { openButton.disabled = false; }
});
document.getElementById('quit').addEventListener('click', () => window.pageportGateway.quit());

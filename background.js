// ============================================
// BACKGROUND SERVICE WORKER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === 'DOWNLOAD_CLIP') {
      await downloadClip(request.blobUrl, request.filename, request.extension, request.saveAs);
      sendResponse({ status: 'downloaded' });
    } else {
      sendResponse({ status: 'unknown_action' });
    }
  })();
  return true;
});

async function downloadClip(blobUrl, filename, extension = 'webm', saveAs = false) {
  const safeName = filename
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF _-]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const finalName = `${safeName}_${timestamp}.${extension}`;

  await chrome.downloads.download({
    url: blobUrl,
    filename: finalName,
    saveAs: false
  });
}
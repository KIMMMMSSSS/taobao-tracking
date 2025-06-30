let links = [], results = [], startDate, endDate;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'startCrawl') {
    links     = msg.links;
    results   = [];
    startDate = new Date(msg.start);
    endDate   = new Date(msg.end);
    crawlNext(sender.tab.id, 0);
  }

  if (msg.action === 'detailDone') {
    results[msg.index] = msg.data;
    crawlNext(sender.tab.id, msg.index + 1);
  }
});

function crawlNext(tabId, i) {
  if (i >= links.length) {
    // 모든 데이터 수집 완료 → 다운로드
    const text = results
      .map(r => [r.waybill, r.memo, r.orderNum, r.price].join(', '))  // phone → memo로 변경
      .join('\n');
    const filename = `taobao_${startDate.toISOString().slice(0,10)}_to_${endDate.toISOString().slice(0,10)}.txt`;
    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);

    chrome.downloads.download({
      url,
      filename,
      saveAs: false
    }, downloadId => {
      if (chrome.runtime.lastError) {
        console.error('🚨 다운로드 오류:', chrome.runtime.lastError);
      } else {
        console.log('✅ 다운로드 시작, ID:', downloadId);
      }
    });
    return;
  }

  // 다음 상세 페이지로 이동
  chrome.tabs.update(tabId, { url: links[i] });
  const listener = (updatedId, info) => {
    if (updatedId === tabId && info.status === 'complete') {
      chrome.tabs.sendMessage(tabId, { action: 'scrapeDetail', index: i });
      chrome.tabs.onUpdated.removeListener(listener);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}
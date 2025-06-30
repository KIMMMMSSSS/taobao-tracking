document.getElementById('extractBtn').addEventListener('click', () => {
  const startInput = document.getElementById('dateStart').value.trim();
  const endInput   = document.getElementById('dateEnd').value.trim();
  const status = document.getElementById('status');

  // 날짜 형식 검증
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startInput) || !/^\d{4}-\d{2}-\d{2}$/.test(endInput)) {
    status.innerText = '❌ 날짜 형식이 올바르지 않습니다.';
    return;
  }

  status.innerText = '⏳ 링크 수집 중…';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: (startInput, endInput) => {
        // 전체 링크를 담을 Set (중복 자동 제거)
        let allLinksSet = new Set();
        let currentPage = 1;
        let totalPages = 1;
        
        // 날짜 범위 설정
        const startTime = new Date(startInput + 'T00:00:00');
        const endTime   = new Date(endInput   + 'T23:59:59');

        // 현재 페이지에서 링크 수집하는 함수
        function collectLinksFromCurrentPage() {
          const links = [];
          let beforeStartDate = false;  // 시작 날짜 이전 주문 발견 여부
          let afterEndDate = false;      // 종료 날짜 이후 주문 발견 여부
          
          // 더 넓은 범위로 주문 컨테이너 찾기
          const orderSelectors = [
            'div.bought-wrapper-mod__trade-order___2lrzV',
            '[data-reactid*="order-"]',
            '.trade-order',
            '.order-item',
            'div[class*="order"]'
          ];
          
          let orderDivs = [];
          for (const selector of orderSelectors) {
            orderDivs = document.querySelectorAll(selector);
            if (orderDivs.length > 0) {
              console.log(`${selector}로 ${orderDivs.length}개 주문 div 찾음`);
              break;
            }
          }
          
          // 날짜별 주문 개수 추적
          const dateOrderCount = {};
          
          orderDivs.forEach((orderDiv, index) => {
            console.log(`주문 ${index + 1} 처리 중...`);
            
            // 주문별 날짜 추출 - 다양한 클래스명 시도
            const dateSelectors = [
              'span.bought-wrapper-mod__create-time___yNWVS',
              '[class*="create-time"]',
              '[class*="time"]',
              '.date-time',
              'span[data-reactid*="time"]'
            ];
            
            let dateSpan = null;
            for (const selector of dateSelectors) {
              dateSpan = orderDiv.querySelector(selector);
              if (dateSpan) break;
            }
            
            // 날짜 필터링 (날짜를 찾았을 때만)
            if (dateSpan) {
              const match = dateSpan.textContent.match(/(\d{4}-\d{2}-\d{2})/);
              if (match) {
                const orderDateStr = match[1];
                const orderDate = new Date(orderDateStr + 'T12:00:00');
                
                // 날짜별 카운트
                dateOrderCount[orderDateStr] = (dateOrderCount[orderDateStr] || 0) + 1;
                
                if (orderDate < startTime) {
                  console.log(`시작 날짜 이전: ${orderDateStr}`);
                  beforeStartDate = true;
                  return;
                }
                
                if (orderDate > endTime) {
                  console.log(`종료 날짜 이후: ${orderDateStr}`);
                  afterEndDate = true;
                  return;
                }
                
                console.log(`날짜 범위 내: ${orderDateStr}`);
              }
            }

            // "订单详情" 링크 수집
            const allLinks = orderDiv.querySelectorAll('a');
            console.log(`주문 ${index + 1}에서 ${allLinks.length}개 링크 발견`);
            
            allLinks.forEach(a => {
              const linkText = a.textContent.trim();
              let href = a.getAttribute('href');
              
              if (linkText === '订单详情' || linkText === '주문상세') {
                console.log(`"订单详情" 링크 발견: ${href}`);
                
                if (!href) return;
                
                // URL 정규화
                if (href.startsWith('//')) {
                  href = 'https:' + href;
                } else if (!href.startsWith('http')) {
                  href = new URL(href, location.origin).href;
                }
                
                // 타오바오/티몰 주문 상세 링크인지 확인 (둘 다 포함)
                if ((href.includes('buyertrade.taobao.com') && href.includes('trade_item_detail.htm')) ||
                    (href.includes('trade.tmall.com') && href.includes('orderDetail.htm'))) {
                  
                  links.push(href);
                  console.log(`링크 수집: ${href}`);
                }
              }
            });
          });
          
          console.log(`현재 페이지 날짜별 주문 분포:`, dateOrderCount);
          console.log(`현재 페이지에서 ${links.length}개 링크 수집됨`);
          
          return {
            links,
            beforeStartDate,
            afterEndDate,
            shouldContinue: !beforeStartDate  // 시작 날짜 이전 주문이 없으면 계속
          };
        }

        // 페이지네이션 정보 가져오기
        function getPaginationInfo() {
          // 현재 URL에서 페이지 정보 확인
          const urlParams = new URLSearchParams(window.location.search);
          const currentPageFromUrl = parseInt(urlParams.get('page')) || 1;
          
          // 페이지네이션 요소들 찾기
          const paginationSelectors = [
            '.pagination-item',
            '[class*="pagination"]',
            '.page-item',
            '[data-reactid*="pagination"]',
            'li[title]'
          ];
          
          let paginationItems = [];
          for (const selector of paginationSelectors) {
            paginationItems = document.querySelectorAll(selector);
            if (paginationItems.length > 0) {
              console.log(`${selector}로 ${paginationItems.length}개 페이지네이션 아이템 찾음`);
              break;
            }
          }
          
          if (paginationItems.length === 0) {
            console.log('페이지네이션 없음, 단일 페이지로 처리');
            return { currentPage: 1, totalPages: 1 };
          }
          
          let maxPage = 1;
          let currentPage = currentPageFromUrl;
          
          paginationItems.forEach(item => {
            const pageNumFromTitle = parseInt(item.getAttribute('title'));
            const pageNumFromText = parseInt(item.textContent.trim());
            const pageNum = pageNumFromTitle || pageNumFromText;
            
            if (!isNaN(pageNum) && pageNum > maxPage) {
              maxPage = pageNum;
            }
            
            // 현재 페이지 확인
            const classList = item.className || '';
            if (classList.includes('active') || classList.includes('current') || classList.includes('selected')) {
              currentPage = pageNum || currentPage;
            }
          });
          
          console.log(`페이지네이션 정보: 현재 ${currentPage}, 전체 ${maxPage}`);
          return { currentPage, totalPages: maxPage };
        }

        // 페이지 로딩 완료 대기 함수
        function waitForPageLoad(pageNum, maxWaitTime = 10000) {
          return new Promise((resolve) => {
            const startTime = Date.now();
            let lastOrderCount = 0;
            let stableCount = 0;
            
            const checkInterval = setInterval(() => {
              const elapsedTime = Date.now() - startTime;
              
              // 최대 대기 시간 초과
              if (elapsedTime > maxWaitTime) {
                clearInterval(checkInterval);
                console.log(`페이지 ${pageNum} 로딩 타임아웃 (${maxWaitTime/1000}초)`);
                resolve(true);
                return;
              }
              
              // 주문 요소 개수 확인
              const currentOrderCount = document.querySelectorAll(
                'div.bought-wrapper-mod__trade-order___2lrzV, [data-reactid*="order-"], .trade-order, .order-item'
              ).length;
              
              // URL 확인
              const urlParams = new URLSearchParams(window.location.search);
              const currentUrlPage = parseInt(urlParams.get('page')) || 1;
              
              // 페이지 번호가 URL에 반영되고 주문 요소가 로드되었는지 확인
              if (currentUrlPage === pageNum && currentOrderCount > 0) {
                // 주문 개수가 안정적으로 유지되는지 확인
                if (currentOrderCount === lastOrderCount) {
                  stableCount++;
                  
                  // 2회 연속 같은 개수면 로딩 완료로 판단
                  if (stableCount >= 2) {
                    clearInterval(checkInterval);
                    console.log(`페이지 ${pageNum} 로딩 완료 (${elapsedTime}ms, ${currentOrderCount}개 주문)`);
                    resolve(true);
                    return;
                  }
                } else {
                  stableCount = 0;
                }
                
                lastOrderCount = currentOrderCount;
              }
              
              // 진행 상황 메시지
              if (elapsedTime % 1000 < 100) {  // 약 1초마다
                chrome.runtime.sendMessage({
                  action: 'updateStatus',
                  message: `페이지 ${pageNum} 로딩 중... (${Math.floor(elapsedTime/1000)}초)`
                });
              }
            }, 100);  // 100ms마다 체크
          });
        }

        // 다음 페이지로 이동하는 함수
        function goToNextPage(pageNum) {
          return new Promise(async (resolve) => {
            console.log(`페이지 ${pageNum}로 이동 시도`);
            
            // 1. title 속성으로 찾기
            let nextPageLink = document.querySelector(`li[title="${pageNum}"] a`);
            
            // 2. 클래스명으로 찾기
            if (!nextPageLink) {
              nextPageLink = document.querySelector(`.pagination-item-${pageNum} a`);
            }
            
            // 3. 텍스트로 찾기
            if (!nextPageLink) {
              const allPaginationLinks = document.querySelectorAll('.pagination-item a, [class*="pagination"] a');
              for (const link of allPaginationLinks) {
                if (link.textContent.trim() === pageNum.toString()) {
                  nextPageLink = link;
                  break;
                }
              }
            }
            
            // 4. href에서 page 파라미터로 찾기
            if (!nextPageLink) {
              const allLinks = document.querySelectorAll('a[href*="page="]');
              for (const link of allLinks) {
                const href = link.getAttribute('href');
                if (href.includes(`page=${pageNum}`)) {
                  nextPageLink = link;
                  break;
                }
              }
            }
            
            if (nextPageLink) {
              console.log(`페이지 ${pageNum} 링크 찾음:`, nextPageLink.href);
              
              // 현재 주문 개수 저장 (변화 감지용)
              const beforeOrderCount = document.querySelectorAll(
                'div.bought-wrapper-mod__trade-order___2lrzV, [data-reactid*="order-"], .trade-order, .order-item'
              ).length;
              
              nextPageLink.click();
              
              // 페이지 로딩 대기
              const loaded = await waitForPageLoad(pageNum);
              resolve(loaded);
            } else {
              console.log(`페이지 ${pageNum} 링크를 찾을 수 없음`);
              resolve(false);
            }
          });
        }

        // 메인 수집 함수
        async function collectAllPages() {
          const paginationInfo = getPaginationInfo();
          totalPages = paginationInfo.totalPages;
          currentPage = paginationInfo.currentPage;
          
          console.log(`전체 ${totalPages}페이지, 현재 ${currentPage}페이지에서 시작`);
          
          // 현재 페이지부터 마지막 페이지까지 처리
          for (let page = currentPage; page <= totalPages; page++) {
            console.log(`=== 페이지 ${page}/${totalPages} 처리 중 ===`);
            
            // 상태 업데이트 메시지 전송
            chrome.runtime.sendMessage({
              action: 'updateStatus',
              message: `페이지 ${page}/${totalPages} 수집 중... (총 ${allLinksSet.size}개 수집됨)`
            });

            // 현재 페이지의 링크 수집
            const pageResult = collectLinksFromCurrentPage();
            const pageLinks = pageResult.links;
            
            // Set에 추가 (중복 자동 제거)
            const beforeSize = allLinksSet.size;
            pageLinks.forEach(link => allLinksSet.add(link));
            const newLinks = allLinksSet.size - beforeSize;
            
            console.log(`페이지 ${page} 완료. 새로운 링크 ${newLinks}개, 총 ${allLinksSet.size}개`);
            
            // 날짜 범위를 벗어났는지 확인
            if (!pageResult.shouldContinue) {
              console.log(`날짜 범위를 벗어난 주문 발견. 수집 종료.`);
              chrome.runtime.sendMessage({
                action: 'updateStatus',
                message: `날짜 범위 도달. 페이지 ${page}에서 수집 완료 (총 ${allLinksSet.size}개)`
              });
              break;
            }

            // 다음 페이지로 이동 (마지막 페이지가 아닌 경우)
            if (page < totalPages) {
              const success = await goToNextPage(page + 1);
              if (!success) {
                console.log(`페이지 ${page + 1}로 이동 실패, 수집 중단`);
                break;
              }
              
              // 페이지 전환 후 약간의 추가 안정화 시간
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          // Set을 배열로 변환
          const finalLinks = Array.from(allLinksSet);
          console.log(`최종 수집 완료: ${finalLinks.length}개 고유 링크`);

          // 수집 완료 후 백그라운드로 전송
          chrome.runtime.sendMessage({
            action: 'startCrawl',
            start: startInput,
            end: endInput,
            links: finalLinks
          });

          return finalLinks.length;
        }

        // 비동기 수집 시작
        return collectAllPages();
      },
      args: [startInput, endInput]
    }, (results) => {
      if (results[0]?.result) {
        results[0].result.then(count => {
          status.innerText = `✅ ${startInput}~${endInput} 전체 ${count}건 링크 수집 완료, 크롤링 시작…`;
        });
      }
    });
  });
});

// 백그라운드에서 상태 업데이트 메시지를 받기 위한 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateStatus') {
    const status = document.getElementById('status');
    if (status) {
      status.innerText = '⏳ ' + message.message;
    }
  }
});
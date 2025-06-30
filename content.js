chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action !== 'scrapeDetail') return;
  
  // 사이트 감지 (T몰 vs 타오바오)
  const isTmall = location.hostname.includes('tmall.com');
  const isTaobao = location.hostname.includes('taobao.com');
  
  // 1) 주문번호 추출
  let orderNum = new URL(location.href).searchParams.get('biz_order_id')
              || new URL(location.href).searchParams.get('bizOrderId')
              || new URL(location.href).searchParams.get('trade_id')
              || '';
              
  if (!orderNum) {
    // 타오바오/알리바바 방식
    const dtEl = Array.from(document.querySelectorAll('dt'))
      .find(el => /订单编号/.test(el.textContent));
    if (dtEl && dtEl.nextElementSibling) {
      const text = dtEl.nextElementSibling.textContent.split('更多')[0];
      const tokens = text.trim().split(/[\s,,、]+/);
      orderNum = tokens.find(t => /^[A-Z0-9]{6,}$/.test(t)) || '';
    }
    
    // T몰 방식 - ui-trade-label 클래스에서 주문번호 패턴 찾기
    if (!orderNum && isTmall) {
      // 주문번호는 보통 19자리 숫자
      const labels = Array.from(document.querySelectorAll('span.ui-trade-label'));
      for (const label of labels) {
        const text = label.textContent.trim();
        // 19자리 숫자 패턴 체크
        if (/^\d{19}$/.test(text)) {
          orderNum = text;
          break;
        }
      }
      
      // 다른 셀렉터들도 시도
      const tmallSelectors = [
        '.order-number',
        '.trade-id',
        '[data-spm*="order"]',
        '.order-info .order-id',
        '.detail-order-number'
      ];
      
      if (!orderNum) {
        for (const selector of tmallSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const match = el.textContent.match(/\d{19}/);
            if (match) {
              orderNum = match[0];
              break;
            }
          }
        }
      }
    }
  }
  
  if (!orderNum) {
    console.log('주문번호를 찾을 수 없습니다');
    return; // 주문번호 없으면 스킵
  }
  
  // 2) 메모 내용 전체 추출 (전화번호 대신)
  let memo = 'N/A';
  
  // T몰에서 메모 찾기
  if (isTmall) {
    // T몰 메모 관련 셀렉터들
    const tmallMemoSelectors = [
      '.buyer-message',
      '.order-memo',
      '.customer-note',
      '.trade-memo',
      '.buyer-remark',
      '[class*="memo"]',
      '[class*="message"]',
      '[class*="remark"]'
    ];
    
    for (const selector of tmallMemoSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        memo = el.textContent.trim();
        break;
      }
    }
  }
  
  // 타오바오 방식 - 买家留言 찾기
  if (memo === 'N/A') {
    Array.from(document.querySelectorAll('dt')).some(dt => {
      if (!/买家留言/.test(dt.textContent)) return false;
      const dd = dt.nextElementSibling;
      if (!dd) return false;
      // 메모 내용 전체를 가져옴 (更多 버튼 앞까지)
      memo = dd.textContent.split('更多')[0].trim();
      return true;
    });
  }
  
  // 3) 운송장 번호: 알파벳 대문자+숫자 8자 이상
  let waybill = '';
  
  // T몰에서 운송장 번호 찾기
  if (isTmall) {
    // 먼저 span 태그들에서 운송장 번호 패턴 찾기
    const spans = Array.from(document.querySelectorAll('span'));
    for (const span of spans) {
      const text = span.textContent.trim();
      // 운송장 번호는 보통 10자리 이상의 숫자
      if (/^\d{10,}$/.test(text)) {
        waybill = text;
        break;
      }
    }
    
    // data-spm-anchor-id가 있는 span에서도 찾기
    if (!waybill) {
      const spmSpans = Array.from(document.querySelectorAll('span[data-spm-anchor-id]'));
      for (const span of spmSpans) {
        const text = span.textContent.trim();
        if (/^\d{10,}$/.test(text)) {
          waybill = text;
          break;
        }
      }
    }
  }
  
  // 기존 방식들
  if (!waybill) {
    Array.from(document.querySelectorAll('th')).some(th => {
      if (!/(运单号码|运单号|快递单号|物流单号)/.test(th.textContent)) return false;
      const td = th.parentElement.querySelector('td');
      if (!td) return false;
      const codes = td.textContent.match(/\b[A-Z0-9]{8,}\b/g);
      if (codes) {
        waybill = codes[0].trim();
        return true;
      }
      return false;
    });
  }
  
  if (!waybill) {
    const pkg = document.querySelector('.package-detail');
    if (pkg) {
      const codes = pkg.textContent.match(/\b[A-Z0-9]{8,}\b/g);
      if (codes) waybill = codes[0].trim();
    }
  }
  
  if (!waybill) {
    const spanNum = Array.from(document.querySelectorAll('span.ui-trade-label'))
      .find(s => /\b[A-Z0-9]{8,}\b/.test(s.textContent));
    if (spanNum) waybill = spanNum.textContent.trim();
  }
  
  // T몰 운송장 번호 추가 셀렉터
  if (!waybill && isTmall) {
    const tmallWaybillSelectors = [
      '.logistics-number',
      '.tracking-number',
      '.express-number',
      '.shipping-code',
      '.delivery-number',
      '[class*="waybill"]',
      '[class*="tracking"]'
    ];
    
    for (const selector of tmallWaybillSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const codes = el.textContent.match(/\b[A-Z0-9]{8,}\b/g);
        if (codes) {
          waybill = codes[0].trim();
          break;
        }
      }
    }
  }
  
  if (!waybill) waybill = 'N/A';
  
  // 4) 실결제액
  let price = 'N/A';
  
  // T몰에서 가격 찾기 - ui-trade-label에서 통화 기호로 찾기
  if (isTmall) {
    const labels = Array.from(document.querySelectorAll('span.ui-trade-label'));
    for (const label of labels) {
      const text = label.textContent.trim();
      // USD 또는 ¥로 시작하는 가격 패턴
      if (/^(?:USD|¥)\s*[\d,]+\.?\d*/.test(text)) {
        price = text;
        break;
      }
    }
    
    // 특별히 스타일이 적용된 가격 찾기 (빨간색, 굵은 글씨)
    if (price === 'N/A') {
      const priceLabels = Array.from(document.querySelectorAll('span.ui-trade-label[style*="color"]'));
      for (const label of priceLabels) {
        const text = label.textContent.trim();
        if (/^(?:USD|¥)\s*[\d,]+\.?\d*/.test(text)) {
          price = text;
          break;
        }
      }
    }
  }
  
  // 기존 방식
  if (price === 'N/A') {
    const strong = document.querySelector('div.pay-info-mod__get-money___38iPX strong');
    if (strong) {
      price = strong.textContent.split('更多')[0].trim();
    } else {
      const mix = Array.from(document.querySelectorAll('span.ui-trade-label'))
        .find(s => /^(?:¥|USD)/.test(s.textContent));
      if (mix) price = mix.textContent.split('更多')[0].trim();
    }
  }
  
  // T몰 가격 추가 셀렉터
  if (price === 'N/A' && isTmall) {
    const tmallPriceSelectors = [
      '.actual-fee',
      '.pay-amount',
      '.total-amount',
      '.final-price',
      '.order-amount',
      '[class*="price"]',
      '[class*="amount"]',
      '[class*="fee"]'
    ];
    
    for (const selector of tmallPriceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceMatch = el.textContent.match(/(?:¥|USD)\s*[\d,]+\.?\d*/);
        if (priceMatch) {
          price = priceMatch[0].split('更多')[0].trim();
          break;
        }
      }
    }
  }
  
  // 5) 디버깅 정보 출력
  console.log('스크레이핑 결과:', {
    orderNum,
    memo,  // phone 대신 memo
    waybill,
    price,
    site: isTmall ? 'tmall' : isTaobao ? 'taobao' : 'unknown'
  });
  
  // 6) 결과 전송
  chrome.runtime.sendMessage({
    action: 'detailDone',
    index: msg.index,
    data: { 
      orderNum, 
      memo,  // phone 대신 memo
      waybill, 
      price,
      site: isTmall ? 'tmall' : isTaobao ? 'taobao' : 'unknown'
    }
  });
});
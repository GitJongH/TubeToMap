// 설명란 텍스트에서 "장소 이름 + Google 지도 링크"를 뽑아낸다. 브라우저/Node 양쪽에서 사용.
(function (root) {
  // 후보 추출용(느슨한 정규식). 실제로 지도 링크인지는 isMapUrl이 호스트를 정확히 검사해서 결정한다.
  const MAP_URL =
    /https?:\/\/(?:maps\.app\.goo\.gl\/[^\s]+|goo\.gl\/maps\/[^\s]+|(?:www\.)?google\.[a-z.]+\/maps[^\s]*|maps\.google\.[a-z.]+[^\s]*)/gi;

  // google.com, google.co.kr, google.com.br, google.de 등 (www./maps. 접두 허용)
  const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2})$/;

  // 링크 뒤에 붙은 문장부호(영문/한글/전각)를 떼어 낸다.
  function cleanUrl(url) {
    return url.replace(/[)\].,;!?'"」』>。、，]+$/u, '');
  }

  function cleanName(text) {
    return text
      .replace(/^[\s\-–—:·•▶▷►📍🔽🔼]+/u, '')
      .replace(/[\s\-–—:·•]+$/u, '')
      .trim();
  }

  function hasMapUrl(line) {
    MAP_URL.lastIndex = 0;
    return MAP_URL.test(line);
  }

  // 진짜 Google 지도 링크인지 호스트까지 정확히 검사한다.
  // "google.evil.com/maps", "maps.google.com@evil.com/x"(userinfo 속임수) 같은 것은 거부한다.
  function isMapUrl(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'maps.app.goo.gl') return u.pathname.length > 1;
    if (host === 'goo.gl') return u.pathname.startsWith('/maps/');
    if (GOOGLE_HOST.test(host)) return host.startsWith('maps.') || u.pathname.startsWith('/maps');
    return false;
  }

  // 반환: [{ name, url }] (URL 기준 중복 제거, 등장 순서 유지, http는 https로 통일)
  function parseDescription(text) {
    const lines = String(text || '').split(/\r?\n/);
    const seen = new Set();
    const places = [];
    lines.forEach((line, i) => {
      const urls = line.match(MAP_URL);
      if (!urls) return;
      let name = cleanName(line.replace(MAP_URL, ' '));
      // 이름이 윗줄에 따로 적힌 경우: 지도 링크가 없는 바로 윗줄을 이름으로 사용
      if (!name && i > 0 && !hasMapUrl(lines[i - 1])) name = cleanName(lines[i - 1]);
      urls.forEach((raw) => {
        const cleaned = cleanUrl(raw);
        if (!isMapUrl(cleaned)) return;
        const url = cleaned.replace(/^http:/i, 'https:');
        if (seen.has(url)) return;
        seen.add(url);
        places.push({ name: name || url, url });
      });
    });
    return places;
  }

  // 유튜브 주소에서 영상 ID를 뽑는다. watch 페이지가 아니거나 ID 형식(11자)이 아니면 null.
  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)youtube\.com$/.test(u.hostname) || u.pathname !== '/watch') return null;
      const id = u.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  const api = { parseDescription, getVideoId, isMapUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GMLParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

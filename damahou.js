// 大马猴影视 JSBox 封装
const config = {
  host: "https://dmhyy.com",
  timeout: 15000
};
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "x-platform": "web",
  "x-requested-with": "XMLHttpRequest"
};

/** 文本清洗 */
function textClean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @description 搜索大马猴
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码
 * @returns {Promise<Array>} 结果列表
 */
async function damaHouSearch(keyword, page = 1) {
  const wd = encodeURIComponent(textClean(keyword));
  const url = `${config.host}/api.php/web/search/index?wd=${wd}&page=${page}`;
  const referer = `${config.host}/search?keyword=${wd}`;
  const resp = await $http.get({
    url: url,
    header: { ...headers, Referer: referer },
    timeout: config.timeout
  });
  if (resp.error) return [];

  // 修复：接口有可能返回字符串JSON，先解析
  let raw = resp.data;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (e) { return []; }
  }
  const json = raw?.data || [];
  console.log("搜索原始data：", json);

  const out = [];
  if (!Array.isArray(json)) return out;
  json.forEach(item => {
    console.log(item)
    out.push({
      vodId: String(item.vod_id),
      title: textClean(item.vod_name),
      pic: textClean(item.vod_pic || ""),
      remark: textClean(item.vod_remarks || "")
    });
  })
  console.log(out)
  return out;
}

/**
 * 获取聚合播放线路（优先m3u8直链）
 * @param {string|number} vodId
 * @returns {Promise<Array<{name:string,url:string}>>} sources
 */
async function damaHouGetSources(vodId) {
  vodId = String(vodId);
  const sources = [];
  const seen = new Set();
  const refererPlay = `${config.host}/play/${vodId}`;

  // 判断是否视频直链
  function isVideoUrl(u) {
    return /\.(m3u8|mp4|flv|mkv|avi)(\?|#|$)/i.test(String(u));
  }

  // 1. 聚合接口 internal/search_aggregate
  const aggUrl = `${config.host}/api.php/web/internal/search_aggregate?vod_id=${encodeURIComponent(vodId)}`;
  let aggResp = await $http.get({
    url: aggUrl,
    header: { ...headers, Referer: refererPlay },
    timeout: config.timeout
  });
  let aggList = [];
  if (!aggResp.error) {
    let d = aggResp.data.data;
    console.log('search_aggregate:',d)
    if (typeof d === "string") try { d = JSON.parse(d); } catch (e) { }
    aggList = Array.isArray(d) ? d : (Array.isArray(d?.list) ? d.list : []);
  }

  for (const src of aggList) {
    const playUrl = textClean(src?.vod_play_url ?? "");
    if (!playUrl || !isVideoUrl(playUrl)) continue;
    const lineName = textClean(src?.site_name || src?.external_display_name || src?.vod_play_from || "线路");
    const key = `${lineName}||${playUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ name: lineName, url: playUrl });
    if (sources.length >= 4) break;
  }

  // 2. 兜底 get_detail
  if (sources.length < 2) {
    const detailUrl = `${config.host}/api.php/web/vod/get_detail?vod_id=${encodeURIComponent(vodId)}`;
    let detResp = await $http.get({
      url: detailUrl,
      header: { ...headers, Referer: refererPlay },
      timeout: config.timeout
    });
    if (!detResp.error) {
      let d = detResp.data.data;
      console.log('get_detail:',d)
      if (typeof d === "string") try { d = JSON.parse(d); } catch (e) { }
      const detail = Array.isArray(d?.list) ? d.list[0] : null;
      if (detail) {
        const pf = textClean(detail.vod_play_from || "");
        const pu = textClean(detail.vod_play_url || "");
        if (pf && pu) {
          const fromArr = pf.split("$$$");
          const urlArr = pu.split("$$$");
          for (let j = 0; j < fromArr.length; j++) {
            const f = textClean(fromArr[j]);
            const u = textClean(urlArr[j] ?? "");
            if (!f || !u || !isVideoUrl(u)) continue;
            const key = `${f}||${u}`;
            if (seen.has(key)) continue;
            seen.add(key);
            sources.push({ name: f, url: u });
            if (sources.length >= 4) break;
          }
        }
      }
    }
  }
  return sources;
}


/**
 * 自动搜索影片，**全部搜索结果id都去拿资源，合并返回**
 * @param {string} title 影片名称
 * @returns {Promise<Array<{name:string,url:string,vodId:string,vodTitle:string}>>}
 */
async function damaHouLoadResource(title) {
  const searchRes = await damaHouSearch(title, 1);
  if (!searchRes.length) return [];

  let allSources = [];
  // 循环每一条搜索结果，每个vodId都调用解析
  for (const item of searchRes) {
    console.log("正在解析ID:", item.vodId, "片名：", item.title);
    const srcList = await damaHouGetSources(item.vodId);
    // 给源附加所属影片id和标题，区分是哪一部片子的线路
    const attachInfo = srcList.map(s => {
      return {
        ...s,
        vodId: item.vodId,
        vodTitle: item.title
      }
    })
    allSources = allSources.concat(attachInfo);
  }
  return allSources;
}


// ============【示例调用】JSBox 直接运行测试 ============
(async () => {
  //$ui.alert("开始测试搜索");
  // 1.搜索
  //const list = await damaHouSearch("仙逆", 1);
 // console.log(list);

  // 方式1：旧逻辑，只拿第一条
  // if (list.length > 0) {
  //   const srcs = await damaHouGetSources(list[0].vodId);
  //   console.log("第一条播放源：", srcs);
  //   $ui.alert(JSON.stringify(srcs, null, 2));
  // }

  // 方式2：新函数，全部id都解析，合并所有线路
  const allSrc = await damaHouLoadResource("仙逆");
  console.log("全部解析完成，合并所有线路：", allSrc);
 // $ui.alert(JSON.stringify(allSrc, null, 2));

})();

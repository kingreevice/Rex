WidgetMetadata = {
  id: "forward.damahou.jianpianStyle",
  title: "大马猴影视‑修复聚合接口层级+分割$前缀",
  version: "1.8.0",
  requiredVersion: "0.0.1",
  description: "修复聚合接口嵌套层级，处理vod_play_url的$分隔前缀；输出格式对齐荐片影院",
  author: "convert from jsbox",
  site: "https://dmhyy.com",
  detailCacheDuration: 3600,
  globalParams: [
    { name: "host", title: "站点地址", type: "input", value: "https://dmhyy.com" }
  ],
  modules: [
    {
      id: "loadResource",
      title: "大马猴影视",
      description: "自动匹配资源，格式对齐荐片",
      functionName: "loadResource",
      type: "stream",
      cacheDuration: 3600,
      params: []
    }
  ],
  search: {
    title: "搜索大马猴影视",
    functionName: "search",
    params: [
      { name: "keyword", title: "关键词", type: "input", value: "" },
      { name: "page", title: "页码", type: "page", value: "1" }
    ]
  }
};

var MH_RUNTIME_PARAMS = {};
var MH_SEARCH_CACHE = {};
var MH_RESOURCE_CACHE = {};

var MH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "x-platform": "web",
  "x-requested-with": "XMLHttpRequest"
};

// ======== 日志工具，完全模仿荐片影院 ========
function logInfo(message, data = null) {
  if (data) {
    console.log(`[大马猴] ${message}:`, JSON.stringify(data));
  } else {
    console.log(`[大马猴] ${message}`);
  }
}
function logError(message, error = null) {
  if (error) {
    console.error(`[大马猴] ${message}:`, error.message || error);
  } else {
    console.error(`[大马猴] ${message}`);
  }
}

function mhText(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function mhHost(params) {
  return String((params && params.host) || MH_RUNTIME_PARAMS.host || "https://dmhyy.com").replace(/\/+$/, "");
}

function mhSyncParams(params) {
  params = params || {};
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) MH_RUNTIME_PARAMS[k] = params[k];
  }
}

async function mhHttpGet(url, referer, timeoutMs) {
  var h = Object.assign({}, MH_HEADERS, { Referer: referer || mhHost() + "/" });
  var resp = await Widget.http.get(url, { headers: h, timeout: timeoutMs || 15000 });

  let body = resp.data;
  if (typeof body === "string") {
    logInfo("http返回字符串，执行JSON解析");
    try {
      body = JSON.parse(body);
    } catch (e) {
      logError("JSON解析失败", e);
      return {};
    }
  } else if (typeof body === "object" && body !== null) {
    logInfo("http返回已经是js对象");
  } else {
    logError("http返回无效类型:" + typeof body);
    return {};
  }
  logInfo("接口返回code:" + body.code);
  return body;
}

async function mhSearchApi(keyword, page, params) {
  var host = mhHost(params);
  var wd = encodeURIComponent(mhText(keyword));
  var pg = Number(page || 1);
  var url = host + "/api.php/web/search/index?wd=" + wd + "&page=" + pg;
  var jsonObj = await mhHttpGet(url, host + "/search?keyword=" + wd);
  return jsonObj;
}

async function mhGetDetailApi(vodId, params) {
  var host = mhHost(params);
  var url = host + "/api.php/web/vod/get_detail?vod_id=" + encodeURIComponent(String(vodId));
  var jsonObj = await mhHttpGet(url, host + "/play/" + vodId);
  return jsonObj;
}

async function mhAggregateApi(vodId, params) {
  var host = mhHost(params);
  var url = host + "/api.php/web/internal/search_aggregate?vod_id=" + encodeURIComponent(String(vodId));
  var jsonObj = await mhHttpGet(url, host + "/play/" + vodId);
  return jsonObj;
}

function mhConvertVodItem(item) {
  if (!item || !item.vod_id || !item.vod_name) return null;
  return {
    id: String(item.vod_id),
    type: "vod",
    mediaType: "movie",
    title: mhText(item.vod_name),
    posterPath: mhText(item.vod_pic || ""),
    backdropPath: mhText(item.vod_pic || ""),
    description: mhText(item.vod_remarks || ""),
    vodId: String(item.vod_id)
  };
}

async function search(params) {
  mhSyncParams(params);
  var keyword = mhText(params.keyword || "");
  var page = Number(params.page || 1);
  if (!keyword) return [];

  var cacheKey = mhHost(params) + "::" + keyword + "::" + page;
  if (MH_SEARCH_CACHE[cacheKey]) return MH_SEARCH_CACHE[cacheKey];

  var jsonResp = await mhSearchApi(keyword, page, params);
  var rawList = Array.isArray(jsonResp.data) ? jsonResp.data : [];
  logInfo(`搜索【${keyword}】原始结果数量:${rawList.length}`);

  var list = [];
  for(var i=0;i<rawList.length;i++){
    var o = mhConvertVodItem(rawList[i]);
    if(o) list.push(o);
  }
  logInfo(`搜索输出条目数量:${list.length}`);
  MH_SEARCH_CACHE[cacheKey] = list;
  return list;
}

/** 判断是否有效视频直链 */
function isVideoUrl(url) {
  var u = String(url||"");
  return /\.(m3u8|mp4)(\?|#|$)/i.test(u);
}

/**
 * 处理带$分隔的播放地址："正片$https://xxx.m3u8" → 返回url部分
 */
function stripPlayUrlPrefix(rawStr){
  const s = mhText(rawStr);
  if(s.includes("$")){
    const parts = s.split("$");
    return parts[parts.length-1].trim();
  }
  return s;
}

/**
 * 构建source对象，完全对齐荐片字段
 * @param {string} uniqueKey 防重复key
 * @param {string} lineName 线路名
 * @param {string} playUrl 播放地址
 * @param {string} vodTitle 影片标题
 * @param {"movie"|"tv"} mediaType
 * @param {number|null} epNum 集数
 */
function buildSourceItem(uniqueKey, lineName, playUrl, vodTitle, mediaType, epNum){
  let desc;
  if(epNum !== null && Number.isInteger(epNum)){
    desc = `${vodTitle} 第${epNum}集 [${lineName}]`;
  }else{
    desc = `${vodTitle} [${lineName}]`;
  }
  // 全局唯一id：key+随机时间戳，模仿荐片
  const finalId = `mh_${uniqueKey}_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  return {
    id: finalId,
    name: lineName,
    type: mediaType,
    description: desc,
    url: playUrl
  };
}

/**
 * 解析单个vodId，双接口同时拿线路，合并去重
 */
async function parseSingleVodSources(vodId, vodTitle, mediaType, targetEpNum, params) {
  logInfo(`开始解析 vodId=${vodId} title=${vodTitle} type=${mediaType} ep=${targetEpNum??"无"}`);
  const sources = [];
  const seenKeySet = new Set();

  // =========接口1 aggregate聚合接口【修复：data直接是数组，不再 .data.data】 =========
  const aggResp = await mhAggregateApi(vodId, params);
  logInfo("聚合接口返回", aggResp);
  const aggList = Array.isArray(aggResp.data) ? aggResp.data : [];
  logInfo(`聚合接口线路数组长度:${aggList.length}`);

  for(let i=0;i<aggList.length;i++){
    const src = aggList[i];
    const rawPlayStr = mhText(src.vod_play_url || "");
    const playUrl = stripPlayUrlPrefix(rawPlayStr); // 切掉"正片$"前缀
    const lineName = mhText(src.site_name || src.external_display_name || src.vod_play_from || "大马猴聚合线路");
    logInfo(`聚合原始字符串:${rawPlayStr} → 处理后url:${playUrl}`);
    if(!playUrl) continue;
    if(!isVideoUrl(playUrl)){
      logInfo(`聚合线路过滤非视频url:${playUrl}`);
      continue;
    }
    const dedupKey = `${lineName}||${playUrl}`;
    if(seenKeySet.has(dedupKey)) continue;
    seenKeySet.add(dedupKey);
    sources.push(buildSourceItem(dedupKey, lineName, playUrl, vodTitle, mediaType, targetEpNum));
    if(sources.length >=6) break;
  }

  // =========接口2 get_detail详情接口兜底 =========
  const detResp = await mhGetDetailApi(vodId, params);
  logInfo("detail接口返回", detResp);
  const detailList = (detResp.data && detResp.data.data && Array.isArray(detResp.data.data.list)) ? detResp.data.data.list : [];
  const detail = detailList[0] || null;
  if(detail){
    const pf = mhText(detail.vod_play_from || "");
    const puRaw = mhText(detail.vod_play_url || "");
    logInfo(`detail线路字段 pf=${pf} puRaw=${puRaw}`);
    if(pf && puRaw){
      const fromArr = pf.split("$$$");
      const urlArr = puRaw.split("$$$");
      for(let j=0;j<fromArr.length;j++){
        const f = mhText(fromArr[j]);
        const rawU = mhText(urlArr[j] ?? "");
        const u = stripPlayUrlPrefix(rawU);
        if(!f || !u) continue;
        if(!isVideoUrl(u)){
          logInfo(`detail过滤非视频url:${u}`);
          continue;
        }
        const dedupKey = `${f}||${u}`;
        if(seenKeySet.has(dedupKey)) continue;
        seenKeySet.add(dedupKey);
        sources.push(buildSourceItem(dedupKey, f, u, vodTitle, mediaType, targetEpNum));
        if(sources.length >=6) break;
      }
    }
  }

  logInfo(`单vod合并后有效source数量：${sources.length}`);
  return sources;
}

function buildSearchKeywords(params) {
  const kwSet = new Set();
  function add(s){ s=mhText(s); if(s) kwSet.add(s); }
  add(params.title); add(params.seriesName); add(params.name);
  return Array.from(kwSet);
}

/**
 * Rex核心loadResource入口，完全对齐荐片参数风格
 */
async function loadResource(params) {
  mhSyncParams(params);
  // 兼容多种名字字段
  let seriesName = params?.seriesName || params?.title || params?.name || params?.keyword;
  let mediaType = params?.type === 'movie' ? 'movie' : 'tv';
  let targetEpisode = params?.episode ? parseInt(params.episode,10) : null;

  logInfo(`loadResource触发，标题:${seriesName} 类型:${mediaType} 目标集数:${targetEpisode??"无"}`);

  if (!seriesName) {
    logError("loadResource缺少影片名称");
    return [];
  }

  const keywords = buildSearchKeywords(params);
  if(!keywords.length) return [];

  let outAllSources = [];
  const cacheKey = mhHost(params)+"::"+keywords.join("||")+"::"+mediaType+"::"+(targetEpisode??"null");
  if(MH_RESOURCE_CACHE[cacheKey]){
    logInfo("命中资源缓存，直接返回");
    return MH_RESOURCE_CACHE[cacheKey];
  }

  for(let ki=0;ki<keywords.length;ki++){
    const kw = keywords[ki];
    const searchResult = await search({keyword:kw,page:1});
    if(!searchResult || !searchResult.length) continue;

    for(let si=0;si<searchResult.length;si++){
      const vodItem = searchResult[si];
      const subSources = await parseSingleVodSources(vodItem.vodId, vodItem.title, mediaType, targetEpisode, params);
      outAllSources = outAllSources.concat(subSources);
    }
    if(outAllSources.length>0) break;
  }

  // 全局再一次url去重（模仿荐片）
  const urlSet = new Set();
  const finalOut = [];
  for(const src of outAllSources){
    if(!urlSet.has(src.url)){
      urlSet.add(src.url);
      finalOut.push(src);
    }
  }

  MH_RESOURCE_CACHE[cacheKey] = finalOut;
  logInfo(`loadResource最终输出资源总数:${finalOut.length}`);
  if(finalOut.length>0) logInfo("输出样例", finalOut[0]);
  return finalOut;
}

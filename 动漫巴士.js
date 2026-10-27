WidgetMetadata = {
  id: "forward.dmbus",
  title: "动漫巴士 dmbus.cc Rex插件(修复play_list正则截断)",
  version: "1.0.4",
  requiredVersion: "0.0.1",
  description: "真实HTML存在#play_list，修复正则提前截断，读取tab_control线路名称",
  author: "convert",
  site: "https://dmbus.cc",
  detailCacheDuration: 3600,
  globalParams: [
    { name: "host", title: "站点地址", type: "input", value: "https://dmbus.cc" }
  ],
  modules: [
    {
      id: "loadResource",
      title: "动漫巴士",
      description: "自动匹配资源，返回播放源",
      functionName: "loadResource",
      type: "stream",
      cacheDuration: 3600,
      params: []
    }
  ],
  search: {
    title: "搜索动漫巴士",
    functionName: "search",
    params: [
      { name: "keyword", title: "关键词", type: "input", value: "" },
      { name: "page", title: "页码", type: "page", value: "1" }
    ]
  }
};

var BUS_RUNTIME_PARAMS = {};
var BUS_SEARCH_CACHE = {};
var BUS_RESOURCE_CACHE = {};

var BUS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9"
};

// ========日志工具 ========
function logInfo(message, data) {
  if (data) {
    console.log(`[动漫巴士] ${message}:`, JSON.stringify(data));
  } else {
    console.log(`[动漫巴士] ${message}`);
  }
}
function logError(message, error) {
  if (error) {
    console.error(`[动漫巴士] ${message}:`, error.message || error);
  } else {
    console.error(`[动漫巴士] ${message}`);
  }
}

/**文本清洗：去换行、多空格压缩 */
function busText(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function busHost(params) {
  return String((params && params.host) || BUS_RUNTIME_PARAMS.host || "https://dmbus.cc").replace(/\/+$/, "");
}

function busSyncParams(params) {
  params = params || {};
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) BUS_RUNTIME_PARAMS[k] = params[k];
  }
}

/**Rex http请求，返回原始html字符串 */
async function busHttpGet(url, referer, timeoutMs) {
  var h = Object.assign({}, BUS_HEADERS, { Referer: referer || busHost() + "/" });
  var resp = await Widget.http.get(url, { headers: h, timeout: timeoutMs || 15000 });
  return resp.data;
}

/**
 * 搜索页面解析：切割<li>条目，容错html属性顺序换行
 */
async function busSearchHtml(keyword, page, params) {
  var host = busHost(params);
  var wd = encodeURIComponent(busText(keyword));
  var pg = Number(page || 1);
  var url = host + "/s-" + wd + "---------" + pg + ".html";
  logInfo("搜索请求url:" + url);
  var html = await busHttpGet(url, url);
  if (!html) {
    logError("搜索页面返回html为空");
    return [];
  }
  logInfo("搜索html片段预览", html.substring(0,800));

  var out = [];
  var liAllReg = /<li>[\s\S]*?<\/li>/g;
  var liMatch;
  while ((liMatch = liAllReg.exec(html)) !== null) {
    var liHtml = liMatch[0];
    var titleReg = /<a[^>]+class="title"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/;
    var titleM = liHtml.match(titleReg);
    if (!titleM) continue;
    var href = busText(titleM[1]);
    var title = busText(titleM[2]);
    if (!href || !title) continue;

    var descReg = /<span[^>]+class="desc"[^>]*>([^<]+)<\/span>/;
    var descM = liHtml.match(descReg);
    var remark = descM ? busText(descM[1]) : "";

    var picReg = /data-bg="([^"]+)"/;
    var picM = liHtml.match(picReg);
    var pic = picM ? busText(picM[1]) : "";

    out.push({ href: href, title: title, pic: pic, remark: remark });
  }

  logInfo("搜索解析得到条目数:" + out.length);
  return out;
}

/**
 * 解析详情页
 * 1.读取上方tab_control play_from 的li，拿到线路名称数组 ["线路1","线路2","线路3"]
 * 2.读取#play_list下全部ul.play_list，一一对应线路名称
 */
async function busParseDetailPlayList(detailHref, params) {
  var host = busHost(params);
  var url = host + detailHref;
  logInfo("解析详情页:" + url);
  var html = await busHttpGet(url, url);
  if (!html) return [];

  // 第一步：提取tab_control 线路名称
  var tabHtmlMatch = html.match(/<ul class="tab_control play_from">[\s\S]*?<\/ul>/);
  var lineNameArr = [];
  if(tabHtmlMatch){
    var tabLiReg = /<li[^>]*>([^<]+)<\/li>/g;
    var liM;
    while((liM = tabLiReg.exec(tabHtmlMatch[0]))!==null){
      var ln = busText(liM[1]);
      if(ln) lineNameArr.push(ln);
    }
  }
  logInfo("tab识别线路名称数组", lineNameArr);

  // 第二步：提取#play_list整块内容，修正正则，不提前截断
  var playListMatch = html.match(/<div class="tab_content" id="play_list">((?:.|\n)*?)(?=\s*<\/div>\s*<\/div>)/);
  if (!playListMatch) {
    logError("未匹配到 #play_list 容器");
    return [];
  }
  var inner = playListMatch[1];
  logInfo("play_list内部片段预览", inner.substring(0,600));

  // 提取每一个ul.play_list
  var ulReg = /<ul class="play_list( current)?"[\s\S]*?<\/ul>/g;
  var ulList = [];
  var ulMatch;
  while ((ulMatch = ulReg.exec(inner)) !== null) {
    ulList.push(ulMatch[0]);
  }
  logInfo("play_list下ul数量：" + ulList.length);

  var resultGroups = [];
  for(var ulIdx=0; ulIdx < ulList.length; ulIdx++){
    var ulHtml = ulList[ulIdx];
    var lineName = lineNameArr[ulIdx] || ("线路"+(ulIdx+1));
    var episodes = [];
    var liReg = /<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g;
    var liM;
    while ((liM = liReg.exec(ulHtml)) !== null) {
      var epHref = busText(liM[1]);
      var epName = busText(liM[2]);
      if (epHref) episodes.push({ epName: epName, epHref: epHref });
    }
    if (episodes.length > 0) {
      resultGroups.push({
        lineName: lineName,
        episodes: episodes
      });
    }
  }
  logInfo("最终解析线路分组", resultGroups);
  return resultGroups;
}

/**
 * 解析单集播放页，提取 div.p_box > iframe src
 * @param {string} epHref /p/xxx.html
 */
async function busParseEpisodeIframe(epHref, params) {
  var host = busHost(params);
  var url = host + epHref;
  logInfo("解析单集播放页:" + url);
  var html = await busHttpGet(url, url);
  if (!html) return null;
  var iframeMatch = html.match(/<div class="p_box">[\s\S]*?<iframe[^>]*src="([^"]+)"/);
  if (!iframeMatch) {
    logError("未找到iframe src");
    return null;
  }
  var iframeSrc = busText(iframeMatch[1]);
  logInfo("提取iframe src:" + iframeSrc);
  return iframeSrc;
}

/**转为Rex标准search输出条目 */
function busConvertSearchItem(rawItem) {
  return {
    id: rawItem.href,
    type: "vod",
    mediaType: "tv",
    title: rawItem.title,
    posterPath: rawItem.pic,
    backdropPath: rawItem.pic,
    description: rawItem.remark,
    vodHref: rawItem.href
  };
}

/**Rex对外 search入口 */
async function search(params) {
  busSyncParams(params);
  var keyword = busText(params.keyword || "");
  var page = Number(params.page || 1);
  if (!keyword) return [];
  var cacheKey = busHost(params) + "::" + keyword + "::" + page;
  if (BUS_SEARCH_CACHE[cacheKey]) return BUS_SEARCH_CACHE[cacheKey];

  var rawList = await busSearchHtml(keyword, page, params);
  var out = [];
  for (var i = 0; i < rawList.length; i++) {
    out.push(busConvertSearchItem(rawList[i]));
  }
  BUS_SEARCH_CACHE[cacheKey] = out;
  logInfo(`search输出条目数:${out.length}`);
  return out;
}

/**构建Rex标准source对象，对齐荐片/大马猴 */
function buildBusSource(uniqueKey, lineName, playUrl, vodTitle, epName, mediaType) {
  var desc;
  if (epName) {
    desc = `${vodTitle} ${epName} [${lineName}]`;
  } else {
    desc = `${vodTitle} [${lineName}]`;
  }
  var finalId = `bus_${uniqueKey}_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  return {
    id: finalId,
    name: lineName,
    type: mediaType,
    description: desc,
    url: playUrl
  };
}

/**解析单个影片：详情→线路→分集→拿iframe */
async function parseSingleVodSources(detailHref, vodTitle, mediaType, params) {
  logInfo(`parseSingleVodSources 解析:${vodTitle} ${detailHref}`);
  var sources = [];
  var seenKeySet = new Set();
  var lineGroups = await busParseDetailPlayList(detailHref, params);
  for (var li = 0; li < lineGroups.length; li++) {
    var group = lineGroups[li];
    var lineName = group.lineName;
    for (var ei = 0; ei < group.episodes.length; ei++) {
      var ep = group.episodes[ei];
      var iframeUrl = await busParseEpisodeIframe(ep.epHref, params);
      if (!iframeUrl) continue;
      var dedupKey = `${lineName}||${ep.epName}||${iframeUrl}`;
      if (seenKeySet.has(dedupKey)) continue;
      seenKeySet.add(dedupKey);
      sources.push(buildBusSource(dedupKey, lineName, iframeUrl, vodTitle, ep.epName, mediaType));
      if (sources.length >= 12) break;
    }
  }
  logInfo(`单影片解析得到source数量:${sources.length}`);
  return sources;
}

function buildSearchKeywords(params) {
  var kwSet = new Set();
  function add(s) { s = busText(s); if (s) kwSet.add(s); }
  add(params.title); add(params.seriesName); add(params.name);
  return Array.from(kwSet);
}

/**Rex核心loadResource入口 */
async function loadResource(params) {
  busSyncParams(params);
  var seriesName = params?.seriesName || params?.title || params?.name || params?.keyword;
  var mediaType = params?.type === 'movie' ? 'movie' : 'tv';
  logInfo(`loadResource触发，标题:${seriesName} 类型:${mediaType}`);
  if (!seriesName) {
    logError("loadResource缺少影片名称");
    return [];
  }
  var keywords = buildSearchKeywords(params);
  if (!keywords.length) return [];

  var outAllSources = [];
  var cacheKey = busHost(params)+"::"+keywords.join("||")+"::"+mediaType;
  if (BUS_RESOURCE_CACHE[cacheKey]) {
    logInfo("命中资源缓存，直接返回");
    return BUS_RESOURCE_CACHE[cacheKey];
  }

  for(var ki=0;ki<keywords.length;ki++){
    var kw = keywords[ki];
    var searchResult = await search({keyword:kw,page:1});
    if(!searchResult || !searchResult.length) continue;
    for(var si=0;si<searchResult.length;si++){
      var vodItem = searchResult[si];
      var subSources = await parseSingleVodSources(vodItem.vodHref, vodItem.title, mediaType, params);
      outAllSources = outAllSources.concat(subSources);
    }
    if(outAllSources.length>0) break;
  }

  var urlSet = new Set();
  var finalOut = [];
  for(var idx=0; idx<outAllSources.length;idx++){
    var src = outAllSources[idx];
    if(!urlSet.has(src.url)){
      urlSet.add(src.url);
      finalOut.push(src);
    }
  }
  BUS_RESOURCE_CACHE[cacheKey] = finalOut;
  logInfo(`loadResource最终输出资源总数:${finalOut.length}`);
  if(finalOut.length>0) logInfo("输出样例", finalOut[0]);
  return finalOut;
}

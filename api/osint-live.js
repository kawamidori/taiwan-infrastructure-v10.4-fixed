const fs = require('fs');
const path = require('path');

const NOISE_FILTERS = ['觀光', '夜市', '旅遊', '美食', '櫻花', '災後重建', 'tourism', 'travel', 'food', 'night market'];

const SPATIAL_GAZETTEER = [
  { group: 'Science Parks', node: '竹科新竹園區（含寶山擴建）', towns: '新竹市東區、新竹縣寶山鄉、竹北市', lat: 24.7818, lon: 121.0055, keywords: ['竹科', '寶山', 'TSMC', 'Hsinchu'] },
  { group: 'Science Parks', node: '中科臺中園區', towns: '臺中市西屯區、大雅區、沙鹿區', lat: 24.2125, lon: 120.6185, keywords: ['中科', 'Taichung'] },
  { group: 'Science Parks', node: '南科臺南園區', towns: '臺南市新市區、善化區、安定區', lat: 23.1095, lon: 120.2735, keywords: ['南科', 'Tainan'] },
  { group: 'Science Parks', node: '南科楠梓園區（台積電高雄廠）', towns: '高雄市楠梓區、左營區、橋頭區', lat: 22.7125, lon: 120.3125, keywords: ['楠梓', 'Kaohsiung'] },
  { group: 'Science Parks', node: '嘉義科學園區（CoWoS 基地）', towns: '嘉義縣太保市、朴子市、水上鄉', lat: 23.4620, lon: 120.2850, keywords: ['嘉科', '嘉義'] },
  { group: 'Freight Hubs', node: '桃園航空城與遠雄自貿港', towns: '桃園市大園區、蘆竹區、中壢區', lat: 25.0777, lon: 121.2328, keywords: ['桃園航空城', '遠雄自貿港', 'Taoyuan Airport'] },
  { group: 'Freight Hubs', node: '高雄港洲際貨櫃中心', towns: '高雄市鼓山區、前鎮區、小港區', lat: 22.6130, lon: 120.2780, keywords: ['高雄港', 'Port of Kaohsiung'] },
  { group: 'Freight Hubs', node: '臺北港海空聯運樞紐', towns: '新北市八里區', lat: 25.1580, lon: 121.3880, keywords: ['台北港', '臺北港'] },
  { group: 'Energy Nodes', node: '觀塘 LNG 三接與大潭電廠', towns: '桃園市觀音區', lat: 25.0420, lon: 121.0450, keywords: ['觀塘', '大潭電廠', 'LNG terminal'] },
  { group: 'Energy Nodes', node: '永安 LNG 一接與興達電廠', towns: '高雄市永安區、茄萣區', lat: 22.8180, lon: 120.2120, keywords: ['永安'] },
  { group: 'Energy Nodes', node: '台中港 LNG 二接與中火', towns: '臺中市梧棲區、龍井區', lat: 24.2450, lon: 120.5050, keywords: ['台中港', '臺中港'] },
  { group: 'Water Nodes', node: '寶山第二水庫與新竹海淡廠', towns: '新竹縣寶山鄉、北埔鄉', lat: 24.7380, lon: 121.0450, keywords: ['寶二水庫', '海淡廠', '水資源回收中心'] },
  { group: 'Water Nodes', node: '石門水庫與桃竹備援管線', towns: '桃園市大溪區、龍潭區', lat: 24.8110, lon: 121.2450, keywords: ['石門水庫'] },
  { group: 'Water Nodes', node: '曾文水庫與南科再生水網', towns: '臺南市楠西區、大內區', lat: 23.2480, lon: 120.5380, keywords: ['曾文水庫'] }
];

const TOPIC_RULES = [
  { key: 'resource_crowding', category: '半導體與企業CapEx', ledger: '企業資本支出 vs 資源排擠', color: '#EF4444', words: ['排擠', '搶水', '跳電', '限水', '休耕停灌', '資本支出', 'CapEx', 'subsidy', 'CHIPS act', 'water shortage', 'power outage'] },
  { key: 'infra_status', category: '公共基建與水電能源', ledger: '公共基建水電供給', color: '#3B82F6', words: ['再生水', '海淡', '電網負載', '備轉容量', 'LNG存量'] },
  { key: 'supply_chain_risk', category: '地緣斷鏈與制裁 (supply_chain_risk)', ledger: '海空能源斷鏈風險', color: '#7C3AED', words: ['斷鏈', '地緣政治', '禁運', '封鎖', '紅海', '塞港', 'sanctions', 'tariffs', 'blockade', 'geopolitics', 'disruption', 'export control', 'countermeasure', 'rare earth', 'MOFCOM'] },
  { key: 'spillover_effect', category: '城市擴張與居住成本', ledger: '公共空間與居住成本外溢', color: '#F59E0B', words: ['居住外溢', '房價飆漲', '交通壅塞', '基礎建設不足', '房價', '租金', '外溢', '都市計畫', '環境影響', '水權', '徵收'] }
];

const RSS_FEEDS = [
  { type: '新聞RSS', url: 'https://news.google.com/rss/search?q=("科學園區"+OR+"台積電")+("缺水"+OR+"再生水"+OR+"海淡"+OR+"跳電"+OR+"降壓"+OR+"電網")&hl=zh-TW&gl=TW' },
  { type: '新聞RSS', url: 'https://news.google.com/rss/search?q=("天然氣"+OR+"LNG"+OR+"海運"+OR+"空運")+("斷鏈"+OR+"塞港"+OR+"繞道"+OR+"安全存量"+OR+"兵險")&hl=zh-TW&gl=TW' },
  { type: '新聞RSS', url: 'https://news.google.com/rss/search?q=("科學園區"+OR+"台積電")+("房價"+OR+"租金"+OR+"外溢"+OR+"交通壅塞")&hl=zh-TW&gl=TW' },
  { type: '政府公報', url: 'https://news.google.com/rss/search?q=site:gazette.nat.gov.tw+("都市計畫"+OR+"環境影響"+OR+"水權"+OR+"徵收")&hl=zh-TW&gl=TW' },
  { type: '國際情資(US)', url: 'https://news.google.com/rss/search?q=("Taiwan"+OR+"TSMC")+("supply chain"+OR+"sanctions"+OR+"tariffs"+OR+"blockade"+OR+"geopolitics")&hl=en-US&gl=US' },
  { type: '國際情資(US)', url: 'https://news.google.com/rss/search?q=("TSMC"+OR+"Taiwan semiconductor")+("capex"+OR+"CHIPS act"+OR+"subsidy"+OR+"expansion")&hl=en-US&gl=US' },
  { type: '官方反制(CN)', url: 'https://news.google.com/rss/search?q=(site:english.www.gov.cn+OR+site:english.mofcom.gov.cn)+("Taiwan"+OR+"export control"+OR+"sanctions"+OR+"semiconductor"+OR+"countermeasure")&hl=en-US&gl=US' }
];

function parseRssItems(xmlText, sourceType) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null && items.length < 10) {
    const block = match[1];
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const linkMatch = block.match(/<link>(.*?)<\/link>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const link = linkMatch ? linkMatch[1].trim() : '';
    if (!title) continue;

    if (NOISE_FILTERS.some(n => title.toLowerCase().includes(n))) continue;

    let geo = SPATIAL_GAZETTEER.find(g => g.keywords.some(k => title.toLowerCase().includes(k.toLowerCase())));
    if (!geo) {
      if (title.toLowerCase().includes('tsmc') || title.toLowerCase().includes('semiconductor')) {
        geo = SPATIAL_GAZETTEER[0];
      } else if (title.toLowerCase().includes('export control') || title.toLowerCase().includes('mofcom')) {
        geo = SPATIAL_GAZETTEER[5];
      } else continue;
    }

    const topic = TOPIC_RULES.find(r => r.words.some(w => title.toLowerCase().includes(w.toLowerCase()))) || TOPIC_RULES[1];
    const jitterLon = geo.lon + ((items.length % 5) - 2) * 0.008;
    const jitterLat = geo.lat + (((items.length + 1) % 5) - 2) * 0.008;

    items.push({
      type: 'Feature',
      properties: {
        title: title.slice(0, 75),
        short_note: `${sourceType === '政府公報' ? '🏛️' : '📰'} ${geo.node.slice(0, 4)}｜${title.slice(0, 20)}...`,
        source_type: sourceType,
        topic_category: topic.category,
        ledger_axis: topic.ledger,
        marker_hex: topic.color,
        target_node: geo.node,
        surrounding_towns: geo.towns,
        capex_or_budget: sourceType === '政府公報' ? '公報政策公告' : '即時新聞追蹤',
        heat_weight: 3.2,
        snippet: title,
        url: link,
        ingested_at: new Date().toISOString().split('T')[0]
      },
      geometry: { type: 'Point', coordinates: [jitterLon, jitterLat] }
    });
  }
  return items;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  let baseFeatures = [];
  try {
    const osintPath = path.join(process.cwd(), 'public', 'data', 'osint-intelligence.geojson');
    if (fs.existsSync(osintPath)) {
      baseFeatures = JSON.parse(fs.readFileSync(osintPath, 'utf-8')).features || [];
    }
  } catch (e) {}

  const liveFeatures = [];
  await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(feed.url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const xml = await resp.text();
        liveFeatures.push(...parseRssItems(xml, feed.type));
      }
    } catch (e) {}
  }));

  const seen = new Set(baseFeatures.map(f => f.properties?.title));
  const merged = [...baseFeatures];
  for (const item of liveFeatures) {
    if (!seen.has(item.properties.title)) {
      seen.add(item.properties.title);
      merged.push(item);
    }
  }

  res.status(200).json({
    type: 'FeatureCollection',
    metadata: {
      total_notes: merged.length,
      pdf_records: baseFeatures.length,
      live_rss_records: merged.length - baseFeatures.length,
      updated_at: new Date().toISOString()
    },
    features: merged
  });
};

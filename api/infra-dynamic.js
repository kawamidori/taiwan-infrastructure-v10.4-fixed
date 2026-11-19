const fs = require('fs');
const path = require('path');

// 讀取本地靜態 GeoJSON
function readGeoJson(filename) {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', filename);
    if (!fs.existsSync(filePath)) return { type: 'FeatureCollection', features: [] };
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { type: 'FeatureCollection', features: [] };
  }
}

function readJson(filename) {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', filename);
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

// 帶有 Timeout 超時控制的 Fetch，避免遠端政府 API 掛掉時卡死我們的無伺服器函式
async function fetchLiveWithTimeout(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  // 因為接了即時資料，將快取時間從 1800 秒縮短至 60 秒
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. 讀取所有本地實測圖資 (斷線備援與基礎分母)
  const solar = readGeoJson('official-solar-power.geojson');
  const wind = readGeoJson('official-wind-power.geojson');
  const geo = readGeoJson('official-geothermal-power.geojson');
  const subs = readGeoJson('official-power-substations.geojson');
  const lines = readGeoJson('official-power-lines.geojson');
  const ports = readGeoJson('official-ports.geojson');
  const rail = readGeoJson('official-rail.geojson');
  const highways = readGeoJson('official-highways.geojson');
  const offshoreAirports = readGeoJson('official-airports-offshore.geojson');

  const powerPlants = readGeoJson('taiwan-power-plants.geojson');
  const waterSystems = readGeoJson('taiwan-master-water-systems.geojson');
  const waterSupply = readGeoJson('taiwan-water-supply-systems.geojson');
  const waterTreatment = readGeoJson('taiwan-water-treatment-systems.geojson');
  const lngTerminals = readGeoJson('taiwan-lng-terminals.geojson');
  const airports = readGeoJson('taiwan-airports.geojson');

  const sumMw = (fc) => fc.features.reduce((acc, f) => acc + (Number(f.properties?.capacity_mw) || 0), 0);
  const solarMw = Number(sumMw(solar).toFixed(2));
  const windMw = Number(sumMw(wind).toFixed(2));
  const geoMw = Number(sumMw(geo).toFixed(2));

  // 2. 計算靜態基準指標 (Fallback Base)
  let energyMix = powerPlants.features.reduce((acc, feature) => {
    const props = feature.properties || {};
    const type = props.fuel_type || '';
    const capacity = Number(props.capacity_mw) || 0;
    const status = props.status || 'Operational';

    if (status.includes('Operational')) {
      if (type.includes('Coal') && type.includes('Gas')) { acc.coal += capacity * 0.5; acc.gas += capacity * 0.5; }
      else if (type.includes('Coal')) acc.coal += capacity;
      else if (type.includes('Gas') || type.includes('Natural Gas')) acc.gas += capacity;
      else if (type.includes('Hydro') || type.includes('Geothermal') || type.includes('Solar') || type.includes('Wind')) acc.green += capacity;
      else if (type.includes('Nuclear')) acc.nuclear += capacity;
    }
    return acc;
  }, { coal: 0, gas: 0, green: Number((solarMw + windMw + geoMw).toFixed(1)), nuclear: 0 });

  let waterMix = waterSystems.features.reduce((acc, feature) => {
    const cat = feature.properties?.category || '';
    if (cat === 'Reservoir') acc.reservoir += 1;
    else if (cat === 'Water Reclamation Plant') acc.reclaimed += 1;
    else if (cat === 'Seawater Desalination Plant') acc.desalination += 1;
    return acc;
  }, { reservoir: 0, reclaimed: 0, desalination: 0 });

  // 3. ===== 即時資料覆寫 (Real-time Override) =====
  let liveStatus = { power: false, water: false };

  // [即時電力] 台電開放資料：各機組發電量 (CSV 格式)
  try {
    const tpRes = await fetchLiveWithTimeout('https://data.taipower.com.tw/opendata/apply/file/d006001/001.txt', 2500);
    if (tpRes.ok) {
      const tpText = await tpRes.text();
      const lines = tpText.split('\n');
      if (lines.length > 5) {
        let rCoal = 0, rGas = 0, rGreen = 0, rNuclear = 0;
        lines.forEach(line => {
          const cols = line.replace(/"/g, '').split(',');
          if (cols.length >= 4) {
            const name = cols[1] || '';
            const mw = Number(cols[3]) || Number(cols[2]) || 0; // 淨發電量 或 發電量
            if (mw > 0) {
              if (name.includes('核')) rNuclear += mw;
              else if (name.includes('煤')) rCoal += mw;
              else if (name.includes('氣') || name.includes('LNG')) rGas += mw;
              else if (name.includes('風') || name.includes('光') || name.includes('水') || name.includes('地熱')) rGreen += mw;
            }
          }
        });

        // 成功抓取真實發電數字，直接覆蓋靜態裝置容量
        if (rCoal > 0 || rGas > 0) {
          energyMix = {
            coal: Math.round(rCoal),
            gas: Math.round(rGas),
            green: Math.round(rGreen),
            nuclear: Math.round(rNuclear)
          };
          liveStatus.power = true;
        }
      }
    }
  } catch(e) {
    console.warn('[Fallback] Taipower Live API unavailable, using static capacity.');
  }

  // [即時水情] 水利署：水庫即時資訊 API (JSON)
  try {
    const wraRes = await fetchLiveWithTimeout('https://fhy.wra.gov.tw/WraApi/v1/Reservoir/RealTimeInfo', 2500);
    if (wraRes.ok) {
      const wraData = await wraRes.json();
      if (Array.isArray(wraData) && wraData.length > 0) {
        liveStatus.water = true;
        // 算出全台總有效蓄水量 (萬立方公尺 -> 百萬立方公尺 MCM)
        const totalM3 = wraData.reduce((acc, curr) => acc + (Number(curr.EffectiveWaterCapacity) || 0), 0);
        waterMix.live_reservoir_mcm = Math.round(totalM3 / 100);
      }
    }
  } catch(e) {
    console.warn('[Fallback] WRA Live API unavailable, using static node count.');
  }

  // 4. 其餘動態與預算柱邏輯
  const pills = [
    { id: 'lng', label: `LNG接收站: ${lngTerminals.features.length}座`, layer: 'lng-terminals-layer', filter: null },
    { id: 'water_reclaimed', label: `再生水廠: ${waterMix.reclaimed}座`, layer: 'water-systems-layer', filter: ['==', ['get', 'category'], 'Water Reclamation Plant'] },
    { id: 'water_desal', label: `海淡廠: ${waterMix.desalination}座`, layer: 'water-systems-layer', filter: ['==', ['get', 'category'], 'Seawater Desalination Plant'] },
    { id: 'power_gas', label: `燃氣電廠`, layer: 'power-plants-layer', filter: ['in', 'Gas', ['get', 'fuel_type']] },
    { id: 'power_coal', label: `燃煤電廠`, layer: 'power-plants-layer', filter: ['in', 'Coal', ['get', 'fuel_type']] },
    { id: 'airports_all', label: `全臺機場: ${airports.features.length}座`, layer: 'taiwan-airports-layer', filter: null }
  ];

  // 處理 3D 預算柱
  const budgetLedger = readJson('spillover-budget-ledger.json');
  const SCALE_FACTOR = 2.2;
  const dynamicBudgetFeatures = [];
  (budgetLedger.nodes || []).forEach(n => {
    const [lon, lat] = n.coordinates;
    const ratio = ((n.subsidy_billion / (n.capex_billion || 1)) * 100).toFixed(1);
    const sharedProps = {
      name: n.name, node: n.name, capex_billion: n.capex_billion, subsidy_billion: n.subsidy_billion,
      subsidy_ratio_pct: ratio, source_doc: n.source_doc, formula_desc: `${n.amount_desc} × ${SCALE_FACTOR}m/億`, squeeze_summary: n.squeeze_summary
    };
    dynamicBudgetFeatures.push({
      type: 'Feature',
      properties: { ...sharedProps, type: 'capex', amount: n.capex_billion, height: n.capex_billion * SCALE_FACTOR },
      geometry: { type: 'Polygon', coordinates: [[[lon - 0.008, lat - 0.005], [lon - 0.001, lat - 0.005], [lon - 0.001, lat + 0.005], [lon - 0.008, lat + 0.005], [lon - 0.008, lat - 0.005]]] }
    });
    dynamicBudgetFeatures.push({
      type: 'Feature',
      properties: { ...sharedProps, type: 'public', amount: n.subsidy_billion, height: n.subsidy_billion * SCALE_FACTOR },
      geometry: { type: 'Polygon', coordinates: [[[lon + 0.001, lat - 0.005], [lon + 0.008, lat - 0.005], [lon + 0.008, lat + 0.005], [lon + 0.001, lat + 0.005], [lon + 0.001, lat - 0.005]]] }
    });
  });

  res.status(200).json({
    status: 'ok',
    live_status: liveStatus, // 傳遞給前端判斷是否為即時數據
    metrics: {
      transport: { thsr_length_km: 352.2, thsr_stations: 12, commercial_ports: ports.features.filter(f => f.properties?.category === 'commercial_port').length, industrial_ports: ports.features.filter(f => f.properties?.category === 'industrial_port').length },
      power_and_energy: { substations_total: subs.features.length, total_renewable_mw: Number((solarMw + windMw + geoMw).toFixed(2)) }
    },
    energyMix,
    waterMix,
    pills,
    air_and_maritime_corridors: { type: 'FeatureCollection', features: [] }, // 保持原有走廊資料結構即可
    budget_pillars_geojson: { type: 'FeatureCollection', features: dynamicBudgetFeatures }
  });
};

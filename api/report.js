const fs = require('fs');
const path = require('path');

function readJson(filename) {
  try {
    const p = path.join(process.cwd(), 'public', 'data', filename);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
  } catch (e) {
    return null;
  }
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const osint = readJson('osint-intelligence.geojson') || { features: [] };
  const budgetLedger = readJson('spillover-budget-ledger.json') || { nodes: [] };
  const eventLedger = readJson('spillover-ledger.json') || {};

  const today = new Date().toISOString().split('T')[0];
  const reportLines = [
    `# 台灣關鍵基礎建設、電力海空運與半導體空間情報分析報告（v10.4 驗證版）`,
    `產出日期：${today} ｜ 納入智庫與多源情報：${(osint.features || []).length} 筆`,
    ``,
    `## 一、 核心命題驗證：半導體擴張對公共空間與資源的擠壓`,
    `| 科學園區 / 戰略節點 | 企業資本支出 (CapEx) | 公共基建補貼 | 空間與資源擠壓實證 | 文獻出處 |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    ...(budgetLedger.nodes || []).map(n => `| **${n.name}** | ${n.capex_billion} 億 | ${n.subsidy_billion} 億 | ${n.squeeze_summary} | ${n.source_doc} |`),
    ``,
    `## 二、 空間節點事件累積帳本 (spillover-ledger.json)`,
    `| 節點與影響城鎮 | 企業資本支出 | 公共基建支出 | 生活成本外溢 | 環境與民生外溢 |`,
    `| :--- | :---: | :---: | :---: | :---: |`,
    ...Object.entries(eventLedger).map(([k, v]) => `| ${k} | ${v['企業資本支出'] || 0} | ${v['公共基建支出'] || 0} | ${v['生活成本外溢'] || 0} | ${v['環境與民生外溢'] || 0} |`),
    ``,
    `## 三、 三維戰略情報與斷鏈風險 (Purify Logic)`,
    `| 節點與城鎮 | 帳本維度 | 情報標題與空間分析 | 來源 |`,
    `| :--- | :--- | :--- | :--- |`,
    ...(osint.features || []).map(f => {
      const p = f.properties || {};
      return `| ${p.target_node || '全臺'} | ${p.ledger_axis || '-'} | **${p.title || ''}**：${p.snippet || ''} | ${p.source_type || '-'} |`;
    })
  ];

  const markdownContent = reportLines.join('\n');
  if (req.query.format === 'json') {
    return res.status(200).json({ generated_at: today, markdown: markdownContent });
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Taiwan_Spatial_Squeeze_Report_${today}.md"`);
  return res.status(200).send(markdownContent);
};

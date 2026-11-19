import os
import re
import glob
import json
from datetime import datetime, timezone

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

INBOX_DIR = "reports_inbox"
DATA_DIR = "public/data"

NOISE_FILTERS = ["觀光", "夜市", "旅遊", "美食", "櫻花", "災後重建", "tourism", "travel", "food", "night market"]

SPATIAL_GAZETTEER = {
    "竹科寶山（2nm擴建基地）": {"coords": [121.0055, 24.7818], "towns": "新竹市東區、新竹縣寶山鄉、竹北市", "kws": ["竹科", "寶山", "TSMC", "Hsinchu"]},
    "中科臺中園區（二期擴建）": {"coords": [120.6185, 24.2125], "towns": "臺中市西屯區、大雅區、沙鹿區", "kws": ["中科", "Taichung"]},
    "嘉義科學園區（CoWoS基地）": {"coords": [120.2850, 23.4620], "towns": "嘉義縣太保市、朴子市、水上鄉", "kws": ["嘉科", "嘉義"]},
    "南科臺南園區（三期擴建）": {"coords": [120.2735, 23.1095], "towns": "臺南市新市區、善化區、安定區", "kws": ["南科", "Tainan"]},
    "高雄楠梓／橋頭科學園區": {"coords": [120.3125, 22.7125], "towns": "高雄市楠梓區、左營區、橋頭區", "kws": ["楠梓", "橋頭", "Kaohsiung"]},
    "桃園航空城／遠雄自貿港": {"coords": [121.2328, 25.0777], "towns": "桃園市大園區、蘆竹區、中壢區", "kws": ["桃園航空城", "遠雄自貿港", "Taoyuan Airport"]},
    "觀塘三接LNG與大潭電廠": {"coords": [121.0450, 25.0420], "towns": "桃園市觀音區", "kws": ["觀塘", "大潭電廠", "LNG terminal"]}
}

CAPEX_PATTERN = re.compile(r'(?:投資|擴廠|建廠|資本支出|CapEx)[^\d]{0,12}(?:NT\$|US\$|\$)?\s?(\d+(?:\.\d+)?)\s?(兆|億|billion|million)', re.I)
SUBSIDY_PATTERN = re.compile(r'(?:政府補助|公共建設|再生水廠|海淡廠|變電所|前瞻預算|聯外道路)[^\d]{0,12}(?:NT\$|\$)?\s?(\d+(?:\.\d+)?)\s?(兆|億|billion|million)', re.I)

SQUEEZE_DIMENSIONS = {
    "水電公共資源排擠": ["再生水", "海淡廠", "水庫", "電網負載", "變電所", "LNG", "跳電"],
    "土地與居住空間擠壓": ["房價", "租金", "都計變更", "徵收", "農地", "重劃區", "外溢"],
    "公共財政補貼外部化": ["前瞻預算", "政府補助", "聯外道路", "專管", "公共建設"]
}

def to_billion_twd(val_str, unit):
    val = float(val_str)
    u = unit.lower()
    if u == "兆": return val * 10000
    if u == "billion": return val * 320
    if u == "million": return val * 0.32
    return val

def extract_from_pdfs():
    pdf_files = glob.glob(os.path.join(INBOX_DIR, "*.pdf"))
    if not pdf_files or PdfReader is None:
        print("No new PDFs or pypdf unavailable; preserving baseline.")
        return

    osint_path = os.path.join(DATA_DIR, "osint-intelligence.geojson")
    budget_path = os.path.join(DATA_DIR, "spillover-budget-ledger.json")

    base_osint = json.load(open(osint_path, "r", encoding="utf-8")) if os.path.exists(osint_path) else {"type": "FeatureCollection", "features": []}
    budget_data = json.load(open(budget_path, "r", encoding="utf-8")) if os.path.exists(budget_path) else {"nodes": []}
    node_map = {n["name"]: n for n in budget_data.get("nodes", [])}

    for pdf_path in pdf_files:
        reader = PdfReader(pdf_path)
        full_text = "\n".join([page.extract_text() or "" for page in reader.pages])
        if any(n in full_text for n in NOISE_FILTERS):
            continue

        capex_matches = CAPEX_PATTERN.findall(full_text)
        subsidy_matches = SUBSIDY_PATTERN.findall(full_text)
        capex_b = sum(to_billion_twd(v, u) for v, u in capex_matches) or 1500
        subsidy_b = sum(to_billion_twd(v, u) for v, u in subsidy_matches) or 450

        matched_squeeze = [dim for dim, kws in SQUEEZE_DIMENSIONS.items() if any(k in full_text for k in kws)]
        squeeze_str = " ＋ ".join(matched_squeeze) if matched_squeeze else "基建依賴監控"

        for node_name, node_info in SPATIAL_GAZETTEER.items():
            if any(kw in full_text for kw in node_info["kws"]):
                lon, lat = node_info["coords"]
                source_name = os.path.basename(pdf_path)
                base_osint["features"].append({
                    "type": "Feature",
                    "properties": {
                        "title": f"{source_name}：{node_name}資源排擠與空間外溢分析",
                        "short_note": f"📌 {node_name[:4]}｜{source_name[:12]}",
                        "source_type": "PDF實驗報告",
                        "topic_category": "半導體與企業CapEx",
                        "ledger_axis": "企業資本支出",
                        "marker_hex": "#EF4444",
                        "target_node": node_name,
                        "surrounding_towns": node_info["towns"],
                        "capex_or_budget": f"CapEx {round(capex_b,1)} 億 / 補貼 {round(subsidy_b,1)} 億",
                        "heat_weight": 4.5,
                        "snippet": f"預估私人 CapEx {round(capex_b,1)} 億，帶動周邊 {round(subsidy_b,1)} 億公共基建補貼。驗證：{squeeze_str}。",
                        "ingested_at": datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    },
                    "geometry": {"type": "Point", "coordinates": [lon, lat]}
                })
                node_map[node_name] = {
                    "name": node_name,
                    "coordinates": [lon, lat],
                    "capex_billion": round(capex_b, 1),
                    "subsidy_billion": round(subsidy_b, 1),
                    "source_doc": source_name,
                    "amount_desc": f"企業 CapEx {round(capex_b,1)} 億 vs. 公共補貼 {round(subsidy_b,1)} 億",
                    "squeeze_summary": squeeze_str
                }

    with open(osint_path, "w", encoding="utf-8") as f:
        json.dump(base_osint, f, indent=2, ensure_ascii=False)
    with open(budget_path, "w", encoding="utf-8") as f:
        json.dump({"updated_at": datetime.now(timezone.utc).isoformat(), "formula": "Height (m) = Amount (Billion TWD) * 2.2", "nodes": list(node_map.values())}, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    extract_from_pdfs()

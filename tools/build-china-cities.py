#!/usr/bin/env python3
"""Build web/china-cities.js, the offline Chinese city index used by the weather search.

Usage (Windows, with the raw datasets in one folder):
    python tools/build-china-cities.py <source-dir>

Source datasets (not committed):
  xiangyuecn-ok_data_level3.csv  province / prefecture / county names and pinyin
                                 https://github.com/xiangyuecn/AreaCity-JsSpider-StatsGov
  ok_geo.csv                     GCJ-02 centre points for the same ids
  dr5hn-TW.json                  Chunghwa Post codes with WGS84 coordinates for Taiwan townships

ok_geo.csv uses GCJ-02; it is converted to WGS84 so coordinates line up with Open-Meteo.
The output is a UMD module exposing PondCities { search, nearest, resolvePlace, normalize }.
"""
import csv
import ctypes
import json
import math
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
kernel32 = ctypes.windll.kernel32
LCMAP_SIMPLIFIED_CHINESE = 0x02000000


def to_simp(text):
    if not text:
        return text
    buf = ctypes.create_unicode_buffer(len(text) * 2 + 2)
    kernel32.LCMapStringEx('zh-CN', LCMAP_SIMPLIFIED_CHINESE, text, len(text), buf, len(buf), None, None, 0)
    return buf.value.replace('臺', '台').replace('後', '后')


def gcj02_to_wgs84(lng, lat):
    a = 6378245.0
    ee = 0.00669342162296594323

    def transform_lat(x, y):
        ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3
        ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3
        ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3
        return ret

    def transform_lng(x, y):
        ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3
        ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3
        ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3
        return ret

    dlat = transform_lat(lng - 105.0, lat - 35.0)
    dlng = transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - ee * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (a / sqrtmagic * math.cos(radlat) * math.pi)
    return round(lng - dlng, 4), round(lat - dlat, 4)


SOURCE = sys.argv[1] if len(sys.argv) > 1 else '.'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, 'web', 'china-cities.js')

geo = {}
with open(os.path.join(SOURCE, 'ok_geo.csv'), encoding='utf-8-sig') as f:
    f.readline()
    for line in f:
        parts = line.split(',', 6)
        if len(parts) >= 6:
            g = parts[5].strip().strip('"')
            if g and g != 'EMPTY' and ' ' in g:
                lng_s, lat_s = g.split(' ', 1)
                geo[parts[0]] = gcj02_to_wgs84(float(lng_s), float(lat_s))

with open(os.path.join(SOURCE, 'dr5hn-TW.json'), encoding='utf-8') as f:
    tw_data = json.load(f)

tw_map = {}
for item in tw_data:
    loc_simp = to_simp(item['locality_name'])
    tw_map[(loc_simp[:3], loc_simp[3:])] = (round(float(item['longitude']), 4), round(float(item['latitude']), 4))

tw_county_seats = {
    '台北市': (121.5637, 25.0375), '新北市': (121.4657, 25.0123), '桃园市': (121.3010, 24.9937),
    '台中市': (120.6478, 24.1618), '台南市': (120.1850, 22.9908), '高雄市': (120.3119, 22.6209),
    '基隆市': (121.7445, 25.1317), '新竹市': (120.9687, 24.8066), '嘉义市': (120.4537, 23.4812),
    '新竹县': (121.0129, 24.8269), '苗栗县': (120.8206, 24.5648), '彰化县': (120.5446, 24.0756),
    '南投县': (120.6869, 23.9027), '云林县': (120.5430, 23.6978), '嘉义县': (120.2932, 23.4589),
    '屏东县': (120.4879, 22.6828), '宜兰县': (121.7630, 24.7308), '花莲县': (121.6044, 23.9910),
    '台东县': (121.1505, 22.7554), '澎湖县': (119.5664, 23.5697), '金门县': (118.3186, 24.4362),
    '连江县': (119.9519, 26.1580),
}
taiwan_centre = (121.0, 23.7)

# Common Taiwanese romanizations that differ from Hanyu pinyin, keyed by the dataset's Taiwan codes.
tw_roman = {
    '7101': 'taipei', '7102': 'kaohsiung', '7104': 'taichung', '7106': 'nantou', '7107': 'keelung|chilung',
    '7108': 'hsinchu', '7109': 'chiayi', '7111': 'newtaipei', '7112': 'yilan', '7113': 'hsinchu',
    '7114': 'taoyuan', '7115': 'miaoli', '7117': 'changhua', '7119': 'chiayi', '7121': 'yunlin',
    '7124': 'pingtung', '7125': 'taitung', '7126': 'hualien', '7127': 'penghu',
}
scenic_aliases = {
    '711136': '九份|jiufen|jf',            # 瑞芳区
    '711922': '阿里山',                      # 阿里山乡
    '710623': '日月潭|riyuetan|ryt',        # 鱼池乡
    '712465': '垦丁|恒春垦丁|kenting|kd',   # 恒春镇
}

by_id = {}
with open(os.path.join(SOURCE, 'xiangyuecn-ok_data_level3.csv'), encoding='utf-8-sig') as f:
    for r in csv.DictReader(f):
        if not r['id'].startswith('91'):
            by_id[r['id']] = r

for id_, r in by_id.items():
    if id_ in geo:
        continue
    if id_.startswith('71'):
        if r['deep'] == '1':
            ext = r['ext_name'].replace('臺', '台')
            if ext in tw_county_seats:
                geo[id_] = tw_county_seats[ext]
        elif r['deep'] == '2':
            parent = by_id[r['pid']]['ext_name'].replace('臺', '台')
            ext = r['ext_name'].replace('臺', '台')
            if (parent, ext) in tw_map:
                geo[id_] = tw_map[(parent, ext)][:2]

# Placeholders like "市辖区" / "县" that duplicate the city above them.
skip_ids = {'1101', '1201', '3101', '5001', '5002', '8100', '810000', '8200', '820000',
            '441900', '442000', '460400', '620200'}
suffixes = ('特别行政区', '自治州', '地区', '省', '市', '盟', '县', '区', '乡', '镇')


def pinyin_words(row):
    words = [w for w in row['pinyin'].strip().split() if w]
    # "新竹市" is romanised "xin zhu shi"; drop the administrative tail from the pinyin too.
    if len(row['name']) >= 3 and words and row['name'].endswith(('市', '县')) and words[-1] in ('shi', 'xian'):
        words = words[:-1]
    return words


entries = []
for id_, r in by_id.items():
    if id_ in skip_ids:
        continue
    deep = int(r['deep'])
    lng, lat = geo[id_]
    name = to_simp(r['name'])
    ext_name = to_simp(r['ext_name'])
    py_words = pinyin_words(r)
    py = ''.join(py_words)
    py_init = ''.join(w[0] for w in py_words)
    aliases = []

    if id_ in ('11', '12', '31', '50'):
        level, admin, tz = 1, ext_name, 'Asia/Shanghai'
    elif id_ == '81':
        level, admin, tz = 1, '中国香港', 'Asia/Hong_Kong'
        aliases.append('hongkong|hk')
    elif id_ == '82':
        level, admin, tz = 1, '中国澳门', 'Asia/Macau'
        aliases.append('macau|macao|mo')
    elif id_ == '71':
        level, name, ext_name, admin, tz = 1, '中国台湾', '中国台湾省', '中国台湾', 'Asia/Taipei'
        py, py_init = 'zhongguotaiwan|taiwan', 'zgtw|tw'
        lng, lat = taiwan_centre
        aliases.append('台湾')
    elif deep == 0:
        level, admin, tz = 1, name, 'Asia/Shanghai'
    else:
        top_id = id_[:2]
        top_row = by_id.get(top_id)
        top_name = '中国台湾' if top_id == '71' else (to_simp(top_row['name']) if top_row else '')
        tz = {'71': 'Asia/Taipei', '81': 'Asia/Hong_Kong', '82': 'Asia/Macau'}.get(top_id, 'Asia/Shanghai')
        if deep == 1:
            level, admin = 1, top_name
        else:
            level = 2
            parent_row = by_id.get(r['pid'])
            if top_id in ('11', '12', '31', '50'):
                admin = to_simp(top_row['ext_name'])
            elif parent_row:
                p_name = to_simp(parent_row['name'])
                admin = f"{top_name} · {p_name}" if p_name != top_name else top_name
            else:
                admin = top_name

    if id_ in tw_roman:
        aliases.append(tw_roman[id_])
    if id_ in scenic_aliases:
        aliases.append(scenic_aliases[id_])
    if id_ == '7108':
        aliases.append('新竹')
    elif id_ == '7109':
        aliases.append('嘉义')

    # Only keep ext_name when it carries more than name + administrative suffix (e.g. 恩施土家族苗族自治州).
    full = '' if any(ext_name == name + s for s in suffixes) else ext_name
    entries.append([name, full, admin, round(lat, 4), round(lng, 4), level, py, py_init, tz, '|'.join(aliases)])

# Kinmen and Lienchiang (Matsu) are missing from the mainland-coded dataset.
entries.extend([
    ['金门', '', '中国台湾', 24.4362, 118.3186, 1, 'jinmen|kinmen', 'jm', 'Asia/Taipei', '中国台湾金门'],
    ['连江', '', '中国台湾', 26.1580, 119.9519, 1, 'lianjiang|mazu|matsu|lienchiang', 'lj|mz', 'Asia/Taipei', '马祖|马祖列岛|中国台湾连江'],
    ['金城', '', '中国台湾 · 金门', 24.3840, 118.3013, 2, 'jincheng', 'jc', 'Asia/Taipei', ''],
    ['金湖', '', '中国台湾 · 金门', 24.4150, 118.4037, 2, 'jinhu', 'jh', 'Asia/Taipei', ''],
    ['金沙', '', '中国台湾 · 金门', 24.4587, 118.4084, 2, 'jinsha', 'js', 'Asia/Taipei', ''],
    ['金宁', '', '中国台湾 · 金门', 24.4248, 118.3171, 2, 'jinning', 'jn', 'Asia/Taipei', ''],
    ['烈屿', '', '中国台湾 · 金门', 24.4017, 118.2279, 2, 'lieyu', 'ly', 'Asia/Taipei', '小金门'],
    ['乌坵', '', '中国台湾 · 金门', 24.9923, 119.4527, 2, 'wuqiu', 'wq', 'Asia/Taipei', '乌丘'],
    ['南竿', '', '中国台湾 · 连江', 26.1543, 119.9311, 2, 'nangan', 'ng', 'Asia/Taipei', '马祖南竿'],
    ['北竿', '', '中国台湾 · 连江', 26.2256, 119.9943, 2, 'beigan', 'bg', 'Asia/Taipei', '马祖北竿'],
    ['莒光', '', '中国台湾 · 连江', 25.9730, 119.9389, 2, 'juguang', 'jg', 'Asia/Taipei', ''],
    ['东引', '', '中国台湾 · 连江', 26.3661, 120.4903, 2, 'dongyin', 'dy', 'Asia/Taipei', ''],
])

# Traditional -> simplified map for normalising Taiwanese input at runtime.
t2s_pairs = []
for code in range(0x4E00, 0x9FFF + 1):
    ch = chr(code)
    sc = to_simp(ch)
    if sc != ch and len(sc) == 1:
        t2s_pairs.append(ch + sc)
t2s_str = ''.join(t2s_pairs)

zones = ['Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Macau']
rows = [[n, full, admin, la, ln, lv, py, pi, zones.index(tz), al]
        for (n, full, admin, la, ln, lv, py, pi, tz, al) in entries]
assert len({tuple(r) for r in rows}) == len(rows), 'duplicate rows'

template = '''// Generated by tools/build-china-cities.py. Do not edit by hand.
// %(count)s domestic cities, counties, districts and townships (including Taiwan, Hong Kong and Macao).
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondCities = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const T2S = %(t2s)s;
  const ZONES = %(zones)s;
  // [name, fullName, admin, latitude, longitude, level, pinyin, initials, zone, aliases]
  const ROWS = %(rows)s;
%(runtime)s
});
'''

runtime = r'''  const SUFFIX_TOKENS = ["特别行政区", "自治州", "自治县", "自治区", "地区", "林区", "矿区", "特区", "街道", "省", "市", "盟", "县", "区", "乡", "镇"];
  const ETHNIC_TOKENS = ["土家族", "布依族", "哈尼族", "傈僳族", "拉祜族", "柯尔克孜", "蒙古族", "朝鲜族", "哈萨克", "维吾尔", "仫佬族", "毛南族", "仡佬族", "塔吉克", "东乡族", "保安族", "撒拉族", "回族", "苗族", "侗族", "彝族", "壮族", "藏族", "羌族", "傣族", "黎族", "佤族", "白族", "纳西族", "景颇族", "满族", "土族", "水族", "瑶族", "锡伯族", "赫哲族", "鄂伦春族", "鄂温克族", "达斡尔族", "族"];
  const SUFFIX_ALT = SUFFIX_TOKENS.join("|");
  const SUFFIX_INNER = new RegExp("(?<=.)(" + SUFFIX_ALT + ")(?=.)", "g");
  const SUFFIX_LEAD = new RegExp("^(?:" + SUFFIX_ALT + ")+");
  const SUFFIX_END = new RegExp("(" + SUFFIX_ALT + ")$");
  const ETHNIC_END = new RegExp("((?:" + ETHNIC_TOKENS.join("|") + ")+)$");
  const T2S_MAP = new Map();
  for (let i = 0; i < T2S.length; i += 2) T2S_MAP.set(T2S[i], T2S[i + 1]);

  function normalize(text) {
    const out = String(text == null ? "" : text).toLowerCase();
    let mapped = "";
    for (const ch of out) mapped += T2S_MAP.get(ch) || ch;
    return mapped.replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  // Drop administrative and ethnic suffixes: 江苏省宿迁市 -> 江苏宿迁, 恩施土家族苗族自治州 -> 恩施.
  function bare(text) {
    let out = text;
    for (;;) {
      const before = out;
      out = out.replace(SUFFIX_INNER, "").replace(SUFFIX_LEAD, "");
      if (out.length >= 3) out = out.replace(SUFFIX_END, "");
      if (out.length >= 3) out = out.replace(ETHNIC_END, "");
      if (out === before) break;
    }
    return out;
  }

  // "江苏 · 宿迁" -> ["江苏宿迁", "江苏", "宿迁"]; "中国台湾 · 新北" also yields "台湾".
  function adminVariants(admin) {
    const parts = admin.split("·").map((part) => bare(normalize(part))).filter(Boolean);
    const variants = new Set([parts.join("")]);
    for (const part of parts) {
      variants.add(part);
      if (part.startsWith("中国") && part.length > 2) variants.add(part.slice(2));
    }
    const full = parts.join("");
    if (full.startsWith("中国") && full.length > 2) variants.add(full.slice(2));
    return Array.from(variants).filter(Boolean);
  }

  function prepare(row) {
    const [name, fullName, admin, latitude, longitude, level, pinyin, initials, zone, aliases] = row;
    const names = new Set([bare(normalize(name))]);
    if (fullName) names.add(bare(normalize(fullName)));
    const nameList = Array.from(names);
    const aliasList = aliases ? aliases.split("|").map((a) => bare(normalize(a))) : [];
    const combos = [];
    for (const n of nameList) for (const a of adminVariants(admin)) combos.push({ admin: a, full: a + n });
    const shortAdmin = admin.replace(/^中国/, "").replace(/\s*·\s*/, " ");
    const standalone = level === 1 && (shortAdmin === name || bare(shortAdmin) === bare(name) || name === "中国" + shortAdmin);
    return {
      name, admin1: admin, shortAdmin, latitude, longitude, level, timezone: ZONES[zone],
      label: standalone ? name : name + " · " + shortAdmin,
      names, nameList, aliases: aliasList, combos,
      pinyin: pinyin ? pinyin.split("|") : [], initials: initials ? initials.split("|") : [],
    };
  }

  let INDEX = null;
  function index() {
    if (!INDEX) INDEX = ROWS.map(prepare);
    return INDEX;
  }

  function startsWithAny(list, q) {
    for (const item of list) if (item.startsWith(q)) return true;
    return false;
  }
  function includesAny(list, q) {
    for (const item of list) if (item.indexOf(q) >= 0) return true;
    return false;
  }

  // Lower is better. Exact names beat combos, combos beat prefixes, prefixes beat substrings.
  function score(row, q) {
    if (row.names.has(q)) return row.level === 1 ? 0 : 1;
    if (row.aliases.indexOf(q) >= 0) return row.level === 1 ? 0 : 1;
    if (row.pinyin.indexOf(q) >= 0) return 2;
    for (const c of row.combos) if (c.full === q) return 3;
    if (q.length >= 2 && startsWithAny(row.nameList, q)) return 4;
    if (q.length >= 2 && startsWithAny(row.aliases, q)) return 5;
    if (q.length >= 2) {
      for (const c of row.combos) if (c.full.startsWith(q)) return 6;
    }
    if (q.length >= 2 && includesAny(row.nameList, q)) return 7;
    if (row.initials.indexOf(q) >= 0) return 8;
    if (q.length >= 2 && startsWithAny(row.pinyin, q)) return 9;
    if (q.length >= 2) {
      for (const c of row.combos) if (c.full.indexOf(q) >= 0) return 10;
    }
    if (q.length >= 3 && startsWithAny(row.initials, q)) return 11;
    if (startsWithAny(row.nameList, q)) return 12;
    return -1;
  }

  function search(query, limit) {
    const q = normalize(query);
    if (!q) return [];
    const stripped = bare(q);
    const needle = (stripped.length >= 2 && stripped.startsWith("中国") ? stripped.slice(2) : stripped) || q;
    const hits = [];
    for (const row of index()) {
      const s = score(row, needle);
      if (s >= 0) hits.push({ row: Object.assign({}, row, { score: s }), s });
    }
    hits.sort((a, b) => a.s - b.s || a.row.level - b.row.level ||
      a.row.nameList[0].length - b.row.nameList[0].length || a.row.name.localeCompare(b.row.name, "zh"));
    const out = [];
    const seen = new Set();
    for (const { row } of hits) {
      const key = row.name + "|" + row.admin1;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= (limit || 8)) break;
    }
    return out;
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Closest entry; maxLevel 1 restricts to provinces, prefecture-level cities and Taiwan counties.
  function nearest(latitude, longitude, maxKm, maxLevel) {
    let best = null, bestKm = Infinity;
    for (const row of index()) {
      if (maxLevel && row.level > maxLevel) continue;
      const km = distanceKm(latitude, longitude, row.latitude, row.longitude);
      if (km < bestKm) { best = row; bestKm = km; }
    }
    if (!best || (maxKm && bestKm > maxKm)) return null;
    best.distanceKm = bestKm;
    return best;
  }

  // Resolve a city name (Chinese, traditional, pinyin or Taiwanese romanization) or a position into a local entry.
  function resolvePlace(query, latitude, longitude, maxKm) {
    const hasCoords = typeof latitude === "number" && typeof longitude === "number";
    const limit = maxKm || 300;
    if (query) {
      const q = normalize(query);
      if (q && (/\p{Script=Han}/u.test(q) || /^[a-z]+$/.test(q))) {
        const hits = search(q, hasCoords ? 6 : 1);
        if (hits.length) {
          if (!hasCoords) return hits[0];
          // "Suzhou" is both 苏州 and 宿州: trust the coordinates to pick between same-named hits.
          let best = null, bestKm = Infinity;
          for (const hit of hits) {
            const km = distanceKm(latitude, longitude, hit.latitude, hit.longitude);
            if (km < bestKm) { best = hit; bestKm = km; }
          }
          if (bestKm <= limit) return best;
        }
      }
    }
    return hasCoords ? nearest(latitude, longitude, limit, 1) : null;
  }

  function key(text) { return bare(normalize(text)); }

  function all() { return index().slice(); }

  return { normalize, key, search, nearest, resolvePlace, all };
'''

with open(OUTPUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write(template % {
        'count': len(rows), 't2s': json.dumps(t2s_str, ensure_ascii=False), 'zones': json.dumps(zones),
        'rows': json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('],[', '],\n    ['),
        'runtime': runtime,
    })

print('entries:', len(rows), 't2s pairs:', len(t2s_pairs), 'bytes:', os.path.getsize(OUTPUT))

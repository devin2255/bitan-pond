"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cities = require("../web/china-cities.js");

const first = (q) => cities.search(q, 1)[0];
const names = (q, limit = 8) => cities.search(q, limit).map((row) => row.name);

test("normalises traditional Chinese, case and punctuation", () => {
  assert.equal(cities.normalize("臺北市"), "台北市");
  assert.equal(cities.normalize(" Jiang Su, CN "), "jiangsucn");
  assert.equal(cities.normalize("花蓮縣"), "花莲县");
  assert.equal(cities.key("板橋區"), cities.key("板桥区"));
  assert.notEqual(cities.key("宿迁"), cities.key("沭阳"));
});

test("宿迁 resolves by short name, full name, province prefix and pinyin", () => {
  for (const q of ["宿迁", "宿迁市", "江苏宿迁", "江苏省宿迁市", "中国江苏宿迁", "Suqian", "suqian", "suqi"]) {
    const row = first(q);
    assert.ok(row, q);
    assert.equal(row.name, "宿迁", q);
    assert.equal(row.level, 1, q);
    assert.equal(row.admin1, "江苏", q);
    assert.equal(row.timezone, "Asia/Shanghai", q);
    assert.ok(Math.abs(row.latitude - 33.96) < 0.1 && Math.abs(row.longitude - 118.27) < 0.1, q);
  }
  assert.ok(names("sq").includes("宿迁"), "sq");
});

test("宿迁 counties and province + county combinations resolve", () => {
  for (const q of ["沭阳", "沭阳县", "泗阳", "泗洪", "宿城", "宿豫"]) {
    const row = first(q);
    assert.ok(row, q);
    assert.equal(row.name, q.replace(/县$/, ""), q);
    assert.equal(row.level, 2, q);
    assert.match(row.admin1, /^江苏 · 宿迁$/, q);
  }
  assert.equal(first("宿迁沭阳").name, "沭阳");
  assert.equal(first("江苏沭阳").name, "沭阳");
  assert.equal(first("江苏省宿迁市沭阳县").name, "沭阳");
});

test("all 34 provincial-level divisions resolve to a level-1 entry", () => {
  const divisions = ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江",
    "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港", "澳门", "台湾"];
  for (const q of divisions) {
    const row = first(q);
    assert.ok(row, q);
    assert.equal(row.level, 1, q);
    assert.equal(row.name, q === "台湾" ? "中国台湾" : q, q);
  }
  for (const [q, short] of [["广西壮族自治区", "广西"], ["新疆维吾尔自治区", "新疆"], ["内蒙古自治区", "内蒙古"],
    ["宁夏回族自治区", "宁夏"], ["西藏自治区", "西藏"], ["香港特别行政区", "香港"], ["澳门特别行政区", "澳门"]]) {
    assert.equal(first(q).name, short, q);
  }
});

test("all 22 Taiwan cities and counties resolve in simplified and traditional Chinese", () => {
  const pairs = [["台北", "臺北"], ["新北", "新北"], ["桃园", "桃園"], ["台中", "臺中"], ["台南", "臺南"], ["高雄", "高雄"],
    ["基隆", "基隆"], ["新竹", "新竹"], ["嘉义", "嘉義"], ["苗栗", "苗栗"], ["彰化", "彰化"], ["南投", "南投"],
    ["云林", "雲林"], ["屏东", "屏東"], ["宜兰", "宜蘭"], ["花莲", "花蓮"], ["台东", "臺東"], ["澎湖", "澎湖"],
    ["金门", "金門"], ["连江", "連江"]];
  for (const [simp, trad] of pairs) {
    for (const q of [simp, trad, simp + "市", simp + "县"]) {
      const row = first(q);
      assert.ok(row, q);
      assert.equal(row.level, 1, q);
      assert.equal(row.admin1, "中国台湾", q);
      assert.equal(row.timezone, "Asia/Taipei", q);
      assert.ok(cities.normalize(row.name).startsWith(simp), `${q} -> ${row.name}`);
    }
  }
  assert.equal(first("马祖").name, "连江");
  assert.equal(first("中国台湾").name, "中国台湾");
});

test("Taiwan townships and well-known places resolve with their county", () => {
  for (const [q, name, admin] of [["板桥", "板桥", "新北"], ["板橋", "板桥", "新北"], ["中坜", "中坜", "桃园"], ["中壢", "中坜", "桃园"],
    ["恒春", "恒春", "屏东"], ["垦丁", "恒春", "屏东"], ["阿里山", "阿里山", "嘉义县"], ["日月潭", "鱼池", "南投"],
    ["九份", "瑞芳", "新北"], ["台北市大安区", "大安", "台北"], ["新北板桥", "板桥", "新北"]]) {
    const row = first(q);
    assert.ok(row, q);
    assert.equal(row.name, name, q);
    assert.equal(row.level, 2, q);
    assert.equal(row.admin1, "中国台湾 · " + admin, q);
  }
});

test("Taiwanese romanizations and province + city combinations resolve", () => {
  for (const [q, name] of [["taipei", "台北"], ["Taichung", "台中"], ["kaohsiung", "高雄"], ["tainan", "台南"],
    ["hualien", "花莲"], ["kinmen", "金门"], ["matsu", "连江"], ["newtaipei", "新北"], ["yilan", "宜兰"],
    ["hongkong", "香港"], ["macau", "澳门"]]) {
    assert.equal(first(q).name, name, q);
  }
  assert.equal(first("台湾花莲").name, "花莲");
  assert.equal(first("中国台湾花莲").name, "花莲");
  assert.equal(first("江苏南京").name, "南京");
  assert.equal(first("浙江杭州").name, "杭州");
  assert.equal(first("台湾台北").name, "台北");
});

test("ambiguous names rank the prefecture-level city before same-named districts", () => {
  const rows = cities.search("朝阳", 8);
  assert.equal(rows[0].name, "朝阳");
  assert.equal(rows[0].admin1, "辽宁");
  assert.equal(rows[0].level, 1);
  assert.ok(rows.some((row) => row.admin1 === "北京市"));
  assert.equal(names("沙市")[0], "沙市");
  assert.equal(cities.search("台北", 8)[0].level, 1);
  assert.ok(cities.search("宿迁", 8).slice(1).every((row) => row.level === 2 && row.score > 1));
});

test("nearest and resolvePlace map coordinates and IP city names to local entries", () => {
  assert.equal(cities.nearest(33.96, 118.27, 300, 1).name, "宿迁");
  assert.equal(cities.nearest(25.03, 121.56, 300, 1).name, "台北");
  assert.equal(cities.nearest(22.28, 114.16, 300, 1).name, "香港");
  assert.equal(cities.nearest(35.68, 139.69, 300, 1), null);
  assert.equal(cities.resolvePlace("Suqian").name, "宿迁");
  assert.equal(cities.resolvePlace("Suzhou", 31.30, 120.58).name, "苏州");
  assert.equal(cities.resolvePlace("Suzhou", 33.63, 116.98).name, "宿州");
  assert.equal(cities.resolvePlace("朝阳", 39.92, 116.44).admin1, "北京市");
  assert.equal(cities.resolvePlace("Suqian", 33.96, 118.27).name, "宿迁");
  assert.equal(cities.resolvePlace("Taipei", 25.03, 121.56).name, "台北");
  assert.equal(cities.resolvePlace("板橋", 25.01, 121.46).name, "板桥");
  assert.equal(cities.nearest(34.11, 118.80).name, "沭阳");
  assert.equal(cities.resolvePlace("", 34.11, 118.80, 120).name, "宿迁");
  assert.equal(cities.resolvePlace("Vladivostok", 43.1, 131.9, 120), null);
  assert.equal(cities.resolvePlace("Tokyo", 35.68, 139.69, 120), null);
});

test("index is complete and every entry carries usable coordinates and a timezone", () => {
  const rows = new Map();
  for (const row of cities.all()) rows.set(row.name + row.admin1, row);
  assert.equal(rows.size, cities.all().length);
  assert.ok(rows.size > 3000);
  const provinces = new Set();
  let taiwan = 0;
  for (const row of rows.values()) {
    assert.ok(Number.isFinite(row.latitude) && Number.isFinite(row.longitude), row.name);
    assert.ok(row.latitude > 3 && row.latitude < 55 && row.longitude > 72 && row.longitude < 136, row.name + " " + row.latitude + "," + row.longitude);
    assert.ok(["Asia/Shanghai", "Asia/Taipei", "Asia/Hong_Kong", "Asia/Macau"].includes(row.timezone), row.name);
    assert.ok(row.level === 1 || row.level === 2, row.name);
    assert.ok(row.label.length > 0, row.name);
    if (row.level === 1) provinces.add(row.admin1.replace(/^中国/, "").split(" ")[0]);
    if (row.admin1.startsWith("中国台湾")) taiwan++;
  }
  assert.ok(provinces.size >= 34, "provinces: " + provinces.size);
  assert.ok(taiwan >= 390, "taiwan entries: " + taiwan);
});

test("weather page loads the offline index before ui.js and ui.js uses it", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "web", "ui.js"), "utf8");
  assert.ok(html.indexOf('src="china-cities.js') < html.indexOf('src="ui.js'), "script order");
  assert.ok(ui.includes("cities.search(") && ui.includes("cities.resolvePlace("), "ui integration");
});

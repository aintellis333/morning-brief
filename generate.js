#!/usr/bin/env node
/**
 * Morning Brief — generate.js
 * Fetches live data from Tavily, Gmail (gog), Calendar (gog), and wttr.in,
 * then writes a self-contained public/index.html and pushes to GitHub.
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAVILY_KEY = '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';

// ── UTILITIES ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], ...opts }).trim();
  } catch (e) {
    console.warn(`[warn] Command failed: ${cmd}\n${e.message}`);
    return '';
  }
}

async function tavilySearch(query, category) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        topic: 'news',
        search_depth: 'advanced',
        max_results: 8
      })
    });
    const data = await res.json();
    return (data.results || []).map(r => ({
      title: r.title || '',
      snippet: (r.content || '').slice(0, 280).trim(),
      full: (r.content || '').slice(0, 800).trim(),
      source: new URL(r.url).hostname.replace(/^www\./, '').split('.')[0],
      url: r.url,
      category,
      time: r.published_date ? new Date(r.published_date).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : ''
    }));
  } catch (e) {
    console.warn(`[warn] Tavily search failed for "${query}": ${e.message}`);
    return [];
  }
}

function parseGmailOutput(raw) {
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('ID'));
  return lines.slice(0, 10).map(line => {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 4) return null;
    return {
      id: cols[0] || '',
      date: cols[1] || '',
      from: cols[2] || '',
      subject: cols[3] || '',
      unread: line.includes('UNREAD')
    };
  }).filter(Boolean);
}

function parseCalendarOutput(raw) {
  if (!raw || raw.trim() === '') return [];
  const lines = raw.split('\n').filter(l => l.trim());
  return lines.slice(0, 10).map(l => ({ title: l.trim() }));
}

async function fetchWeather() {
  try {
    const res = await fetch('https://wttr.in/New+York?format=j1');
    const data = await res.json();
    const cur = data.current_condition?.[0] || {};
    return {
      temp_c: cur.temp_C || '?',
      temp_f: cur.temp_F || '?',
      desc: cur.weatherDesc?.[0]?.value || 'Unknown',
      humidity: cur.humidity || '?',
      wind_dir: cur.winddir16Point || '',
      wind_mph: cur.windspeedMiles || '?',
      icon: getWeatherIcon(parseInt(cur.weatherCode || '113'))
    };
  } catch (e) {
    console.warn('[warn] Weather fetch failed:', e.message);
    return { temp_c: '?', temp_f: '?', desc: 'Unavailable', humidity: '?', wind_dir: '', wind_mph: '?', icon: '🌡' };
  }
}

function getWeatherIcon(code) {
  if (code === 113) return '☀️';
  if ([116, 119, 122].includes(code)) return '⛅';
  if ([143, 248, 260].includes(code)) return '🌫';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 320, 323, 326].includes(code)) return '🌧';
  if ([329, 332, 335, 338, 350, 353, 356, 359, 362, 365, 368, 371, 374, 377].includes(code)) return '❄️';
  if ([386, 389, 392, 395].includes(code)) return '⛈';
  return '🌡';
}

function catColor(cat) {
  const map = { top: '#1d9bf0', ai: '#7856ff', finance: '#00ba7c', world: '#f4212e', openclaw: '#ff3cac' };
  return map[cat] || '#8b98a5';
}

function catLabel(cat) {
  const map = { top: 'Top', ai: 'AI', finance: 'Finance', tech: 'Tech', world: 'World', openclaw: 'OpenClaw' };
  return map[cat] || cat;
}

function sourceColor(source) {
  const hash = source.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = ['#1d9bf0','#7856ff','#00ba7c','#ff7a00','#f4212e','#ff3cac','#ffd400','#536471'];
  return colors[hash % colors.length];
}

// ── HTML TEMPLATE ─────────────────────────────────────────────────────────────

function buildHTML({ articles, emails, calEvents, weather, generated }) {
  const hero = articles.find(a => a.category === 'world') || articles[0];
  const byCategory = {
    top: articles.filter(a => a.category === 'top'),
    ai: articles.filter(a => a.category === 'ai'),
    finance: articles.filter(a => a.category === 'finance'),
    world: articles.filter(a => a.category === 'world'),
    openclaw: articles.filter(a => a.category === 'openclaw'),
  };

  const unreadCount = emails.filter(e => e.unread).length;
  const dateStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  const tickerItems = articles.slice(0, 8).map(a =>
    `<span class="ticker-item">${a.title} <span class="ticker-sep">|</span></span>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Morning Brief — ${dateStr}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #000000; --surface: #0f0f0f; --surface2: #161616; --surface3: #1e1e1e;
      --border: #2a2a2a; --border2: #333; --text: #e7e9ea; --text2: #8b98a5; --text3: #536471;
      --accent: #1d9bf0; --red: #f4212e; --green: #00ba7c;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif;
      font-size: 15px; line-height: 1.5; min-height: 100vh; -webkit-font-smoothing: antialiased; }
    .ticker { background: var(--accent); padding: 6px 0; overflow: hidden; }
    .ticker-inner { display: flex; gap: 60px; animation: ticker-scroll 40s linear infinite; white-space: nowrap; width: max-content; }
    @keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    .ticker-item { font-size: 12px; font-weight: 600; color: #fff; }
    .ticker-sep { opacity: 0.5; }
    .topbar { position: sticky; top: 0; z-index: 100; background: rgba(0,0,0,0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); }
    .topbar-inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; gap: 20px; height: 56px; }
    .logo { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
    .logo span { color: var(--accent); }
    .topbar-right { margin-left: auto; display: flex; align-items: center; gap: 16px; }
    .timestamp { font-size: 12px; color: var(--text3); white-space: nowrap; }
    .weather-pill { display: flex; align-items: center; gap: 8px; background: var(--surface2); border: 1px solid var(--border); border-radius: 24px; padding: 6px 14px; font-size: 13px; white-space: nowrap; }
    .weather-temp { font-weight: 600; }
    .weather-desc, .weather-humidity { color: var(--text2); }
    .weather-humidity { font-size: 12px; color: var(--text3); }
    .tabs-wrap { background: var(--bg); border-bottom: 1px solid var(--border); position: sticky; top: 56px; z-index: 99; }
    .tabs { max-width: 1200px; margin: 0 auto; padding: 0 20px; display: flex; overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    .tab { position: relative; padding: 16px 18px; font-size: 14px; font-weight: 500; color: var(--text3); cursor: pointer; white-space: nowrap; border: none; background: none; outline: none; display: flex; align-items: center; gap: 6px; flex-shrink: 0; transition: color 0.15s; }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--text); }
    .tab.active::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 60%; height: 3px; background: var(--accent); border-radius: 3px 3px 0 0; }
    .badge { background: var(--red); color: #fff; font-size: 10px; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; }
    .main { max-width: 1200px; margin: 0 auto; padding: 28px 20px 60px; width: 100%; }
    .hero { border-radius: 16px; overflow: hidden; margin-bottom: 32px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid var(--border); }
    .hero:hover { transform: translateY(-2px); box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
    .hero-bg { background: linear-gradient(135deg, #0a0a1a 0%, #1a0a1a 40%, #1a0808 100%); padding: 40px; position: relative; }
    .hero-bg::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 50%, rgba(244,33,46,0.12), transparent 70%); }
    .hero-label { display: inline-flex; align-items: center; gap: 6px; background: rgba(244,33,46,0.15); border: 1px solid rgba(244,33,46,0.3); color: #ff6b7a; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; margin-bottom: 16px; position: relative; }
    .hero-label::before { content: ''; width: 6px; height: 6px; background: var(--red); border-radius: 50%; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .hero-title { font-size: 28px; font-weight: 800; line-height: 1.25; letter-spacing: -0.5px; margin-bottom: 14px; position: relative; max-width: 700px; }
    .hero-snippet { font-size: 15px; color: var(--text2); line-height: 1.6; max-width: 640px; position: relative; margin-bottom: 20px; }
    .hero-footer { display: flex; align-items: center; gap: 16px; position: relative; }
    .hero-source { display: flex; align-items: center; gap: 8px; }
    .source-icon { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
    .hero-source-name { font-size: 13px; font-weight: 600; color: var(--text2); }
    .hero-time { font-size: 12px; color: var(--text3); }
    .hero-read { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--accent); }
    .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .section-title { font-size: 13px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text3); }
    .section-line { flex: 1; height: 1px; background: var(--border); }
    .all-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 32px; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 32px; }
    .card { background: var(--surface); padding: 18px 20px; cursor: pointer; transition: background 0.15s; }
    .card:hover { background: var(--surface2); }
    .card.expanded { background: var(--surface2); }
    .cat-pill { display: inline-flex; align-items: center; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; margin-bottom: 8px; color: #000; }
    .card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .card-source { display: flex; align-items: center; gap: 6px; }
    .card-source-name { font-size: 12px; font-weight: 600; color: var(--text3); }
    .card-meta { margin-left: auto; font-size: 11px; color: var(--text3); }
    .card-title { font-size: 15px; font-weight: 700; line-height: 1.35; margin-bottom: 8px; }
    .card-snippet { font-size: 13px; color: var(--text2); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-expand { max-height: 0; overflow: hidden; transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1); }
    .card.expanded .card-expand { max-height: 400px; }
    .card.expanded .card-snippet { -webkit-line-clamp: unset; overflow: visible; }
    .card-full-text { font-size: 13px; color: var(--text2); line-height: 1.6; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
    .card-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .card-read-link { font-size: 12px; font-weight: 600; color: var(--accent); text-decoration: none; }
    .card-read-link:hover { text-decoration: underline; }
    .card-expand-btn { font-size: 11px; color: var(--text3); }
    .sidebar-feed { display: flex; flex-direction: column; gap: 1px; }
    .sidebar-card { background: var(--surface); border: 1px solid var(--border); padding: 14px 16px; cursor: pointer; transition: background 0.15s; }
    .sidebar-card:first-child { border-radius: 12px 12px 0 0; }
    .sidebar-card:last-child { border-radius: 0 0 12px 12px; }
    .sidebar-card:not(:last-child) { border-bottom: none; }
    .sidebar-card:hover { background: var(--surface2); }
    .sidebar-card-title { font-size: 13px; font-weight: 600; line-height: 1.4; }
    .list-feed { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 32px; }
    .list-item { display: flex; gap: 14px; padding: 16px 20px; background: var(--surface); border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s; }
    .list-item:last-child { border-bottom: none; }
    .list-item:hover { background: var(--surface2); }
    .list-item.expanded { background: var(--surface2); }
    .list-num { font-size: 24px; font-weight: 800; color: var(--border2); min-width: 32px; line-height: 1; margin-top: 2px; flex-shrink: 0; }
    .list-content { flex: 1; min-width: 0; }
    .list-title { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 5px; line-height: 1.35; }
    .list-snippet { font-size: 13px; color: var(--text2); line-height: 1.55; }
    .list-expanded-text { font-size: 13px; color: var(--text2); line-height: 1.6; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); display: none; }
    .list-item.expanded .list-expanded-text { display: block; }
    .list-footer { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
    .list-footer-source { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text3); font-weight: 500; }
    .list-time { font-size: 11px; color: var(--text3); }
    .list-link { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--accent); text-decoration: none; }
    .list-link:hover { text-decoration: underline; }
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.25s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .email-section { margin-bottom: 32px; }
    .email-list { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .email-item { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .email-item:last-child { border-bottom: none; }
    .email-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; }
    .email-from { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
    .email-subject { font-size: 13px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .email-date { font-size: 11px; color: var(--text3); }
    .unread-dot { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; }
    .cal-empty { padding: 32px; text-align: center; color: var(--text3); font-size: 13px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: var(--text3); border-top: 1px solid var(--border); }
    .footer a { color: var(--accent); text-decoration: none; }
    @media (max-width: 900px) { .all-grid { grid-template-columns: 1fr; } .hero-title { font-size: 22px; } }
    @media (max-width: 640px) { .weather-desc, .weather-humidity { display: none; } .main { padding: 16px 12px 40px; } .hero-bg { padding: 20px; } .hero-title { font-size: 19px; } }
  </style>
</head>
<body>
<div>
  <div class="ticker"><div class="ticker-inner">${tickerItems}${tickerItems}</div></div>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="logo">Morning<span>Brief</span></div>
      <div class="topbar-right">
        <div class="weather-pill">
          <span>${weather.icon}</span>
          <span class="weather-temp">${weather.temp_c}°C / ${weather.temp_f}°F</span>
          <span class="weather-desc">${weather.desc}</span>
          <span class="weather-humidity">· ${weather.humidity}% humidity · ${weather.wind_dir} ${weather.wind_mph}mph</span>
        </div>
        <div class="timestamp">Generated ${generated}</div>
      </div>
    </div>
  </header>
  <nav class="tabs-wrap">
    <div class="tabs">
      <button class="tab active" data-tab="all">All</button>
      <button class="tab" data-tab="top">Top News</button>
      <button class="tab" data-tab="ai">AI &amp; Tech</button>
      <button class="tab" data-tab="finance">Finance</button>
      <button class="tab" data-tab="world">World</button>
      <button class="tab" data-tab="openclaw">OpenClaw</button>
      <button class="tab" data-tab="email">Email &amp; Cal <span class="badge">${unreadCount}</span></button>
    </div>
  </nav>
  <main class="main">
    <div class="tab-content active" id="tab-all">
      <div class="hero" onclick="window.open('${hero.url}','_blank')">
        <div class="hero-bg">
          <div class="hero-label">Top Story</div>
          <h1 class="hero-title">${hero.title}</h1>
          <p class="hero-snippet">${hero.full.slice(0,300)}...</p>
          <div class="hero-footer">
            <div class="hero-source">
              <div class="source-icon" style="background:${sourceColor(hero.source)};color:#fff;">${hero.source[0].toUpperCase()}</div>
              <span class="hero-source-name">${hero.source}</span>
              <span class="hero-time">· ${hero.time}</span>
            </div>
            <div class="hero-read">Read story →</div>
          </div>
        </div>
      </div>
      <div class="all-grid">
        <div>
          <div class="section-head"><span class="section-title">Featured</span><div class="section-line"></div></div>
          <div class="cards-grid" id="allMainCards"></div>
        </div>
        <div>
          <div class="section-head"><span class="section-title">Quick Scan</span><div class="section-line"></div></div>
          <div class="sidebar-feed" id="allSidebar"></div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-top">
      <div class="section-head"><span class="section-title">Top News</span><div class="section-line"></div></div>
      <div class="list-feed" id="topList"></div>
    </div>
    <div class="tab-content" id="tab-ai">
      <div class="section-head"><span class="section-title">AI &amp; Technology</span><div class="section-line"></div></div>
      <div class="list-feed" id="aiList"></div>
    </div>
    <div class="tab-content" id="tab-finance">
      <div class="section-head"><span class="section-title">Financial Markets</span><div class="section-line"></div></div>
      <div class="list-feed" id="financeList"></div>
    </div>
    <div class="tab-content" id="tab-world">
      <div class="section-head"><span class="section-title">World &amp; Geopolitics</span><div class="section-line"></div></div>
      <div class="list-feed" id="worldList"></div>
    </div>
    <div class="tab-content" id="tab-openclaw">
      <div class="section-head"><span class="section-title">OpenClaw AI</span><div class="section-line"></div></div>
      <div class="list-feed" id="openclawList"></div>
    </div>
    <div class="tab-content" id="tab-email">
      <div class="email-section">
        <div class="section-head"><span class="section-title">Unread Email</span><div class="section-line"></div></div>
        <div class="email-list" id="emailList"></div>
      </div>
      <div class="email-section">
        <div class="section-head"><span class="section-title">Today's Calendar</span><div class="section-line"></div></div>
        <div id="calContent"></div>
      </div>
    </div>
  </main>
  <footer class="footer">Morning Brief · Generated ${generated} · New York, NY · <a href="https://morning-brief-zeta-dusky.vercel.app" target="_blank">morning-brief-zeta-dusky.vercel.app</a></footer>
</div>
<script>
const ARTICLES = ${JSON.stringify(articles, null, 2)};
const EMAILS = ${JSON.stringify(emails, null, 2)};
const CALENDAR_EVENTS = ${JSON.stringify(calEvents, null, 2)};

function sourceColor(source) {
  const hash = source.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return ['#1d9bf0','#7856ff','#00ba7c','#ff7a00','#f4212e','#ff3cac','#ffd400','#536471'][hash % 8];
}
function catColor(cat) {
  return {top:'#1d9bf0',ai:'#7856ff',finance:'#00ba7c',world:'#f4212e',openclaw:'#ff3cac'}[cat] || '#8b98a5';
}
function catLabel(cat) {
  return {top:'Top',ai:'AI',finance:'Finance',world:'World',openclaw:'OpenClaw'}[cat] || cat;
}
function renderList(articles, id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = articles.map((a,i) => \`
    <div class="list-item" id="li-\${a.id}" onclick="toggleList('\${a.id}')">
      <div class="list-num">\${String(i+1).padStart(2,'0')}</div>
      <div class="list-content">
        <div class="list-title">\${a.title}</div>
        <div class="list-snippet">\${a.snippet}</div>
        <div class="list-expanded-text">\${a.full}</div>
        <div class="list-footer">
          <div class="list-footer-source">
            <div style="width:18px;height:18px;border-radius:50%;background:\${sourceColor(a.source)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;">\${a.source[0].toUpperCase()}</div>
            \${a.source}
          </div>
          <span class="list-time">\${a.time}</span>
          <a class="list-link" href="\${a.url}" target="_blank" onclick="event.stopPropagation()">Read →</a>
        </div>
      </div>
    </div>
  \`).join('');
}
function toggleList(id) {
  document.getElementById('li-' + id)?.classList.toggle('expanded');
}
function renderCards(articles, id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = articles.map(a => \`
    <div class="card" id="cd-\${a.id}" onclick="toggleCard('\${a.id}')">
      <div class="cat-pill" style="background:\${catColor(a.category)};color:#fff;">\${catLabel(a.category)}</div>
      <div class="card-header">
        <div class="card-source">
          <div class="source-icon" style="background:\${sourceColor(a.source)};color:#fff;">\${a.source[0].toUpperCase()}</div>
          <span class="card-source-name">\${a.source}</span>
        </div>
        <span class="card-meta">\${a.time}</span>
      </div>
      <div class="card-title">\${a.title}</div>
      <div class="card-snippet">\${a.snippet}</div>
      <div class="card-expand">
        <div class="card-full-text">\${a.full}</div>
        <div class="card-actions">
          <span class="card-expand-btn">Collapse</span>
          <a class="card-read-link" href="\${a.url}" target="_blank" onclick="event.stopPropagation()">Read full story →</a>
        </div>
      </div>
    </div>
  \`).join('');
}
function toggleCard(id) { document.getElementById('cd-' + id)?.classList.toggle('expanded'); }
function renderSidebar(articles, id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = articles.map(a => \`
    <div class="sidebar-card" onclick="window.open('\${a.url}','_blank')">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <div style="width:16px;height:16px;border-radius:50%;background:\${catColor(a.category)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0;">\${a.source[0].toUpperCase()}</div>
        <span style="font-size:11px;color:var(--text3);font-weight:600;">\${a.source}</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto;">\${a.time}</span>
      </div>
      <div class="sidebar-card-title">\${a.title}</div>
    </div>
  \`).join('');
}
function init() {
  const byCategory = {
    top: ARTICLES.filter(a => a.category === 'top'),
    ai: ARTICLES.filter(a => a.category === 'ai'),
    finance: ARTICLES.filter(a => a.category === 'finance'),
    world: ARTICLES.filter(a => a.category === 'world'),
    openclaw: ARTICLES.filter(a => a.category === 'openclaw'),
  };
  const mainArticles = [...byCategory.ai.slice(0,2), ...byCategory.finance.slice(0,2), ...byCategory.world.slice(1,3)].filter(Boolean);
  const sidebarArticles = [...byCategory.top.slice(0,3), ...byCategory.openclaw.slice(0,2)].filter(Boolean);
  renderCards(mainArticles, 'allMainCards');
  renderSidebar(sidebarArticles, 'allSidebar');
  renderList(byCategory.top, 'topList');
  renderList(byCategory.ai, 'aiList');
  renderList(byCategory.finance, 'financeList');
  renderList(byCategory.world, 'worldList');
  renderList(byCategory.openclaw, 'openclawList');
  // Emails
  const emailEl = document.getElementById('emailList');
  if (emailEl) {
    if (EMAILS.length === 0) {
      emailEl.innerHTML = '<div class="cal-empty"><div>No unread emails</div></div>';
    } else {
      emailEl.innerHTML = EMAILS.map(e => \`
        <div class="email-item">
          <div class="email-avatar" style="background:\${e.avatar_color || '#536471'};color:#fff;">\${e.from[0].toUpperCase()}</div>
          <div class="email-body" style="flex:1;min-width:0;">
            <div class="email-from">\${e.from} <span style="font-weight:400;color:var(--text3);font-size:12px;">&lt;\${e.from_email}&gt;</span></div>
            <div class="email-subject">\${e.subject}</div>
          </div>
          <div>
            <div class="email-date">\${e.date}</div>
            \${e.unread ? '<div style="display:flex;justify-content:flex-end;margin-top:4px;"><div class="unread-dot"></div></div>' : ''}
          </div>
        </div>
      \`).join('');
    }
  }
  // Calendar
  const calEl = document.getElementById('calContent');
  if (calEl) {
    if (CALENDAR_EVENTS.length === 0) {
      calEl.innerHTML = '<div class="cal-empty"><div style="font-size:28px;margin-bottom:8px;">📅</div><div>No events scheduled for today</div></div>';
    } else {
      calEl.innerHTML = '<div class="list-feed">' + CALENDAR_EVENTS.map(e => \`<div class="list-item"><div class="list-content"><div class="list-title">\${e.title}</div></div></div>\`).join('') + '</div>';
    }
  }
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
    });
  });
}
document.addEventListener('DOMContentLoaded', init);
</script>
</body>
</html>`;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌅 Morning Brief — starting data fetch...\n');

  const [top, ai, finance, world, openclaw, weather] = await Promise.all([
    tavilySearch('top trending news in the last 12 hours', 'top'),
    tavilySearch('AI and machine learning news today', 'ai'),
    tavilySearch('financial markets and stocks news today', 'finance'),
    tavilySearch('US defense and geopolitics news today', 'world'),
    tavilySearch('OpenClaw AI', 'openclaw'),
    fetchWeather()
  ]);

  // Fetch tech separately and merge into ai category
  const tech = await tavilySearch('technology news today', 'ai');

  const articles = [...top.slice(0,4), ...ai.slice(0,5), ...tech.slice(0,3),
                    ...finance.slice(0,5), ...world.slice(0,4), ...openclaw.slice(0,5)]
    .map((a, i) => ({ ...a, id: i + 1 }));

  console.log(`✓ Fetched ${articles.length} articles from Tavily`);

  // Gmail
  const gmailRaw = run('gog gmail search "is:unread" --limit 10');
  const emailsParsed = parseGmailOutput(gmailRaw);
  const emails = emailsParsed.map(e => ({
    ...e,
    avatar_color: e.from.toLowerCase().includes('github') ? '#24292e' : '#4285f4',
    avatar_letter: e.from[0].toUpperCase()
  }));
  console.log(`✓ Found ${emails.length} unread emails`);

  // Calendar
  const calRaw = run('gog calendar events --days 1');
  const calEvents = parseCalendarOutput(calRaw);
  console.log(`✓ Found ${calEvents.length} calendar events`);

  console.log(`✓ Weather: ${weather.temp_c}°C, ${weather.desc}`);

  const generated = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  const html = buildHTML({ articles, emails, calEvents, weather, generated });

  mkdirSync(join(__dirname, 'public'), { recursive: true });
  writeFileSync(join(__dirname, 'public/index.html'), html, 'utf8');
  console.log('\n✓ Written public/index.html');

  // Commit and push
  const dateStr = new Date().toISOString().slice(0,16).replace('T',' ');
  run(`cd ${__dirname} && git add public/index.html`);
  run(`cd ${__dirname} && git commit -m "Morning brief ${dateStr}"`);
  run(`cd ${__dirname} && git push origin main`);
  console.log('✓ Committed and pushed to GitHub');

  // Notify
  run('openclaw system event --text "Morning Brief built and deployed! Check https://morning-brief-zeta-dusky.vercel.app" --mode now');
  console.log('\n🎉 Morning Brief complete! → https://morning-brief-zeta-dusky.vercel.app\n');
}

main().catch(e => { console.error(e); process.exit(1); });

/* =====================================================================
   Live-scores relay — Cloudflare Worker for the OBS scoreboard (ESPN)
   =====================================================================
   WHY ESPN: SofaScore blocks datacenter/Worker requests by TLS fingerprint
   (403 regardless of headers). ESPN's public site API is datacenter-reachable,
   CORS-enabled, free, no key, and exposes score + clock + status + crests.
   It's per-league, so this Worker fans out over a curated league list and
   merges them, giving the page one /live and one /day call.

   DEPLOY (dashboard copy-paste):
     Cloudflare -> Workers & Pages -> Create -> Worker -> paste this ->
     Deploy -> copy the *.workers.dev URL -> paste into the scoreboard's
     "Relay" field. Test: open <url>/live -> JSON with an "events" array.

   ENDPOINTS (CORS *, edge-cached):
     GET /live               -> { events:[...], diag } in-progress across leagues (cache 20s)
     GET /day?date=YYYY-MM-DD -> { events:[...], diag } that day's matches        (cache 120s)
     GET /match?id=espn:slug:eventId[&date=YYYY-MM-DD] -> { event }               (cache 15s)
     GET /debug[?date=YYYY-MM-DD] -> per-league HTTP outcome (no cache)

   TROUBLESHOOTING "no matches": open <relay>/debug. leaguesOk:0 with a 403 on
   every league means ESPN's bot filter rejected the Worker (see HEADERS below);
   leaguesOk matching leaguesTotal with inProgress:0 simply means nothing is
   being played right now.

   To cover more/other competitions, edit LEAGUES below (ESPN slugs).
   Crests are direct ESPN CDN URLs (work in <img> without CORS).
   ===================================================================== */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/soccer';

// Do NOT send a spoofed Chrome User-Agent here. ESPN sits behind Akamai bot
// manager, which scores the UA together with the caller's TLS/HTTP fingerprint:
// a browser UA from a non-browser client is a mismatch and can be answered with
// 403 "Access Denied" on every league (reproducible from curl; Node's fetch is
// currently let through, so the outcome varies by runtime). A plain client UA
// plus gzip is treated as an ordinary API client and passed by both.
// If /debug ever shows 403s, this header block is the first thing to change.
const HEADERS = {
  'User-Agent': 'obs-scoreboard-relay/1.0',
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip',
};

// Curated competitions (ESPN slugs). Keep under ~40 (Worker subrequest limit 50).
const LEAGUES = [
  'fifa.world', 'fifa.friendly', 'fifa.worldq.conmebol', 'fifa.worldq.uefa',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'uefa.euro',
  'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.america',
  // 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1', 'ned.1', 'usa.1', 'mex.1', 'arg.1', 'bra.1', 'col.1', 'uru.1', 'per.1', 'ecu.1', 'par.1',
  'chi.1', 'chi.2', 'chi.super_cup', 'chi.copa_chi',
];


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/live': return json(await getLive(), 20);
        case '/day': return json(await getDay(url.searchParams.get('date')), 120);
        case '/match': return json(await getMatch(url.searchParams.get('id'), url.searchParams.get('date')), 15);
        case '/shots': return json(await getShots(url.searchParams.get('id')), 15);
        case '/leagues': return json(await getLeagues(), 3600);
        case '/debug': return json(await getDebug(url.searchParams.get('date')), 0);
        case '/':
        case '': return json({ ok: true, leagues: LEAGUES.length, endpoints: ['/live', '/day?date=YYYY-MM-DD', '/match?id=espn:slug:eventId', '/shots?id=espn:slug:eventId', '/leagues', '/debug'] }, 60);
        default: return json({ error: 'not found' }, 0, 404);
      }
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 0, 502);
    }
  },
};

function json(obj, maxAge, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}`, ...CORS },
  });
}

async function espn(path, ttl = 20) {
  const res = await fetch(ESPN + path, { headers: HEADERS, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error('espn ' + res.status);
  return res.json();
}

// Discovery: every ESPN soccer competition slug (to add to LEAGUES above).
async function getLeagues() {
  const res = await fetch(`${ESPN_CORE}/leagues?limit=1000`, { headers: HEADERS, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('espn-core ' + res.status);
  const d = await res.json();
  const all = (d.items || [])
    .map(i => (/\/leagues\/([^?]+)/.exec(i.$ref || '') || [])[1])
    .filter(Boolean).sort();
  return { count: all.length, active: LEAGUES, all };
}

function numScore(s) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }

// Elapsed minute from ESPN's status, for in-progress AND finished matches, so
// the clock can freeze at the official final time (e.g. 90+7) instead of running
// on. status.clock is capped at the regular time (5400s), so the added minutes
// are read from displayClock ("90'+7'"). Scheduled (pre) matches have no clock.
function minuteFrom(st) {
  const state = st.type && st.type.state;
  if (state !== 'in' && state !== 'post') return null;
  if ((st.type.description || '').toLowerCase().includes('halftime')) return 45;
  const m = /(\d+)'(?:\s*\+\s*(\d+))?/.exec(st.displayClock || '');   // "90'+7'" -> 90 + 7
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
}

function slim(e, leagueName, slug) {
  const c = (e.competitions && e.competitions[0]) || {};
  const cs = c.competitors || [];
  const h = cs.find(x => x.homeAway === 'home') || cs[0] || {};
  const a = cs.find(x => x.homeAway === 'away') || cs[1] || {};
  const st = e.status || {};
  const state = (st.type && st.type.state) || '';
  return {
    id: 'espn:' + slug + ':' + e.id,
    home: h.team && h.team.displayName, away: a.team && a.team.displayName,
    homeAbbr: h.team && h.team.abbreviation, awayAbbr: a.team && a.team.abbreviation,
    homeCrest: (h.team && h.team.logo) || '', awayCrest: (a.team && a.team.logo) || '',
    a: numScore(h.score), b: numScore(a.score),
    soA: numScore(h.shootoutScore), soB: numScore(a.shootoutScore),   // penalty shootout
    pens: /pen/i.test(((st.type && st.type.detail) || '') + ' ' + ((st.type && st.type.shortDetail) || '')),
    statusType: state === 'in' ? 'inprogress' : (state === 'post' ? 'finished' : 'notstarted'),
    statusDesc: (st.type && st.type.description) || '',
    detail: (st.type && st.type.shortDetail) || '',
    minute: minuteFrom(st),
    league: leagueName || slug, country: '',
    startTs: e.date ? Math.floor(Date.parse(e.date) / 1000) : null,
  };
}

// One league's matches (optionally for a date). A failing league does not sink
// the whole response, but it is REPORTED rather than silently dropped —
// swallowing these is what made an ESPN-wide 403 look like "no matches today".
async function fetchLeague(slug, ymd) {
  try {
    const d = await espn(`/${slug}/scoreboard${ymd ? '?dates=' + ymd : ''}`);
    const name = (d.leagues && d.leagues[0] && d.leagues[0].name) || slug;
    return { slug, events: (d.events || []).map(e => slim(e, name, slug)) };
  } catch (e) {
    return { slug, events: [], error: String((e && e.message) || e) };
  }
}

// Merge per-league results and attach a diagnostic block so an empty list can
// always be told apart from a broken upstream.
function merge(results) {
  const failed = results.filter(r => r.error);
  const out = {
    events: results.flatMap(r => r.events),
    diag: {
      leaguesOk: results.length - failed.length,
      leaguesTotal: results.length,
      failed: failed.map(r => `${r.slug}: ${r.error}`),
    },
  };
  // Every league failing is an upstream outage/block, not an empty schedule.
  if (failed.length === results.length) out.error = 'all leagues failed: ' + (failed[0] || {}).error;
  return out;
}

async function getLive() {
  const results = await Promise.all(LEAGUES.map(s => fetchLeague(s)));
  const merged = merge(results);
  merged.events = merged.events.filter(e => e.statusType === 'inprogress');
  return merged;
}

async function getDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('bad date (YYYY-MM-DD)');
  const ymd = date.replace(/-/g, '');
  return merge(await Promise.all(LEAGUES.map(s => fetchLeague(s, ymd))));
}

// Diagnostics: per-league HTTP outcome for one date (default: today's window).
// Open <relay>/debug in a browser to see instantly whether ESPN is answering.
async function getDebug(date) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.replace(/-/g, '') : undefined;
  const results = await Promise.all(LEAGUES.map(s => fetchLeague(s, ymd)));
  return {
    date: ymd || '(default window)',
    leaguesOk: results.filter(r => !r.error).length,
    leaguesTotal: results.length,
    totalEvents: results.reduce((n, r) => n + r.events.length, 0),
    inProgress: results.flatMap(r => r.events).filter(e => e.statusType === 'inprogress').length,
    leagues: results.map(r => ({ slug: r.slug, events: r.events.length, error: r.error || null })),
  };
}

// One match's current state. The league's default scoreboard window only spans
// the current matchday, so a match picked from /day for another date needs that
// date passed through (&date=YYYY-MM-DD) to be found again on refresh.
async function getMatch(id, date) {
  const p = (id || '').split(':');           // ['espn', slug, eventId]
  if (p[0] !== 'espn' || !p[1] || !p[2]) throw new Error('bad id');
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.replace(/-/g, '') : undefined;
  // Try the requested date, then the league's default window. Both are needed:
  // the default window only spans the current matchday, and the caller's date is
  // UTC while ESPN buckets ?dates= by US Eastern, so a late kickoff can sit on
  // either side of the boundary.
  let firstError = null;
  for (const w of (ymd ? [ymd, undefined] : [undefined])) {
    const r = await fetchLeague(p[1], w);
    if (r.error) { firstError = firstError || r.error; continue; }
    const ev = r.events.find(e => e.id === id);
    if (ev) return { event: ev };
  }
  if (firstError) throw new Error(firstError);
  return { event: null };
}

// Penalty-shootout kicks per team, made/missed in order, from the summary feed
// (the scoreboard only has the totals). Works for live AND finished matches.
async function getShots(id) {
  const p = (id || '').split(':');
  if (p[0] !== 'espn' || !p[1] || !p[2]) throw new Error('bad id');
  const sum = await espn(`/${p[1]}/summary?event=${p[2]}`, 15);
  const arr = Array.isArray(sum.shootout) ? sum.shootout : [];
  const cs = (sum.header && sum.header.competitions && sum.header.competitions[0] && sum.header.competitions[0].competitors) || [];
  const nameOf = side => { const c = cs.find(x => x.homeAway === side); return (c && c.team && c.team.displayName) || ''; };
  const seqOf = name => { const t = arr.find(x => (x.team || '').toLowerCase() === name.toLowerCase()); return t ? (t.shots || []).map(s => !!s.didScore) : []; };
  let home = seqOf(nameOf('home')), away = seqOf(nameOf('away'));
  if (!home.length && !away.length && arr.length === 2) {       // fallback: assume order
    home = (arr[0].shots || []).map(s => !!s.didScore);
    away = (arr[1].shots || []).map(s => !!s.didScore);
  }
  return { home, away };
}

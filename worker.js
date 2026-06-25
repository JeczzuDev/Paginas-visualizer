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
     GET /live               -> { events:[...] }  in-progress across leagues (cache 20s)
     GET /day?date=YYYY-MM-DD -> { events:[...] } that day's matches         (cache 120s)
     GET /match?id=espn:slug:eventId -> { event } one match's current state  (cache 15s)

   To cover more/other competitions, edit LEAGUES below (ESPN slugs).
   Crests are direct ESPN CDN URLs (work in <img> without CORS).
   ===================================================================== */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/soccer';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Curated competitions (ESPN slugs). Keep under ~40 (Worker subrequest limit 50).
const LEAGUES = [
  'fifa.world', 'fifa.friendly', 'fifa.worldq.conmebol', 'fifa.worldq.uefa',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'uefa.euro',
  'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.america',
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1', 'ned.1',
  'usa.1', 'mex.1', 'chi.1', 'chi.2', 'chi.super_cup', 'chi.copa_chi', 'arg.1', 'bra.1', 'col.1', 'uru.1', 'per.1', 'ecu.1', 'par.1',
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
        case '/match': return json(await getMatch(url.searchParams.get('id')), 15);
        case '/leagues': return json(await getLeagues(), 3600);
        case '/':
        case '': return json({ ok: true, leagues: LEAGUES.length, endpoints: ['/live', '/day?date=YYYY-MM-DD', '/match?id=espn:slug:eventId', '/leagues'] }, 60);
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
  const res = await fetch(ESPN + path, { headers: { 'User-Agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error('espn ' + res.status);
  return res.json();
}

// Discovery: every ESPN soccer competition slug (to add to LEAGUES above).
async function getLeagues() {
  const res = await fetch(`${ESPN_CORE}/leagues?limit=1000`, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('espn-core ' + res.status);
  const d = await res.json();
  const all = (d.items || [])
    .map(i => (/\/leagues\/([^?]+)/.exec(i.$ref || '') || [])[1])
    .filter(Boolean).sort();
  return { count: all.length, active: LEAGUES, all };
}

function numScore(s) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }

// Live elapsed minute from ESPN's status (only while in progress).
// status.clock is capped at the regular time (5400s) so it CAN'T show stoppage;
// the added time lives only in displayClock ("90'+7'") -> parse base + extra.
function minuteFrom(st) {
  if (!st.type || st.type.state !== 'in') return null;
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
    statusType: state === 'in' ? 'inprogress' : (state === 'post' ? 'finished' : 'notstarted'),
    statusDesc: (st.type && st.type.description) || '',
    detail: (st.type && st.type.shortDetail) || '',
    minute: minuteFrom(st),
    league: leagueName || slug, country: '',
    startTs: e.date ? Math.floor(Date.parse(e.date) / 1000) : null,
  };
}

// One league's matches (optionally for a date). A failing league is skipped.
async function fetchLeague(slug, ymd) {
  try {
    const d = await espn(`/${slug}/scoreboard${ymd ? '?dates=' + ymd : ''}`);
    const name = (d.leagues && d.leagues[0] && d.leagues[0].name) || slug;
    return (d.events || []).map(e => slim(e, name, slug));
  } catch (e) { return []; }
}

async function getLive() {
  const all = (await Promise.all(LEAGUES.map(s => fetchLeague(s)))).flat();
  return { events: all.filter(e => e.statusType === 'inprogress') };
}

async function getDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('bad date (YYYY-MM-DD)');
  const ymd = date.replace(/-/g, '');
  const all = (await Promise.all(LEAGUES.map(s => fetchLeague(s, ymd)))).flat();
  return { events: all };
}

async function getMatch(id) {
  const p = (id || '').split(':');           // ['espn', slug, eventId]
  if (p[0] !== 'espn' || !p[1] || !p[2]) throw new Error('bad id');
  const evs = await fetchLeague(p[1]);
  return { event: evs.find(e => e.id === id) || null };
}

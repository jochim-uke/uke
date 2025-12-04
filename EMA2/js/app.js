// Konfiguration
const CSV_PATH = "data/medications.csv";
const COLUMNS = ["Name", "Tradename", "Disease", "Indication"]; // erweitert: Disease für Suche/Filter

// State
let rows = [];
let filtered = [];
let page = 1;
let pageSize = 50;
let sortKey = null;
let sortDir = 1; // 1 = asc, -1 = desc

// DOM
const searchInput = document.getElementById("searchInput");
const diseaseFilter = document.getElementById("diseaseFilter");
const pageSizeSel = document.getElementById("pageSize");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageInfo = document.getElementById("pageInfo");
const tbody = document.getElementById("tbody");
const ths = document.querySelectorAll("th[data-key]");

// Debounce helper
const debounce = (fn, ms=200) => {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function splitIndications(text) {
  if (!text) return [];
  const t = String(text)
    .replace("\ufeff", "")      // BOM entfernen, falls doch noch vorhanden
    .replace(/\u00A0/g, " ")     // echte Unicode-NBSP in normale Leerzeichen
    .replace(/&nbsp;/gi, " ")     // wörtliche "&nbsp;" in Leerzeichen
    .replace(/\s+/g, " ")        // alle Whitespaces zusammenfassen
    .trim();
  if (!t) return [];
  // Split at every period or semicolon, independent of what follows (Safari-friendly, no lookbehind)
  const parts = t.split(/[.;]+/);
  return parts.map(s => s.trim()).filter(Boolean);
}
// Expose helpers globally
window.escapeHTML = escapeHTML;
window.splitIndications = splitIndications;

// Laden & Parsen der CSV
function loadCSV() {
  console.log("CSV_PATH =", CSV_PATH, "base =", window.location.href);

  const safe = (v) => {
    if (v == null) return "";
    return String(v)
      .replace("\ufeff", "")       // BOM entfernen
      .replace(/\u00A0/g, " ")      // echte Unicode-NBSP in normale Leerzeichen umwandeln
      .replace(/&nbsp;/gi, " ")      // wörtliche "&nbsp;" aus der CSV in Leerzeichen umwandeln
      .trim();
  };

  fetch(CSV_PATH)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} beim Laden der CSV`);
      return r.text();
    })
    .then((text) => {
      // Erste Parse-Runde: Auto-Delimiter
      let res = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      // Wenn sehr wenige Spalten erkannt wurden und Semikolons vorkommen → zweiter Versuch mit ';'
      const headerCount = Array.isArray(res.meta?.fields) ? res.meta.fields.length : 0;
      const looksLikeSemicolon = (text.indexOf(";") !== -1) && (text.indexOf(",") !== -1 ? text.split("\n", 1)[0].split(";").length >= text.split("\n", 1)[0].split(",").length : true);
      if ((headerCount <= 1) && looksLikeSemicolon) {
        console.warn("Re-parsing CSV with explicit semicolon delimiter…");
        res = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          delimiter: ";",
        });
      }

      console.log("Detected delimiter:", res.meta?.delimiter, "fields:", res.meta?.fields);

      if (!Array.isArray(res.data) || res.data.length === 0) {
        console.error("CSV parse produced no rows. Errors:", res.errors);
        tbody.innerHTML = `<tr><td colspan="3">Keine Daten gefunden. Prüfe Trennzeichen (Komma vs. Semikolon) und Header.</td></tr>`;
        return;
      }

      // Header-Mapping (case-insensitiv, unterstützt alte & deutsche Varianten)
      const firstRow = res.data[0] || {};
      const keyMapLower = Object.keys(firstRow).reduce((acc, k) => {
        acc[k.toLowerCase().replace(/\s+/g, "")] = k; return acc;
      }, {});

      const keyName       = keyMapLower["name"]        || keyMapLower["medication"] || keyMapLower["medikament"] || keyMapLower["arznei"];
      const keyTradename  = keyMapLower["tradename"]   || keyMapLower["handelsname"] || keyMapLower["brand"] || keyMapLower["marke"];
      const keyDisease    = keyMapLower["disease"]     || keyMapLower["erkrankung"] || keyMapLower["krankheit"] || keyMapLower["diagnose"];
      const keyIndication = keyMapLower["indication"]  || keyMapLower["indikation"];

      if (!keyName || !keyIndication || !keyDisease) {
        console.error("Header mapping failed. Available headers:", Object.keys(firstRow));
        tbody.innerHTML = `<tr><td colspan="3">Fehlende Spalten. Erwartet: Tradename, Name, Disease, Indication (Kompatibel: Handelsname, Medikament/Arznei, Erkrankung/Krankheit, Indikation). Gefunden: ${Object.keys(firstRow).join(", ")}</td></tr>`;
        return;
      }

      // Daten normalisieren (Tradename darf leer sein)
      rows = res.data.map((r) => ({
        Name: safe(r[keyName]),
        Tradename: keyTradename ? safe(r[keyTradename]) : "",
        Disease: safe(r[keyDisease]),
        Indication: safe(r[keyIndication]),
      }));

      console.log(`CSV ok: ${rows.length} Zeilen`);
      buildFilters(rows);
      applyFilters();
    })
    .catch((err) => {
      console.error("CSV load/parse error:", err);
      tbody.innerHTML = `<tr><td colspan="3">Fehler beim Laden/Parsen: ${err?.message || err}</td></tr>`;
    });
}

// Filter-Dropdowns befüllen
function buildFilters(data) {
  const setToOpts = (sel, values) => {
    const uniq = Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b, 'de', {sensitivity:'base'}));
    const frag = document.createDocumentFragment();
    uniq.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);
  };
  setToOpts(diseaseFilter, data.map(r => r.Disease));
}

// Anwenden von Suche/Filtern/Sortierung
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const dis = diseaseFilter.value;

  filtered = rows.filter(r => {
    const byDis = !dis || r.Disease === dis;
    const byQuery = !q || COLUMNS.some(k => (r[k] || "").toLowerCase().includes(q));
    return byDis && byQuery;
  });

  if (sortKey) {
    filtered.sort((a,b) => a[sortKey].localeCompare(b[sortKey], 'de', {sensitivity:'base'}) * sortDir);
  }

  page = 1; // zurück auf Anfang nach neuem Filter
  render();
}

// Tabelle rendern (paged)
function render() {
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * pageSize;
  const view = filtered.slice(start, start + pageSize);

  // Rows
  if (view.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">Keine Einträge gefunden.</td></tr>`;
  } else {
    const frag = document.createDocumentFragment();
    for (const r of view) {
      const tr = document.createElement("tr");
      const chunks = splitIndications(r.Indication);
      const indHtml = chunks.map(ch => escapeHTML(ch)).join('<br><br>');
      tr.innerHTML = `
        <td>${escapeHTML(r.Name)}</td>
        <td>${escapeHTML(r.Tradename)}</td>
        <td>${indHtml}</td>
      `;
      frag.appendChild(tr);
    }
    tbody.replaceChildren(frag);
  }

  // Pager
  prevBtn.disabled = (page <= 1);
  nextBtn.disabled = (page >= pages);
  pageInfo.textContent = `Seite ${page} / ${pages} — ${total} Einträge`;
}

// Events
searchInput.addEventListener("input", debounce(applyFilters, 150));
diseaseFilter.addEventListener("change", applyFilters);
pageSizeSel.addEventListener("change", () => { pageSize = parseInt(pageSizeSel.value,10)||50; render(); });
prevBtn.addEventListener("click", () => { page--; render(); });
nextBtn.addEventListener("click", () => { page++; render(); });

// Sortier-Header
ths.forEach(th => {
  th.style.cursor = "pointer";
  th.title = "Zum Sortieren klicken";
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortDir = -1 * sortDir;
    } else {
      sortKey = key; sortDir = 1;
    }
    applyFilters();
  });
});

loadCSV();

// Konfiguration
const CSV_PATH = "data/medications.csv";
const COLUMNS = ["medication", "Category", "Indication"]; // Spaltennamen in deiner CSV

// State
let rows = [];
let filtered = [];
let page = 1;
let pageSize = 50;
let sortKey = null;
let sortDir = 1; // 1 = asc, -1 = desc

// DOM
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const indicationFilter = document.getElementById("indicationFilter");
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

// Laden & Parsen der CSV
function loadCSV() {
  console.log("CSV_PATH =", CSV_PATH, "base =", window.location.href);

  const safe = (v) => (v == null ? "" : String(v).replace("\ufeff", "").trim());

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

      // Header-Mapping (case-insensitiv, unterstützt deutsche Varianten)
      const firstRow = res.data[0] || {};
      const keyMapLower = Object.keys(firstRow).reduce((acc, k) => {
        acc[k.toLowerCase().replace(/\s+/g, "")] = k; return acc;
      }, {});

      const keyMedication = keyMapLower["medication"] || keyMapLower["medikament"] || keyMapLower["arznei"];
      const keyCategory   = keyMapLower["category"]   || keyMapLower["kategorie"];
      const keyIndication = keyMapLower["indication"] || keyMapLower["indikation"];

      if (!keyMedication || !keyCategory || !keyIndication) {
        console.error("Header mapping failed. Available headers:", Object.keys(firstRow));
        tbody.innerHTML = `<tr><td colspan="3">Fehlende Spalten. Erwartet: medication, Category, Indication (oder: Medikament, Kategorie, Indikation). Gefunden: ${Object.keys(firstRow).join(", ")}</td></tr>`;
        return;
      }

      // Daten normalisieren
      rows = res.data.map((r) => ({
        medication: safe(r[keyMedication]),
        Category: safe(r[keyCategory]),
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
  setToOpts(categoryFilter, data.map(r => r.Category));
  setToOpts(indicationFilter, data.map(r => r.Indication));
}

// Anwenden von Suche/Filtern/Sortierung
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const cat = categoryFilter.value;
  const ind = indicationFilter.value;

  filtered = rows.filter(r => {
    const byCat = !cat || r.Category === cat;
    const byInd = !ind || r.Indication === ind;
    const byQuery = !q || COLUMNS.some(k => r[k].toLowerCase().includes(q));
    return byCat && byInd && byQuery;
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
      tr.innerHTML = `
        <td>${escapeHTML(r.medication)}</td>
        <td>${escapeHTML(r.Category)}</td>
        <td>${escapeHTML(r.Indication)}</td>
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

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Events
searchInput.addEventListener("input", debounce(applyFilters, 150));
categoryFilter.addEventListener("change", applyFilters);
indicationFilter.addEventListener("change", applyFilters);
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
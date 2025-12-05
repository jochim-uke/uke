// Konfiguration
const CSV_PATH = "data/medications.csv";
const COLUMNS = ["Name", "Tradename", "Disease", "Indication", ]; // erweitert: Disease für Suche/Filter

// State
let rows = [];
let filtered = [];
let page = 1;
let pageSize = 50;
let sortKey = null;
let sortDir = 1; // 1 = asc, -1 = desc

// DOM
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const categoryFilter = document.getElementById("categoryFilter");
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
  const parts = t.split(/;|\.(?=[A-Za-z])|\.\s+/);
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
      .replace("\ufeff", "")             // BOM entfernen
      .replace(/\u00A0/g, " ")           // echte Unicode-NBSP in normale Leerzeichen umwandeln
      .replace(/&nbsp;/gi, " ")          // wörtliche "&nbsp;" aus der CSV in Leerzeichen umwandeln
      .replace(/\be\.g\./gi, "for example")  // e.g. → for example
      .replace(/\bi\.e\./gi, "that is")      // i.e. → that is
      .replace(/&lt/?gi, "<")
      .replace(/&gt/?gi, ">")
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
      const keyStatus    = keyMapLower["status"]    || null;
      const keyURL       = keyMapLower["url"]       || null;
      const keyCategory  = keyMapLower["category"]  || null;

      if (!keyName || !keyIndication || !keyDisease) {
        console.error("Header mapping failed. Available headers:", Object.keys(firstRow));
        tbody.innerHTML = `<tr><td colspan="3">Fehlende Spalten. Erwartet: Tradename, Name, Disease, Indication (Kompatibel: Handelsname, Medikament/Arznei, Erkrankung/Krankheit, Indikation). Gefunden: ${Object.keys(firstRow).join(", ")}</td></tr>`;
        return;
      }

      // Daten normalisieren (Tradename darf leer sein; zusätzliche Felder Status, URL, Category)
      rows = res.data.map((r) => ({
        Name: safe(r[keyName]),
        Tradename: keyTradename ? safe(r[keyTradename]) : "",
        Disease: safe(r[keyDisease]),
        Indication: safe(r[keyIndication]),
        Status: keyStatus ? safe(r[keyStatus]) : "",
        URL: keyURL ? safe(r[keyURL]) : "",
        Category: keyCategory ? safe(r[keyCategory]) : "",
      }));

      console.log(`CSV ok: ${rows.length} Zeilen`);
      buildFilters(rows);
      statusFilter.value = "Authorised";
      categoryFilter.value = "Human";
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
  setToOpts(statusFilter, data.map(r => r.Status));
  setToOpts(categoryFilter, data.map(r => r.Category));
}

// Anwenden von Suche/Filtern/Sortierung
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const category = categoryFilter.value;

  filtered = rows.filter(r => {
    const byStatus = !status || r.Status === status;
    const byCategory = !category || r.Category === category;
    const byQuery = !q || COLUMNS.some(k => (r[k] || "").toLowerCase().includes(q));
    return byStatus && byCategory && byQuery;
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
      const chunks = splitIndications(r.Indication);
      const indHtml = chunks.map(ch => escapeHTML(ch)).join('<br><br>');

      // URL-Spalte als klickbarer Link (falls vorhanden)
      let urlHtml = '';
      if (r.URL) {
        const rawUrl = r.URL.trim();
        const href = rawUrl.match(/^https?:\/\//i) ? rawUrl : `https://${rawUrl}`;
        const safeHref = href.replace(/\"/g, '%22');
        urlHtml = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="ema-btn">EMA-Link↗</a>`;
      }

      // Hauptzeile (Name, Tradename, Link)
      const trMain = document.createElement("tr");
      trMain.className = "row-main";
      trMain.innerHTML = `
        <td>${escapeHTML(r.Name)}</td>
        <td>${escapeHTML(r.Tradename)}</td>
        <td>${urlHtml}</td>
      `;
      trMain.tabIndex = 0;
      trMain.setAttribute("aria-expanded", "false");

      // Detailzeile (Indikation)
      const trDetail = document.createElement("tr");
      trDetail.className = "row-detail";
      trDetail.innerHTML = `
        <td colspan="3">${indHtml || '<span class="muted">Keine Indikation hinterlegt.</span>'}</td>
      `;
      trDetail.style.display = "none";

      // Toggle-Logik: Klick oder Enter/Space auf Hauptzeile toggelt Detailzeile
      const toggle = () => {
        const isOpen = trDetail.style.display !== "none";
        trDetail.style.display = isOpen ? "none" : "table-row";
        trMain.setAttribute("aria-expanded", String(!isOpen));
      };

      trMain.addEventListener("click", toggle);
      trMain.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });

      frag.appendChild(trMain);
      frag.appendChild(trDetail);
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
statusFilter.addEventListener("change", applyFilters);
categoryFilter.addEventListener("change", applyFilters);
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

function updateDataTimestamp() {
  const el = document.getElementById("dataUpdated");
  if (!el) return;

  fetch("data/medications.csv", { method: "HEAD" })
    .then((res) => {
      const lm = res.headers.get("Last-Modified");
      if (!lm) {
        return;
      }
      const d = new Date(lm);
      el.textContent = d.toLocaleString("de-DE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    })
    .catch(() => {
      // Fallback: notfalls HTML-Datum verwenden
      const d = new Date(document.lastModified);
      el.textContent = d.toLocaleString("de-DE");
    });
}

// irgendwo nach DOM-Ready aufrufen:
document.addEventListener("DOMContentLoaded", () => {
  updateDataTimestamp();
  // ... dein bisheriges init/loadCSV etc.
});

loadCSV();
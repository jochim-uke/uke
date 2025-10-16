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
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    worker: true, // schneller bei großen Dateien
    // delimiter: ";", // UNCOMMENT if your CSV uses semicolons
    complete: (res) => {
      // Nur relevante Spalten mappen, Leerräume trimmen
      rows = res.data.map(r => ({
        medication: (r.medication ?? r.Medication ?? "").toString().trim(),
        Category: (r.Category ?? "").toString().trim(),
        Indication: (r.Indication ?? "").toString().trim()
      }));
      buildFilters(rows);
      applyFilters();
    },
    error: (err) => {
      console.error("PapaParse error:", err);
      tbody.innerHTML = `<tr><td colspan="3">Fehler beim Laden der CSV: ${err?.message || err}</td></tr>`;
    }
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
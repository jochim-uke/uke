document.addEventListener('DOMContentLoaded', () => {
let parsedData = [];
const API_CSV = 'medications.csv';
const searchInput = document.getElementById('search');
const viewSelect  = document.getElementById('view');
const container   = document.getElementById('table-container');

Papa.parse(API_CSV, {
  header: true,
  download: true,
  skipEmptyLines: true,
  complete: results => {
    parsedData = results.data;
    loadAndRender();
  }
});

function loadAndRender() {
  const filter  = searchInput.value.trim().toLowerCase();
  const view    = viewSelect.value;
  // Filter
  const data = filter
    ? parsedData.filter(r =>
        r.Medikation.toLowerCase().includes(filter) ||
        r['Kategorie / Situation'].toLowerCase().includes(filter) ||
        r['KMT-Std.'].toLowerCase().includes(filter)
      )
    : parsedData;
  // Render
  container.innerHTML = '';
  if (view === 'medikation') renderByMedikation(data);
  else renderByKategorie(data);
}

searchInput.addEventListener('input', loadAndRender);
viewSelect.addEventListener('change', loadAndRender);

function renderByKategorie(data) {
  const groups = {};
  data.forEach(r => {
    const cat = r['Kategorie / Situation'] || 'Unkategorisiert';
    (groups[cat] = groups[cat]||[]).push(r);
  });
  Object.keys(groups).sort().forEach(cat => {
    const d = document.createElement('details');
    d.innerHTML = `<summary>${cat}</summary><table>
      <thead><tr><th>Medikation</th><th>KMT-Std.</th></tr></thead>
      <tbody>${groups[cat].map(r=>`<tr><td>${r.Medikation}</td><td>${r['KMT-Std.']}</td></tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(d);
  });
}

function renderByMedikation(data) {
  const sorted = data.slice().sort((a,b) => a.Medikation.localeCompare(b.Medikation));
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th>Medikation</th><th>Kategorie</th><th>KMT-Std.</th></tr></thead>
    <tbody>${sorted.map(r=>`<tr><td>${r.Medikation}</td><td>${r['Kategorie / Situation']}</td><td>${r['KMT-Std.']}</td></tr>`).join('')}</tbody>`;
  container.appendChild(table);
}
});
/**
 * Mini Biosphere Simulator — App Controller
 * Manages UI, chart rendering, and simulation loop
 */

import { Biosphere } from './simulation.js';

// ─── State ───────────────────────────────────────────────────────────────────
const MAX_BIOSPHERES = 4;
const COLORS = [
    { line: '#00e5ff', fill: 'rgba(0,229,255,0.12)', label: 'Sphere A' },
    { line: '#ff6b6b', fill: 'rgba(255,107,107,0.12)', label: 'Sphere B' },
    { line: '#69ff47', fill: 'rgba(105,255,71,0.12)', label: 'Sphere C' },
    { line: '#ffb347', fill: 'rgba(255,179,71,0.12)', label: 'Sphere D' },
];

let biospheres = [];     // { instance: Biosphere, color, chartData }
let simTimer = null;
let tickSpeed = 200;     // ms per tick
let isRunning = false;
let maxTicks = 720;      // default 720 simulated hours = 30 days

// ─── Charts ──────────────────────────────────────────────────────────────────
let charts = {};

function makeChartCfg(label, unit, min, max) {
    return {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#cdd6f4', font: { size: 11 } } },
                tooltip: { mode: 'index' }
            },
            scales: {
                x: {
                    ticks: { color: '#7f849c', maxTicksLimit: 10, font: { size: 10 } },
                    grid: { color: 'rgba(127,132,156,0.15)' },
                    title: { display: true, text: 'Hours', color: '#7f849c', font: { size: 10 } }
                },
                y: {
                    min, max,
                    ticks: { color: '#7f849c', font: { size: 10 } },
                    grid: { color: 'rgba(127,132,156,0.15)' },
                    title: { display: true, text: `${label} (${unit})`, color: '#7f849c', font: { size: 10 } }
                }
            }
        }
    };
}

function initCharts() {
    const cfgs = {
        o2: makeChartCfg('O₂', '%', 0, 30),
        co2: makeChartCfg('CO₂', '%', 0, 15),
        glucose: makeChartCfg('Glucose', 'mmol', 0, 200),
        pop: makeChartCfg('Consumers', 'count', 0, 55),
        plant: makeChartCfg('Plant Biomass', '%', 0, 105),
        health: makeChartCfg('Health', '%', 0, 105),
    };
    for (const [key, cfg] of Object.entries(cfgs)) {
        const ctx = document.getElementById(`chart-${key}`).getContext('2d');
        if (charts[key]) charts[key].destroy();
        charts[key] = new Chart(ctx, cfg);
    }
}

function rebuildChartDatasets() {
    for (const chart of Object.values(charts)) {
        chart.data.labels = [];
        chart.data.datasets = [];
    }
    biospheres.forEach((b, i) => {
        const color = b.color;
        const ds = (key, label) => ({
            label: `${COLORS[i].label}: ${label}`,
            data: [],
            borderColor: color.line,
            backgroundColor: color.fill,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
        });
        charts.o2.data.datasets.push(ds('o2', 'O₂'));
        charts.co2.data.datasets.push(ds('co2', 'CO₂'));
        charts.glucose.data.datasets.push(ds('glucose', 'Glucose'));
        charts.pop.data.datasets.push(ds('pop', 'Consumers'));
        charts.plant.data.datasets.push(ds('plant', 'Plants'));
        charts.health.data.datasets.push(ds('health', 'Health'));
        b.dsIndex = i;
    });
}

function pushChartData(b, idx) {
    const h = b.instance.history;
    if (h.length === 0) return;
    const last = h[h.length - 1];
    const label = `${last.tick}h`;

    // Only push label once (from first biosphere)
    if (idx === 0) {
        for (const chart of Object.values(charts)) {
            chart.data.labels.push(label);
        }
    }

    charts.o2.data.datasets[idx].data.push(last.o2);
    charts.co2.data.datasets[idx].data.push(last.co2);
    charts.glucose.data.datasets[idx].data.push(last.glucose);
    charts.pop.data.datasets[idx].data.push(last.pop);
    charts.plant.data.datasets[idx].data.push(last.plantBiomass);
    charts.health.data.datasets[idx].data.push(last.health);
}

function updateCharts() {
    biospheres.forEach((b, i) => pushChartData(b, i));
    for (const chart of Object.values(charts)) chart.update();
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function healthColor(health) {
    if (health > 70) return '#69ff47';
    if (health > 40) return '#ffb347';
    if (health > 15) return '#ff6b6b';
    return '#888';
}

function updateCards() {
    biospheres.forEach((b, i) => {
        const s = b.instance.state;
        const card = document.getElementById(`card-${i}`);
        if (!card) return;

        // Health bar
        const bar = card.querySelector('.health-fill');
        if (bar) {
            bar.style.width = `${s.health.toFixed(0)}%`;
            bar.style.background = healthColor(s.health);
        }
        card.querySelector('.health-val').textContent = `${s.health.toFixed(0)}%`;

        // Gas values
        card.querySelector('.val-o2').textContent = `${s.o2.toFixed(2)}%`;
        card.querySelector('.val-co2').textContent = `${s.co2.toFixed(2)}%`;
        card.querySelector('.val-glucose').textContent = `${s.glucose.toFixed(1)} mmol`;
        card.querySelector('.val-water').textContent = `${s.water.toFixed(1)}`;
        card.querySelector('.val-pop').textContent = s.consumerPop.toFixed(1);
        card.querySelector('.val-plant').textContent = `${s.plantBiomass.toFixed(1)}%`;
        card.querySelector('.val-photo').textContent = `${s.photoRate.toFixed(3)} mmol/h`;
        card.querySelector('.val-resp').textContent = `${s.respRate.toFixed(3)} mmol/h`;
        card.querySelector('.val-tick').textContent = `${s.tick}h`;

        // Status badge
        const badge = card.querySelector('.status-badge');
        if (s.alive) {
            badge.textContent = '🟢 Alive';
            badge.className = 'status-badge alive';
        } else {
            badge.textContent = '💀 Collapsed';
            badge.className = 'status-badge dead';
            card.querySelector('.death-cause').textContent = s.cause || '';
            card.querySelector('.death-cause').style.display = 'block';
        }

        // Photo/Resp rate bars
        const maxRate = 15;
        card.querySelector('.photo-rate-bar').style.width
            = `${Math.min(100, (s.photoRate / maxRate) * 100)}%`;
        card.querySelector('.resp-rate-bar').style.width
            = `${Math.min(100, (s.respRate / maxRate) * 100)}%`;
    });
}

// ─── Simulation Loop ──────────────────────────────────────────────────────────
function tick() {
    let allDone = true;
    biospheres.forEach(b => {
        if (b.instance.alive && b.instance.tick < maxTicks) {
            b.instance.step();
            allDone = false;
        } else if (b.instance.tick < maxTicks) {
            allDone = false; // still counting ticks even if dead (for alignment)
        }
    });
    updateCards();

    // Push to charts every 6 ticks (every 6 sim hours)
    if (biospheres[0] && biospheres[0].instance.tick % 6 === 0) {
        updateCharts();
    }

    if (allDone || biospheres.every(b => !b.instance.alive || b.instance.tick >= maxTicks)) {
        stopSim();
        // Final chart update
        updateCharts();
        document.getElementById('run-btn').textContent = '⏹ Finished';
    }
}

function startSim() {
    if (biospheres.length === 0) {
        alert('Add at least one biosphere first!');
        return;
    }
    isRunning = true;
    document.getElementById('run-btn').textContent = '⏸ Pause';
    document.getElementById('run-btn').onclick = pauseSim;
    simTimer = setInterval(tick, tickSpeed);
}

function pauseSim() {
    isRunning = false;
    clearInterval(simTimer);
    document.getElementById('run-btn').textContent = '▶ Resume';
    document.getElementById('run-btn').onclick = startSim;
}

function stopSim() {
    isRunning = false;
    clearInterval(simTimer);
}

function resetAll() {
    stopSim();
    biospheres.forEach(b => b.instance.reset());
    rebuildChartDatasets();
    // Rebuild chart labels
    for (const chart of Object.values(charts)) {
        chart.data.labels = [];
        chart.data.datasets.forEach(ds => ds.data = []);
        chart.update();
    }
    updateCards();
    document.getElementById('run-btn').textContent = '▶ Run Simulation';
    document.getElementById('run-btn').onclick = startSim;
}

// ─── Biosphere Card Builder ────────────────────────────────────────────────────
function buildConfigPanel(idx) {
    const color = COLORS[idx];
    const userCfg = biospheres[idx].instance.cfg;

    const fields = [
        {
            key: 'lightIntensity', label: 'Light Intensity', unit: 'lux', min: 0, max: 100, step: 1, val: userCfg.lightIntensity,
            tip: 'Amount of light available for photosynthesis. Higher light → faster glucose production.'
        },
        {
            key: 'photoperiod', label: 'Photoperiod', unit: 'h/day', min: 0, max: 24, step: 0.5, val: userCfg.photoperiod,
            tip: 'Hours of light per day. Periods of darkness force plants to respire stored glucose.'
        },
        {
            key: 'initialCO2', label: 'Initial CO₂', unit: '%', min: 0.01, max: 10, step: 0.01, val: userCfg.initialCO2,
            tip: 'CO₂ is a substrate for photosynthesis. Too high (>5%) causes CO₂ toxicity.'
        },
        {
            key: 'initialO2', label: 'Initial O₂', unit: '%', min: 0, max: 30, step: 0.5, val: userCfg.initialO2,
            tip: 'O₂ is required for aerobic respiration. Below ~1% causes asphyxiation.'
        },
        {
            key: 'initialWater', label: 'Water Level', unit: 'units', min: 0, max: 100, step: 1, val: userCfg.initialWater,
            tip: 'Water is consumed by photosynthesis and released by respiration. Required for survival.'
        },
        {
            key: 'plantBiomass', label: 'Plant Biomass', unit: '%', min: 0, max: 100, step: 1, val: userCfg.plantBiomass,
            tip: 'Amount of photosynthetic plant material. More plants → more O₂ and glucose production.'
        },
        {
            key: 'consumerCount', label: 'Consumers (Animals)', unit: 'count', min: 0, max: 50, step: 1, val: userCfg.consumerCount,
            tip: 'Heterotrophs that consume glucose via respiration. Too many will deplete O₂ and glucose.'
        },
        {
            key: 'decomposerActivity', label: 'Decomposer Activity', unit: '%', min: 0, max: 100, step: 1, val: userCfg.decomposerActivity,
            tip: 'Decomposers recycle organic matter, releasing CO₂. They complete the carbon cycle.'
        },
        {
            key: 'temperature', label: 'Temperature', unit: '°C', min: 0, max: 45, step: 0.5, val: userCfg.temperature,
            tip: 'Optimal photosynthesis ~25°C, respiration ~37°C. Extremes denature enzymes.'
        },
        {
            key: 'nutrientLevel', label: 'Mineral Nutrients', unit: '%', min: 0, max: 100, step: 1, val: userCfg.nutrientLevel,
            tip: 'Mineral availability (N, P, K, etc.) required for building chlorophyll and enzymes.'
        },
    ];

    const rows = fields.map(f => `
    <div class="cfg-row">
      <label class="cfg-label">
        <span class="cfg-name">${f.label}</span>
        <span class="cfg-tip-icon" title="${f.tip}">ℹ</span>
        <span class="cfg-tooltip">${f.tip}</span>
      </label>
      <div class="cfg-input-row">
        <input type="range" id="cfg-${idx}-${f.key}" class="cfg-slider"
          min="${f.min}" max="${f.max}" step="${f.step}" value="${f.val}"
          oninput="document.getElementById('cfgval-${idx}-${f.key}').value=this.value">
        <input type="number" id="cfgval-${idx}-${f.key}" class="cfg-val-input"
          min="${f.min}" max="${f.max}" step="${f.step}" value="${f.val}"
          oninput="document.getElementById('cfg-${idx}-${f.key}').value=this.value">
        <span class="cfg-unit">${f.unit}</span>
      </div>
    </div>`).join('');

    return `
    <div class="biosphere-config" id="config-${idx}" style="border-top-color:${color.line}">
      <div class="config-header">
        <span class="config-dot" style="background:${color.line}"></span>
        <h3>${color.label}</h3>
        <button class="remove-btn" onclick="removeBiosphere(${idx})" title="Remove">✕</button>
      </div>
      <div class="config-fields">${rows}</div>
    </div>`;
}

function buildStateCard(idx) {
    const color = COLORS[idx];
    return `
    <div class="state-card" id="card-${idx}" style="border-top-color:${color.line}">
      <div class="card-header">
        <span class="status-badge alive" >🟢 Alive</span>
        <span class="card-title" style="color:${color.line}">${color.label}</span>
        <span class="val-tick tick-badge">0h</span>
      </div>

      <div class="health-bar-wrap">
        <div class="health-bar">
          <div class="health-fill" style="width:100%;background:#69ff47"></div>
        </div>
        <span class="health-val">100%</span>
      </div>

      <div class="death-cause" style="display:none"></div>

      <div class="rates-section">
        <div class="rate-row photo">
          <span class="rate-label">📗 Photosynthesis</span>
          <span class="val-photo rate-val">0 mmol/h</span>
          <div class="rate-track"><div class="rate-bar photo-rate-bar" style="width:0%;background:#69ff47"></div></div>
        </div>
        <div class="rate-row resp">
          <span class="rate-label">🔥 Respiration</span>
          <span class="val-resp rate-val">0 mmol/h</span>
          <div class="rate-track"><div class="rate-bar resp-rate-bar" style="width:0%;background:#ff6b6b"></div></div>
        </div>
      </div>

      <div class="metrics-grid">
        <div class="metric"><span class="m-label">O₂</span><span class="val-o2 m-val">—</span></div>
        <div class="metric"><span class="m-label">CO₂</span><span class="val-co2 m-val">—</span></div>
        <div class="metric"><span class="m-label">Glucose</span><span class="val-glucose m-val">—</span></div>
        <div class="metric"><span class="m-label">Water</span><span class="val-water m-val">—</span></div>
        <div class="metric"><span class="m-label">Consumers</span><span class="val-pop m-val">—</span></div>
        <div class="metric"><span class="m-label">Plants</span><span class="val-plant m-val">—</span></div>
      </div>
    </div>`;
}

function getDefaultConfig(idx) {
    return { lightIntensity: 80, photoperiod: 14, initialCO2: 0.04, initialO2: 21, initialWater: 70, plantBiomass: 60, consumerCount: 10, decomposerActivity: 50, temperature: 22, nutrientLevel: 70 };
}

function readConfig(idx) {
    const keys = ['lightIntensity', 'photoperiod', 'initialCO2', 'initialO2', 'initialWater',
        'plantBiomass', 'consumerCount', 'decomposerActivity', 'temperature', 'nutrientLevel'];
    const cfg = {};
    keys.forEach(k => {
        cfg[k] = parseFloat(document.getElementById(`cfgval-${idx}-${k}`)?.value ?? 0);
    });
    return cfg;
}

// ─── Global handlers (non-module scope hoisting trick) ─────────────────────────
window.removeBiosphere = function (idx) {
    if (isRunning) { alert('Stop or pause the simulation first.'); return; }
    biospheres = biospheres.filter((_, i) => i !== idx);
    renderAll();
};

// ─── Render All ───────────────────────────────────────────────────────────────
function renderAll() {
    const configWrap = document.getElementById('configs-wrap');
    const cardWrap = document.getElementById('cards-wrap');

    configWrap.innerHTML = biospheres.map((_, i) => buildConfigPanel(i)).join('');
    cardWrap.innerHTML = biospheres.map((_, i) => buildStateCard(i)).join('');

    // sync slider displays
    biospheres.forEach((b, i) => {
        const keys = Object.keys(b.instance.cfg);
        keys.forEach(k => {
            const el = document.getElementById(`cfgval-${i}-${k}`);
            const sl = document.getElementById(`cfg-${i}-${k}`);
            if (el && sl) {
                el.value = sl.value;
            }
        });
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function addBiosphere() {
    if (isRunning) { alert('Pause the simulation first to add biospheres.'); return; }
    if (biospheres.length >= MAX_BIOSPHERES) { alert(`Maximum ${MAX_BIOSPHERES} biospheres allowed.`); return; }
    const idx = biospheres.length;
    const cfg = getDefaultConfig(idx);
    biospheres.push({
        instance: new Biosphere(cfg, COLORS[idx].label),
        color: COLORS[idx],
    });
    renderAll();
}

function applyAndRun() {
    if (isRunning) pauseSim();
    // re-create biospheres with current slider values
    biospheres = biospheres.map((b, i) => {
        const cfg = readConfig(i);
        return { instance: new Biosphere(cfg, COLORS[i].label), color: b.color };
    });
    renderAll();
    rebuildChartDatasets();
    for (const chart of Object.values(charts)) {
        chart.data.labels = [];
        chart.data.datasets.forEach(ds => ds.data = []);
        chart.update();
    }
    maxTicks = parseInt(document.getElementById('max-ticks').value) || 720;
    tickSpeed = parseInt(document.getElementById('tick-speed').value) || 200;
    startSim();
}

document.addEventListener('DOMContentLoaded', () => {
    initCharts();

    document.getElementById('add-sphere-btn').addEventListener('click', addBiosphere);
    document.getElementById('run-btn').addEventListener('click', startSim);
    document.getElementById('reset-btn').addEventListener('click', resetAll);
    document.getElementById('apply-run-btn').addEventListener('click', applyAndRun);

    document.getElementById('tick-speed').addEventListener('input', e => {
        tickSpeed = parseInt(e.target.value);
        document.getElementById('tick-speed-val').textContent = `${tickSpeed}ms`;
        if (isRunning) { clearInterval(simTimer); simTimer = setInterval(tick, tickSpeed); }
    });

    // Start with 2 default biospheres
    addBiosphere();
    addBiosphere();
});

/**
 * app.js — Arranque, menú lateral y navegación entre secciones.
 *
 * Cada sección vive en js/vistas/<nombre>.js y exporta un objeto `vista`:
 *   { id, titulo, subtitulo, icono, grupo, acciones?, montar(el), render(el), handlers? }
 *   - montar: se ejecuta una sola vez (estructura fija: buscadores, filtros...)
 *   - render: se ejecuta cada vez que se muestra la sección o cambian los datos
 *   - handlers: funciones que el HTML llama con onclick="App.nombre(...)"
 */

import { Store } from './store.js';
import { esc, iniciales } from './util.js';
import { handleError } from './ui.js';
import { registrarRefresco, irAPagina } from './vistas/comun.js';

import { vista as inicio } from './vistas/inicio.js';
import { vista as ventas } from './vistas/ventas.js';
import { vista as cotizaciones } from './vistas/cotizaciones.js';
import { vista as produccion } from './vistas/produccion.js';
import { vista as productos } from './vistas/productos.js';
import { vista as inventario } from './vistas/inventario.js';
import { vista as compras } from './vistas/compras.js';
import { vista as gastos } from './vistas/gastos.js';
import { vista as clientes } from './vistas/clientes.js';
import { vista as reportes } from './vistas/reportes.js';
import { vista as configuracion } from './vistas/configuracion.js';

const VISTAS = [inicio, ventas, cotizaciones, produccion, productos, inventario, compras, gastos, clientes, reportes, configuracion];
const GRUPOS = ['Principal', 'Catálogo', 'Administración', 'Sistema'];
const montadas = new Set();
let actual = 'inicio';

// ---------------- Menú lateral ----------------

function renderNav() {
    document.getElementById('nav').innerHTML = GRUPOS.map(grupo => `
        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 px-3">${grupo}</p>
        ${VISTAS.filter(v => v.grupo === grupo).map(v => `
            <button id="link-${v.id}" onclick="App.showTab('${v.id}')" class="nav-link w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${v.id === actual ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-indigo-600'}">
                <i class="fa-solid ${v.icono} w-5 text-center"></i><span class="flex-1 text-left">${v.titulo}</span>${contador(v.id)}
            </button>`).join('')}
    `).join('');

    const cfg = Store.state.config;
    document.getElementById('marca').innerHTML = cfg.logo
        ? `<img src="${esc(cfg.logo)}" alt="${esc(cfg.negocio_nombre)}" class="max-h-12 max-w-full object-contain">`
        : `<i class="fa-solid fa-gem text-2xl text-indigo-600 mr-2"></i><div class="min-w-0 leading-tight">
               <p class="text-lg font-black tracking-tight bg-gradient-to-r from-indigo-800 via-indigo-500 to-violet-600 bg-clip-text text-transparent truncate">${esc(cfg.negocio_nombre || 'SubliApp')}</p>
               ${cfg.negocio_eslogan ? `<p class="text-[9px] uppercase tracking-wide text-slate-400 truncate">${esc(cfg.negocio_eslogan)}</p>` : ''}</div>`;
    document.title = `${cfg.negocio_nombre || 'SubliApp'} · SubliApp`;
    document.getElementById('negocio-nombre').textContent = cfg.negocio_nombre || 'Mi negocio';
    document.getElementById('negocio-avatar').textContent = iniciales(cfg.negocio_nombre);
}

/** Pequeños contadores en el menú (pedidos atrasados, stock bajo). */
function contador(id) {
    let n = 0;
    if (id === 'produccion') n = Store.ventasAtrasadas().length;
    if (id === 'inventario') n = Store.state.insumos.filter(i => Store.estadoStock(i) !== 'Óptimo').length;
    return n ? `<span class="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">${n}</span>` : '';
}

function toggleSidebar(force) {
    const sidebar = document.getElementById('sidebar');
    const abrir = force !== undefined ? force : sidebar.classList.contains('-translate-x-full');
    sidebar.classList.toggle('-translate-x-full', !abrir);
    document.getElementById('sidebar-overlay').classList.toggle('hidden', !abrir);
}

// ---------------- Navegación ----------------

function contenedor(id) {
    let el = document.getElementById('tab-' + id);
    if (!el) {
        el = document.createElement('div');
        el.id = 'tab-' + id;
        el.className = 'tab-content hidden animation-fade';
        document.getElementById('contenido').appendChild(el);
    }
    return el;
}

function showTab(id) {
    const v = VISTAS.find(x => x.id === id) || inicio;
    actual = v.id;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const el = contenedor(v.id);
    if (!montadas.has(v.id)) {
        v.montar?.(el);
        montadas.add(v.id);
    }
    el.classList.remove('hidden');

    document.getElementById('header-title').textContent = v.titulo;
    document.getElementById('header-subtitle').textContent = v.subtitulo;
    document.getElementById('header-actions').innerHTML = (v.acciones || []).map(a => {
        const cls = a.variante === 'secundario'
            ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200';
        return `<button onclick="App.${a.fn}()" class="${cls} px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"><i class="fa-solid ${a.icono}"></i><span class="hidden sm:inline">${a.texto}</span></button>`;
    }).join('');

    toggleSidebar(false);
    document.getElementById('contenido').scrollTop = 0;
    refrescar();
}

function refrescar() {
    renderNav();
    const v = VISTAS.find(x => x.id === actual);
    try {
        v.render(contenedor(v.id));
    } catch (e) {
        handleError(e);
    }
}

// ---------------- Arranque ----------------

function showScreen(id) {
    ['loading-screen', 'error-screen', 'app-shell'].forEach(s => {
        document.getElementById(s).classList.toggle('hidden', s !== id);
    });
}

async function iniciar() {
    showScreen('loading-screen');
    try {
        await Store.load();
        showScreen('app-shell');
        showTab(actual);
    } catch (e) {
        console.error(e);
        document.getElementById('error-detalle').textContent = e?.message || String(e);
        showScreen('error-screen');
    }
}

registrarRefresco(refrescar);

window.App = Object.assign({ showTab, toggleSidebar, iniciar, irAPagina },
    ...VISTAS.map(v => v.handlers || {}));

iniciar();

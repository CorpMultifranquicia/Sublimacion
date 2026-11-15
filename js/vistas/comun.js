/**
 * comun.js — Piezas compartidas por las vistas: paginación, buscadores,
 * insignias (badges), filas vacías y el refresco general de la pantalla.
 */

import { esc } from '../util.js';

// ---------- Refresco ----------

let refrescarFn = () => {};

/** app.js registra aquí cómo redibujar la pantalla actual. */
export function registrarRefresco(fn) { refrescarFn = fn; }

/** Redibuja la sección visible (llamar después de cada cambio de datos). */
export function refrescar() { refrescarFn(); }

// ---------- Paginación ----------

export const PAGE_SIZE = 10;
const paginas = {};

export function paginar(lista, clave) {
    const totalPages = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
    paginas[clave] = Math.min(Math.max(1, paginas[clave] || 1), totalPages);
    const inicio = (paginas[clave] - 1) * PAGE_SIZE;
    return { items: lista.slice(inicio, inicio + PAGE_SIZE), totalPages, total: lista.length, pagina: paginas[clave] };
}

export function irAPagina(clave, pagina) {
    paginas[clave] = pagina;
    refrescar();
}

export function reiniciarPagina(clave) { paginas[clave] = 1; }

export function barraPaginacion(clave, { totalPages, total, pagina }, extraHtml = '') {
    if (total === 0) return extraHtml ? `<div class="px-6 py-3 border-t border-slate-100 text-xs text-slate-500">${extraHtml}</div>` : '';
    return `<div class="flex flex-wrap gap-2 justify-between items-center px-6 py-3 border-t border-slate-100 text-xs text-slate-500">
        <span>${total} resultado${total !== 1 ? 's' : ''}${totalPages > 1 ? ` · página ${pagina} de ${totalPages}` : ''}${extraHtml ? ` · ${extraHtml}` : ''}</span>
        ${totalPages > 1 ? `<div class="flex gap-2">
            <button ${pagina <= 1 ? 'disabled' : ''} onclick="App.irAPagina('${clave}', ${pagina - 1})" class="px-3 py-1 rounded border border-slate-200 bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">Anterior</button>
            <button ${pagina >= totalPages ? 'disabled' : ''} onclick="App.irAPagina('${clave}', ${pagina + 1})" class="px-3 py-1 rounded border border-slate-200 bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">Siguiente</button>
        </div>` : ''}
    </div>`;
}

// ---------- Fragmentos HTML ----------

export function buscador(id, placeholder, valor = '') {
    return `<div class="relative w-full sm:w-72">
        <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
        <input id="${id}" type="search" value="${esc(valor)}" placeholder="${esc(placeholder)}" class="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-indigo-500">
    </div>`;
}

export function chips(id, opciones, activo) {
    return `<div id="${id}" class="flex gap-2 flex-wrap">${opciones.map(([valor, texto]) => `
        <button data-valor="${esc(valor)}" class="px-3 py-1.5 rounded-lg text-sm font-medium ${valor === activo ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}">${texto}</button>`).join('')}
    </div>`;
}

export function filaVacia(columnas, texto) {
    return `<tr><td colspan="${columnas}" class="py-10 text-center text-slate-400 text-sm">${texto}</td></tr>`;
}

export const ESTADO_BADGE = {
    'Por Diseñar': 'bg-blue-100 text-blue-700',
    'Imprimiendo': 'bg-amber-100 text-amber-700',
    'Listo': 'bg-violet-100 text-violet-700',
    'Entregado': 'bg-emerald-100 text-emerald-700',
};

export const ESTADO_STOCK_BADGE = {
    'Óptimo': 'bg-emerald-100 text-emerald-700',
    'Alerta': 'bg-amber-100 text-amber-700',
    'Crítico': 'bg-rose-100 text-rose-700',
};

export function badge(texto, clases) {
    return `<span class="inline-block px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${clases}">${texto}</span>`;
}

/** Botón de ícono para columnas de acciones. */
export function botonIcono(onclick, icono, titulo, color = 'hover:text-indigo-600') {
    return `<button onclick="${onclick}" title="${esc(titulo)}" aria-label="${esc(titulo)}" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 ${color}"><i class="${icono}"></i></button>`;
}

export const tarjeta = (contenido, clases = '') => `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 ${clases}">${contenido}</div>`;

export const etiqueta = (texto, para = '') => `<label ${para ? `for="${para}"` : ''} class="block text-xs font-bold text-slate-500 uppercase mb-1">${texto}</label>`;

export const claseInput = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500';

/** Conecta un buscador para que actualice `setter(valor)` y redibuje, sin perder el foco. */
export function conectarBuscador(id, setter, clavePagina) {
    document.getElementById(id)?.addEventListener('input', (e) => {
        setter(e.target.value);
        if (clavePagina) reiniciarPagina(clavePagina);
        refrescar();
    });
}

export function conectarChips(id, setter, clavePagina) {
    document.getElementById(id)?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-valor]');
        if (!btn) return;
        setter(btn.dataset.valor);
        if (clavePagina) reiniciarPagina(clavePagina);
        refrescar();
    });
}

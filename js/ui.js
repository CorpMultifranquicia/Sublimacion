/**
 * ui.js — Piezas de interfaz reutilizables:
 *   - modal genérico (formularios de alta/edición) y diálogo de confirmación
 *   - avisos tipo "toast" (reemplazan a los alert() del navegador)
 *   - combo con buscador (para elegir cliente, producto o insumo escribiendo)
 */

import { esc, normalizar } from './util.js';

// ---------------- Toasts ----------------

const ICONO_TOAST = { ok: 'fa-circle-check text-emerald-500', error: 'fa-circle-xmark text-rose-500', aviso: 'fa-triangle-exclamation text-amber-500', info: 'fa-circle-info text-indigo-500' };

export function toast(mensaje, tipo = 'ok') {
    let zona = document.getElementById('toasts');
    if (!zona) {
        zona = document.createElement('div');
        zona.id = 'toasts';
        zona.className = 'fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none';
        document.body.appendChild(zona);
    }
    const el = document.createElement('div');
    el.className = 'toast pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 text-sm text-slate-700 max-w-sm';
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = `<i class="fa-solid ${ICONO_TOAST[tipo] || ICONO_TOAST.info} mt-0.5"></i><span class="flex-1">${esc(mensaje)}</span>
        <button class="text-slate-300 hover:text-slate-500" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>`;
    const quitar = () => { el.classList.add('toast-salida'); setTimeout(() => el.remove(), 200); };
    el.querySelector('button').addEventListener('click', quitar);
    zona.appendChild(el);
    setTimeout(quitar, tipo === 'error' ? 7000 : 3500);
}

export function handleError(e) {
    console.error(e);
    toast(e?.message || String(e), 'error');
}

// ---------------- Modal ----------------

const overlay = () => document.getElementById('modal-overlay');
const panel = () => document.getElementById('modal-panel');
let modalAbierto = false;

export function closeModal() {
    overlay().classList.add('hidden');
    panel().innerHTML = '';
    modalAbierto = false;
}

/**
 * Abre el modal con un formulario.
 * @param {string} titulo
 * @param {string} cuerpoHtml  contenido del <form>
 * @param {(formData: FormData, form: HTMLFormElement) => Promise|void} onSubmit
 * @param {{ textoGuardar?: string, ancho?: 'md'|'lg'|'2xl'|'4xl', sinGuardar?: boolean, peligro?: boolean }} opciones
 */
export function openModal(titulo, cuerpoHtml, onSubmit, opciones = {}) {
    const anchos = { md: 'max-w-md', lg: 'max-w-lg', '2xl': 'max-w-2xl', '4xl': 'max-w-4xl' };
    const p = panel();
    p.className = `bg-white rounded-2xl shadow-2xl w-full ${anchos[opciones.ancho || 'lg']} animation-fade flex flex-col max-h-[92vh]`;
    p.innerHTML = `
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
            <h3 class="text-lg font-bold text-slate-800">${titulo}</h3>
            <button type="button" data-close class="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <form id="modal-form" class="p-6 space-y-4 overflow-y-auto" novalidate>${cuerpoHtml}</form>
        <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <button type="button" data-close class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">${opciones.sinGuardar ? 'Cerrar' : 'Cancelar'}</button>
            <button type="submit" form="modal-form" class="${opciones.sinGuardar ? 'hidden' : ''} px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md ${opciones.peligro ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}">${opciones.textoGuardar || 'Guardar'}</button>
        </div>
    `;
    overlay().classList.remove('hidden');
    modalAbierto = true;
    p.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));

    const form = p.querySelector('#modal-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.checkValidity()) {
            const invalido = form.querySelector(':invalid');
            const etiqueta = invalido?.closest('div')?.querySelector('label')?.textContent?.trim();
            toast(etiqueta ? `Revisa el campo "${etiqueta}".` : 'Revisa los campos marcados.', 'aviso');
            invalido?.focus();
            return;
        }
        const btn = p.querySelector('button[type="submit"]');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>Guardando...`;
        try {
            await onSubmit(new FormData(form), form);
        } finally {
            if (document.body.contains(btn)) {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'cursor-not-allowed');
                btn.innerHTML = original;
            }
        }
    });
    setTimeout(() => form.querySelector('input:not([type=hidden]):not([readonly]), select, textarea')?.focus(), 50);
    return { panel: p, form };
}

export function confirmDialog(mensaje, onConfirm, textoConfirmar = 'Confirmar') {
    openModal('Confirmar', `<p class="text-sm text-slate-600">${mensaje}</p>`, async () => {
        await onConfirm();
        if (modalAbierto) closeModal();
    }, { textoGuardar: textoConfirmar, peligro: true, ancho: 'md' });
}

// Escape o clic fuera del panel cierran el modal (se registra una sola vez).
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalAbierto && !e.defaultPrevented) closeModal();
});
document.addEventListener('mousedown', (e) => {
    if (modalAbierto && e.target === overlay()) closeModal();
});

// ---------------- Combo con buscador ----------------

/**
 * Convierte un <input> en un selector con búsqueda.
 * @param {HTMLInputElement} input
 * @param {{
 *   items: {id: string, label: string, sub?: string}[],
 *   valor?: string,                 id inicial
 *   onChange?: (item|null) => void,
 *   permitirTexto?: boolean,        acepta texto libre que no está en la lista (item con id null)
 *   crear?: { texto: string, accion: (texto) => Promise<{id,label}> }   opción "+ Crear ..."
 * }} cfg
 * @returns {{ get: () => {id, label}|null }}
 */
export function combo(input, cfg) {
    const wrap = document.createElement('div');
    wrap.className = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const lista = document.createElement('ul');
    lista.className = 'combo-lista hidden absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto text-sm';
    wrap.appendChild(lista);
    input.autocomplete = 'off';

    let seleccionado = cfg.items.find(i => i.id === cfg.valor) || null;
    if (seleccionado) input.value = seleccionado.label;
    else if (cfg.textoInicial) input.value = cfg.textoInicial;
    let activos = [];
    let indice = -1;

    function elegir(item) {
        seleccionado = item;
        input.value = item ? item.label : input.value;
        cerrar();
        input.classList.remove('border-rose-400');
        cfg.onChange?.(item);
    }

    function cerrar() { lista.classList.add('hidden'); indice = -1; }

    function pintar() {
        const q = normalizar(input.value.trim());
        const coincide = (i) => !q || normalizar(i.label + ' ' + (i.sub || '')).includes(q);
        activos = cfg.items.filter(coincide).slice(0, 50);
        const opcionCrear = cfg.crear && input.value.trim() && !cfg.items.some(i => normalizar(i.label) === q);
        lista.innerHTML = activos.map((i, idx) => `
            <li data-idx="${idx}" class="px-3 py-2 cursor-pointer hover:bg-indigo-50 ${idx === indice ? 'bg-indigo-50' : ''}">
                <span class="text-slate-700">${esc(i.label)}</span>${i.sub ? `<span class="block text-xs text-slate-400">${esc(i.sub)}</span>` : ''}
            </li>`).join('')
            + (opcionCrear ? `<li data-crear class="px-3 py-2 cursor-pointer text-indigo-600 font-medium hover:bg-indigo-50 border-t border-slate-100"><i class="fa-solid fa-plus mr-1"></i>${esc(cfg.crear.texto)} «${esc(input.value.trim())}»</li>` : '')
            || '<li class="px-3 py-2 text-slate-400">Sin resultados</li>';
        lista.classList.remove('hidden');
    }

    async function crearNuevo() {
        try {
            const nuevo = await cfg.crear.accion(input.value.trim());
            cfg.items.push(nuevo);
            elegir(nuevo);
        } catch (e) { handleError(e); }
    }

    // Al enfocar se muestra la lista solo si aún no hay nada elegido (al editar no estorba).
    input.addEventListener('focus', () => { input.select(); if (!seleccionado) pintar(); });
    input.addEventListener('click', () => { if (lista.classList.contains('hidden')) pintar(); });
    input.addEventListener('input', () => {
        seleccionado = null;
        indice = activos.length ? 0 : -1;
        pintar();
        if (cfg.permitirTexto) cfg.onChange?.(null);
    });
    input.addEventListener('keydown', (e) => {
        if (lista.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); indice = Math.min(indice + 1, activos.length - 1); pintar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); indice = Math.max(indice - 1, 0); pintar(); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (activos[indice]) elegir(activos[indice]);
            else if (cfg.crear && input.value.trim()) crearNuevo();
        } else if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    });
    lista.addEventListener('mousedown', (e) => {
        e.preventDefault(); // que el input no pierda el foco antes del clic
        const li = e.target.closest('li');
        if (!li) return;
        if (li.hasAttribute('data-crear')) crearNuevo();
        else if (li.dataset.idx !== undefined) elegir(activos[Number(li.dataset.idx)]);
    });
    input.addEventListener('blur', () => {
        cerrar();
        if (!seleccionado && !cfg.permitirTexto) {
            // Si escribió exactamente el nombre de una opción, se toma esa.
            const exacto = cfg.items.find(i => normalizar(i.label) === normalizar(input.value.trim()));
            if (exacto) elegir(exacto);
            else if (input.value.trim()) input.classList.add('border-rose-400');
        }
    });

    return {
        get: () => seleccionado || (cfg.permitirTexto && input.value.trim() ? { id: null, label: input.value.trim() } : null),
    };
}

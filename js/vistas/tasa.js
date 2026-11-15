/**
 * tasa.js — Tasa de cambio del día (Bs por $), cargada a mano.
 *   - chipTasa(): indicador del encabezado (ámbar si la tasa no es de hoy).
 *   - openTasaModal(): cargar/corregir la tasa e historial.
 *   - elegirMonedaDocumento(): pregunta en qué moneda generar un PDF y con qué tasa.
 *
 * Regla: los precios y costos se guardan en la moneda base ($). Los bolívares
 * siempre se calculan multiplicando por una tasa que queda guardada en el
 * documento (venta, cotización o abono), para poder reimprimirlo igual.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtBs, fmtTasa, fmtFecha, hoyISO } from '../util.js';
import { openModal, closeModal, toast, handleError } from '../ui.js';
import { refrescar, etiqueta, claseInput } from './comun.js';

export function chipTasa() {
    if (!Store.bsActivo()) return '';
    const tasa = Store.tasaDia();
    const local = esc(Store.state.config.moneda_local || 'Bs');
    if (!tasa) {
        return `<button onclick="App.openTasaModal()" class="px-3 py-2 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"><i class="fa-solid fa-coins mr-1"></i>Cargar tasa del día</button>`;
    }
    const deHoy = Store.tasaEsDeHoy();
    return `<button onclick="App.openTasaModal()" title="${deHoy ? 'Tasa de hoy' : 'La tasa no es de hoy: haz clic para actualizarla'}"
        class="px-3 py-1.5 rounded-lg text-left border ${deHoy ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-amber-300 bg-amber-50 hover:bg-amber-100'} whitespace-nowrap">
        <span class="block text-[10px] uppercase tracking-wide ${deHoy ? 'text-slate-400' : 'text-amber-700 font-bold'}">${deHoy ? 'Tasa del día' : 'Actualizar tasa'}</span>
        <span class="text-sm font-bold text-slate-700">${local} ${fmtTasa(tasa)}</span>${deHoy ? '' : `<span class="text-[11px] text-amber-700 ml-1">(${fmtFecha(Store.state.config.tasa_fecha)})</span>`}
    </button>`;
}

export function openTasaModal() {
    const local = Store.state.config.moneda_local || 'Bs';
    const tasa = Store.tasaDia();
    const body = `
        <p class="text-sm text-slate-600">Escribe cuántos <b>${esc(local)}</b> vale <b>1 ${esc(Store.state.config.moneda || '$')}</b> hoy (por ejemplo, la tasa oficial del BCV). Se usa para mostrar montos en bolívares, registrar pagos en bolívares y generar presupuestos y recibos en bolívares.</p>
        <div class="grid grid-cols-2 gap-3">
            <div>${etiqueta('Fecha')}<input name="fecha" type="date" required value="${hoyISO()}" class="${claseInput}"></div>
            <div>${etiqueta(`Tasa (${esc(local)} por 1 $)`)}<input name="tasa" type="number" step="any" min="0.0001" required value="${Store.tasaEsDeHoy() && tasa ? tasa : ''}" placeholder="${tasa ? fmtTasa(tasa) : 'Ej: 36,50'}" class="${claseInput} text-lg font-bold"></div>
        </div>
        <p id="tasa-ejemplo" class="text-xs text-slate-500"></p>
        <div>
            ${etiqueta('Historial')}
            <ul class="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg text-sm">${Store.state.tasas.map(t => `
                <li class="flex justify-between items-center px-3 py-1.5"><span class="text-slate-500">${fmtFecha(t.fecha)}${t.fecha === hoyISO() ? ' <b class="text-emerald-600">(hoy)</b>' : ''}</span>
                    <span class="flex items-center gap-2"><b>${esc(local)} ${fmtTasa(t.tasa)}</b><button type="button" data-borrar-tasa="${t.fecha}" class="text-slate-300 hover:text-rose-500" aria-label="Borrar"><i class="fa-solid fa-xmark"></i></button></span></li>`).join('')
                || '<li class="px-3 py-3 text-center text-slate-400">Aún no has cargado ninguna tasa</li>'}
            </ul>
        </div>`;
    const { panel } = openModal('Tasa del día', body, async (formData) => {
        try {
            await Store.guardarTasa(formData.get('fecha'), Number(formData.get('tasa')));
            closeModal();
            refrescar();
            toast(`Tasa guardada: ${local} ${fmtTasa(Number(formData.get('tasa')))} por $.`);
        } catch (e) { handleError(e); }
    }, { ancho: 'md', textoGuardar: 'Guardar tasa' });
    const input = panel.querySelector('[name=tasa]');
    const ejemplo = () => {
        const t = Number(input.value);
        panel.querySelector('#tasa-ejemplo').textContent = t > 0 ? `Ejemplo: un producto de ${fmt(10)} se mostrará como ${fmtBs(10 * t)}.` : '';
    };
    input.addEventListener('input', ejemplo);
    ejemplo();
    panel.querySelectorAll('[data-borrar-tasa]').forEach(btn => btn.addEventListener('click', async () => {
        try { await Store.borrarTasa(btn.dataset.borrarTasa); closeModal(); refrescar(); openTasaModal(); } catch (e) { handleError(e); }
    }));
}

/**
 * Pregunta en qué moneda generar un documento.
 * @param {number|null} tasaDocumento  tasa guardada en la venta/cotización
 * @returns {Promise<{moneda: 'base'|'local'|'ambas', tasa: number|null}|null>}  null si cancela
 */
export function elegirMonedaDocumento(tasaDocumento) {
    if (!Store.bsActivo()) return Promise.resolve({ moneda: 'base', tasa: null });
    const local = esc(Store.state.config.moneda_local || 'Bs');
    const base = esc(Store.state.config.moneda || '$');
    const preferida = Store.state.config.documentos_moneda || 'ambas';
    const tasaHoy = Store.tasaDia();
    const opciones = [['base', `Solo en ${base}`, 'Precios en dólares'], ['local', `Solo en ${local}`, 'Todo convertido a bolívares'], ['ambas', 'En ambas monedas', `Precios en ${base} y totales también en ${local}`]];
    return new Promise((resolve) => {
        let resuelto = false;
        const body = `
            <div class="grid grid-cols-1 gap-2">${opciones.map(([v, t, d]) => `
                <label class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
                    <input type="radio" name="moneda" value="${v}" ${v === preferida ? 'checked' : ''} class="accent-indigo-600">
                    <span><span class="block font-semibold text-slate-700 text-sm">${t}</span><span class="text-xs text-slate-500">${d}</span></span>
                </label>`).join('')}
            </div>
            <div id="doc-tasa">
                ${etiqueta(`Tasa a usar (${local} por 1 ${base})`)}
                <input name="tasa" type="number" step="any" min="0.0001" value="${tasaDocumento || tasaHoy || ''}" class="${claseInput}">
                <div class="flex flex-wrap gap-2 mt-2 text-xs">
                    ${tasaDocumento ? `<button type="button" data-tasa="${tasaDocumento}" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">Tasa del documento: ${fmtTasa(tasaDocumento)}</button>` : ''}
                    ${tasaHoy ? `<button type="button" data-tasa="${tasaHoy}" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">Tasa del día: ${fmtTasa(tasaHoy)}${Store.tasaEsDeHoy() ? '' : ` (${fmtFecha(Store.state.config.tasa_fecha)})`}</button>` : ''}
                </div>
            </div>`;
        const { panel } = openModal('¿En qué moneda generar el PDF?', body, async (formData) => {
            const moneda = formData.get('moneda');
            const tasa = Number(formData.get('tasa')) || null;
            if (moneda !== 'base' && !tasa) { toast('Escribe la tasa para generar el documento en bolívares.', 'aviso'); return; }
            resuelto = true;
            closeModal();
            resolve({ moneda, tasa: moneda === 'base' ? null : tasa });
        }, { ancho: 'md', textoGuardar: '<i class="fa-solid fa-file-pdf mr-1"></i>Generar PDF' });
        const zonaTasa = panel.querySelector('#doc-tasa');
        const actualizar = () => zonaTasa.classList.toggle('hidden', panel.querySelector('[name=moneda]:checked')?.value === 'base');
        panel.querySelectorAll('[name=moneda]').forEach(r => r.addEventListener('change', actualizar));
        panel.querySelectorAll('[data-tasa]').forEach(b => b.addEventListener('click', () => { panel.querySelector('[name=tasa]').value = b.dataset.tasa; }));
        actualizar();
        // Si se cierra sin generar, se avisa a quien esperaba la respuesta.
        const observador = new MutationObserver(() => {
            if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
            observador.disconnect();
            if (!resuelto) resolve(null);
        });
        observador.observe(document.getElementById('modal-overlay'), { attributes: true, attributeFilter: ['class'] });
    });
}

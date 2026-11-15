/**
 * gastos.js — Gastos generales del negocio (alquiler, luz, internet, sueldos...).
 * Se restan en Reportes para obtener la utilidad neta.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtFecha, hoyISO, rangoMes, enRango, nombreMes, parseISO, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError } from '../ui.js';
import { refrescar, filaVacia, botonIcono, etiqueta, claseInput, tarjeta, buscador, conectarBuscador } from './comun.js';

const CATEGORIAS_BASE = ['Alquiler', 'Electricidad', 'Agua', 'Internet y teléfono', 'Sueldos', 'Transporte', 'Publicidad', 'Mantenimiento', 'Comisiones bancarias', 'Impuestos', 'Otros'];
let mes = hoyISO().slice(0, 7); // 'AAAA-MM' o '' para todos
let consulta = '';

function montar(el) {
    el.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
            <div class="flex items-center gap-2">
                <label for="gastos-mes" class="text-sm text-slate-500">Mes:</label>
                <input id="gastos-mes" type="month" value="${mes}" class="${claseInput} w-auto">
                <button id="gastos-todos" class="text-sm text-indigo-600 hover:underline">Ver todos</button>
            </div>
            ${buscador('buscar-gasto', 'Buscar gasto...')}
        </div>
        <div id="gastos-resumen" class="mb-4"></div>
        ${tarjeta(`<div class="overflow-x-auto"><table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                <tr><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Categoría</th><th class="px-4 py-3">Descripción</th><th class="px-4 py-3 text-right">Monto</th><th class="px-4 py-3"></th></tr>
            </thead>
            <tbody id="tbl-gastos" class="text-sm divide-y divide-slate-50"></tbody>
        </table></div>`)}`;
    el.querySelector('#gastos-mes').addEventListener('change', (e) => { mes = e.target.value; refrescar(); });
    el.querySelector('#gastos-todos').addEventListener('click', () => { mes = ''; el.querySelector('#gastos-mes').value = ''; refrescar(); });
    conectarBuscador('buscar-gasto', v => { consulta = v; });
}

function render() {
    const q = normalizar(consulta.trim());
    const rango = mes ? rangoMes(`${mes}-01`) : null;
    const lista = Store.state.gastos.filter(g => (!rango || enRango(g.fecha, rango.desde, rango.hasta))
        && (!q || normalizar(`${g.categoria} ${g.descripcion}`).includes(q)));
    const total = lista.reduce((s, g) => s + g.monto, 0);
    const porCategoria = {};
    lista.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto; });
    const titulo = mes ? nombreMes(parseISO(`${mes}-01`).getFullYear(), parseISO(`${mes}-01`).getMonth()) : 'todo el historial';

    document.getElementById('gastos-resumen').innerHTML = tarjeta(`<div class="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div><p class="text-xs text-slate-500">Total gastos · ${titulo}</p><p class="text-2xl font-black text-rose-600">${fmt(total)}</p></div>
        <div class="flex flex-wrap gap-2">${Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([c, m]) =>
            `<span class="px-2.5 py-1 rounded-full bg-slate-100 text-xs text-slate-600">${esc(c)}: <b>${fmt(m)}</b></span>`).join('')}</div>
    </div>`);

    document.getElementById('tbl-gastos').innerHTML = lista.map(g => `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${fmtFecha(g.fecha)}</td>
            <td class="px-4 py-3 font-medium text-slate-700">${esc(g.categoria)}</td>
            <td class="px-4 py-3 text-slate-600">${esc(g.descripcion || '—')}</td>
            <td class="px-4 py-3 text-right font-bold text-slate-700 whitespace-nowrap">${fmt(g.monto)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.openGastoModal('${g.id}')`, 'fa-solid fa-pen', 'Editar')}
                ${botonIcono(`App.eliminarGasto('${g.id}')`, 'fa-solid fa-trash', 'Eliminar', 'hover:text-rose-500')}
            </td>
        </tr>`).join('') || filaVacia(5, `Sin gastos en ${titulo}. Registra aquí alquiler, luz, internet, sueldos...`);
}

function eliminarGasto(id) {
    confirmDialog('¿Eliminar este gasto?', async () => {
        try { await Store.deleteGasto(id); refrescar(); toast('Gasto eliminado.'); } catch (e) { handleError(e); }
    }, 'Eliminar');
}

function openGastoModal(id) {
    if (typeof id !== 'string') id = undefined;
    const editando = id ? Store.state.gastos.find(g => g.id === id) : null;
    const categorias = [...new Set([...CATEGORIAS_BASE, ...Store.state.gastos.map(g => g.categoria)])].sort();
    const body = `
        <div class="grid grid-cols-2 gap-3">
            <div>${etiqueta('Fecha')}<input name="fecha" type="date" required value="${editando?.fecha || hoyISO()}" class="${claseInput}"></div>
            <div>${etiqueta('Monto')}<input name="monto" type="number" step="0.01" min="0.01" required value="${editando?.monto ?? ''}" class="${claseInput}"></div>
        </div>
        <div>${etiqueta('Categoría')}<input name="categoria" list="lista-cat-gastos" required value="${esc(editando?.categoria)}" class="${claseInput}" placeholder="Alquiler, Electricidad...">
            <datalist id="lista-cat-gastos">${categorias.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div>${etiqueta('Descripción')}<input name="descripcion" value="${esc(editando?.descripcion)}" class="${claseInput}" placeholder="Opcional"></div>`;
    openModal(editando ? 'Editar gasto' : 'Nuevo gasto', body, async (formData) => {
        const data = { fecha: formData.get('fecha'), monto: Number(formData.get('monto')), categoria: formData.get('categoria'), descripcion: formData.get('descripcion') };
        try {
            if (editando) await Store.updateGasto(editando.id, data); else await Store.addGasto(data);
            closeModal();
            refrescar();
            toast('Gasto guardado.');
        } catch (e) { handleError(e); }
    }, { ancho: 'md' });
}

export const vista = {
    id: 'gastos',
    titulo: 'Gastos',
    subtitulo: 'Gastos generales del negocio',
    icono: 'fa-receipt',
    grupo: 'Administración',
    acciones: [{ texto: 'Nuevo Gasto', icono: 'fa-plus', fn: 'openGastoModal' }],
    montar,
    render,
    handlers: { openGastoModal, eliminarGasto },
};

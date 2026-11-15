/**
 * inventario.js — Insumos, alertas de stock, valor del inventario y kárdex
 * (historial de movimientos) con registro de mermas y ajustes.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtCosto, fmtNum, fmtFecha, hoyISO, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError } from '../ui.js';
import {
    refrescar, paginar, barraPaginacion, buscador, chips, filaVacia, badge, botonIcono, ESTADO_STOCK_BADGE,
    conectarBuscador, conectarChips, etiqueta, claseInput, tarjeta,
} from './comun.js';

let consulta = '';
let filtro = 'Todos';

function montar(el) {
    el.innerHTML = `
        <div id="inventario-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></div>
        ${tarjeta(`
        <div class="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between rounded-t-2xl">
            <div id="chips-inventario"></div>
            ${buscador('buscar-insumo', 'Buscar insumo...')}
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                    <tr><th class="px-4 py-3">Insumo</th><th class="px-4 py-3">Categoría</th><th class="px-4 py-3 text-right">Stock actual</th>
                        <th class="px-4 py-3 text-right">Mínimo</th><th class="px-4 py-3 text-center">Estado</th>
                        <th class="px-4 py-3 text-right">Costo unitario</th><th class="px-4 py-3 text-right">Valor en stock</th><th class="px-4 py-3"></th></tr>
                </thead>
                <tbody id="tbl-inventario" class="text-sm divide-y divide-slate-50"></tbody>
            </table>
        </div>
        <div id="paginacion-inventario"></div>`)}`;
    conectarBuscador('buscar-insumo', v => { consulta = v; }, 'inventario');
    conectarChips('chips-inventario', v => { filtro = v; }, 'inventario');
}

function kpi(titulo, valor, icono, color) {
    return tarjeta(`<div class="p-4 flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-${color}-50 text-${color}-600 flex items-center justify-center"><i class="fa-solid ${icono}"></i></div>
        <div><p class="text-xs text-slate-500">${titulo}</p><p class="text-lg font-bold text-slate-800">${valor}</p></div></div>`);
}

function render() {
    const insumos = Store.state.insumos;
    const alerta = insumos.filter(i => Store.estadoStock(i) !== 'Óptimo').length;
    const negativos = insumos.filter(i => i.stock_actual < 0).length;
    document.getElementById('inventario-kpis').innerHTML =
        kpi('Insumos', insumos.length, 'fa-boxes-stacked', 'indigo') +
        kpi('Valor del inventario', fmt(Store.valorInventario()), 'fa-sack-dollar', 'emerald') +
        kpi('Stock bajo o crítico', alerta, 'fa-triangle-exclamation', alerta ? 'amber' : 'slate') +
        kpi('En negativo', negativos, 'fa-circle-minus', negativos ? 'rose' : 'slate');

    document.getElementById('chips-inventario').innerHTML = chips('chips-inv-int', [
        ['Todos', 'Todos'], ['Consumible', 'Consumibles'], ['Sustrato', 'Sustratos'], ['Alertas', `Stock bajo (${alerta})`],
    ], filtro);

    const q = normalizar(consulta.trim());
    const lista = insumos.filter(i =>
        (filtro === 'Todos' || i.categoria === filtro || (filtro === 'Alertas' && Store.estadoStock(i) !== 'Óptimo')) &&
        (!q || normalizar(i.nombre).includes(q)));
    const pag = paginar(lista, 'inventario');

    document.getElementById('tbl-inventario').innerHTML = pag.items.map(i => {
        const est = Store.estadoStock(i);
        const fondo = est === 'Crítico' ? 'bg-rose-50/60' : est === 'Alerta' ? 'bg-amber-50/40' : '';
        return `<tr class="${fondo} hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-medium text-slate-800">${esc(i.nombre)}</td>
            <td class="px-4 py-3 text-slate-500">${esc(i.categoria)}</td>
            <td class="px-4 py-3 text-right font-bold ${i.stock_actual < 0 ? 'text-rose-600' : 'text-slate-700'} whitespace-nowrap">${fmtNum(i.stock_actual)} ${esc(i.unidad_medida)}</td>
            <td class="px-4 py-3 text-right text-slate-500 whitespace-nowrap">${fmtNum(i.stock_minimo)} ${esc(i.unidad_medida)}</td>
            <td class="px-4 py-3 text-center">${badge(est, ESTADO_STOCK_BADGE[est])}</td>
            <td class="px-4 py-3 text-right text-slate-600 whitespace-nowrap">${fmtCosto(i.costo_unitario)} / ${esc(i.unidad_medida)}</td>
            <td class="px-4 py-3 text-right text-slate-700 whitespace-nowrap">${fmt(Math.max(i.stock_actual, 0) * i.costo_unitario)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.openKardex('${i.id}')`, 'fa-solid fa-clock-rotate-left', 'Movimientos y mermas (kárdex)')}
                ${botonIcono(`App.openInsumoModal('${i.id}')`, 'fa-solid fa-pen', 'Editar')}
                ${botonIcono(`App.eliminarInsumo('${i.id}')`, 'fa-solid fa-trash', 'Eliminar', 'hover:text-rose-500')}
            </td>
        </tr>`;
    }).join('') || filaVacia(8, consulta || filtro !== 'Todos' ? 'Ningún insumo coincide con el filtro' : 'Sin insumos. Usa "Nuevo Insumo" para cargar tinta, papel, tazas, franelas...');
    document.getElementById('paginacion-inventario').innerHTML = barraPaginacion('inventario', pag);
}

function eliminarInsumo(id) {
    const i = Store.state.insumos.find(x => x.id === id);
    confirmDialog(`¿Eliminar el insumo <b>${esc(i.nombre)}</b> y su historial de movimientos?`, async () => {
        try { await Store.deleteInsumo(id); refrescar(); toast('Insumo eliminado.'); } catch (e) { handleError(e); }
    }, 'Eliminar');
}

function openInsumoModal(id) {
    if (typeof id !== 'string') id = undefined;
    const editando = id ? Store.state.insumos.find(i => i.id === id) : null;
    const body = `
        <div>${etiqueta('Nombre')}<input name="nombre" required value="${esc(editando?.nombre)}" class="${claseInput}" placeholder="Ej: Tinta sublimación cian"></div>
        <div class="grid grid-cols-2 gap-3">
            <div>${etiqueta('Categoría')}<select name="categoria" class="${claseInput}">
                ${['Consumible', 'Sustrato'].map(c => `<option ${editando?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select><p class="text-xs text-slate-400 mt-1">Consumible: tinta, papel. Sustrato: taza, franela.</p></div>
            <div>${etiqueta('Unidad de medida')}<input name="unidad_medida" required value="${esc(editando?.unidad_medida ?? 'und')}" class="${claseInput}" placeholder="und, ml, hoja, m"></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
            <div>${etiqueta('Costo unitario')}<input name="costo_unitario" type="number" step="any" min="0" required value="${editando?.costo_unitario ?? ''}" class="${claseInput}"></div>
            <div>${etiqueta(editando ? 'Stock actual' : 'Stock inicial')}<input name="stock_actual" type="number" step="any" required value="${editando?.stock_actual ?? 0}" class="${claseInput}"></div>
            <div>${etiqueta('Stock mínimo')}<input name="stock_minimo" type="number" step="any" min="0" required value="${editando?.stock_minimo ?? 0}" class="${claseInput}"></div>
        </div>
        ${editando ? '<p class="text-xs text-slate-500 bg-slate-50 rounded-lg p-2"><i class="fa-solid fa-circle-info mr-1"></i>Si cambias el stock o el costo, el cambio queda registrado en el kárdex. Para mermas usa el botón <i class="fa-solid fa-clock-rotate-left"></i> del insumo.</p>' : ''}`;
    openModal(editando ? 'Editar insumo' : 'Nuevo insumo', body, async (formData) => {
        const data = Object.fromEntries(['nombre', 'categoria', 'unidad_medida'].map(k => [k, formData.get(k)]));
        ['costo_unitario', 'stock_actual', 'stock_minimo'].forEach(k => { data[k] = Number(formData.get(k)); });
        try {
            if (editando) await Store.updateInsumo(editando.id, data); else await Store.addInsumo(data);
            closeModal();
            refrescar();
            toast(`Insumo "${data.nombre}" guardado.`);
        } catch (e) { handleError(e); }
    });
}

// ---------------- Kárdex ----------------

async function openKardex(id) {
    const insumo = () => Store.state.insumos.find(i => i.id === id);
    let movimientos;
    try { movimientos = await Store.movimientos(id); } catch (e) { handleError(e); return; }
    const i = insumo();
    const body = `
        <div class="grid grid-cols-3 gap-3 text-center">
            <div class="p-3 rounded-xl bg-slate-50"><p class="text-xs text-slate-500">Stock actual</p><p class="font-bold ${i.stock_actual < 0 ? 'text-rose-600' : 'text-slate-800'}">${fmtNum(i.stock_actual)} ${esc(i.unidad_medida)}</p></div>
            <div class="p-3 rounded-xl bg-slate-50"><p class="text-xs text-slate-500">Costo unitario</p><p class="font-bold text-slate-800">${fmtCosto(i.costo_unitario)}</p></div>
            <div class="p-3 rounded-xl bg-slate-50"><p class="text-xs text-slate-500">Valor</p><p class="font-bold text-slate-800">${fmt(Math.max(i.stock_actual, 0) * i.costo_unitario)}</p></div>
        </div>
        <div class="p-4 bg-amber-50/50 border border-amber-100 rounded-xl">
            <p class="text-xs font-bold text-amber-700 uppercase mb-2">Registrar merma o ajuste</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select name="tipo" class="${claseInput}" aria-label="Tipo">
                    <option value="Merma">Merma</option><option value="Ajuste+">Ajuste (+)</option><option value="Ajuste-">Ajuste (−)</option>
                </select>
                <input name="cantidad" type="number" step="any" min="0" required placeholder="Cantidad (${esc(i.unidad_medida)})" class="${claseInput}" aria-label="Cantidad">
                <input name="fecha" type="date" value="${hoyISO()}" class="${claseInput}" aria-label="Fecha">
                <input name="nota" placeholder="Motivo (ej: taza rota)" class="${claseInput}" aria-label="Motivo">
            </div>
        </div>
        <div>
            ${etiqueta('Historial de movimientos')}
            <div class="max-h-72 overflow-y-auto border border-slate-100 rounded-lg">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400 sticky top-0"><tr>
                        <th class="px-3 py-2 text-left">Fecha</th><th class="px-3 py-2 text-left">Movimiento</th><th class="px-3 py-2 text-right">Cantidad</th><th class="px-3 py-2 text-right">Saldo</th></tr></thead>
                    <tbody class="divide-y divide-slate-50">${movimientos.map(m => `
                        <tr>
                            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${fmtFecha(m.fecha)}</td>
                            <td class="px-3 py-2"><span class="font-medium text-slate-700">${esc(m.tipo)}</span>${m.referencia ? ` <span class="font-mono text-xs text-indigo-600">${esc(m.referencia)}</span>` : ''}${m.nota ? `<span class="block text-xs text-slate-400">${esc(m.nota)}</span>` : ''}</td>
                            <td class="px-3 py-2 text-right font-semibold whitespace-nowrap ${m.cantidad > 0 ? 'text-emerald-600' : m.cantidad < 0 ? 'text-rose-600' : 'text-slate-400'}">${m.cantidad > 0 ? '+' : ''}${m.cantidad ? fmtNum(m.cantidad) : (m.tipo === 'Cambio de costo' ? fmtCosto(m.costo_unitario) : '0')}</td>
                            <td class="px-3 py-2 text-right text-slate-600 whitespace-nowrap">${fmtNum(m.stock_resultante)}</td>
                        </tr>`).join('') || '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400">Sin movimientos</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;
    openModal(`Kárdex · ${esc(i.nombre)}`, body, async (formData) => {
        const tipo = formData.get('tipo');
        const cantidad = Number(formData.get('cantidad'));
        if (!cantidad) { toast('Indica la cantidad.', 'aviso'); return; }
        try {
            await Store.ajustarStock(id, {
                tipo: tipo === 'Merma' ? 'Merma' : 'Ajuste',
                cantidad: tipo === 'Ajuste+' ? cantidad : -cantidad,
                fecha: formData.get('fecha'), nota: formData.get('nota'),
            });
            toast(`${tipo === 'Merma' ? 'Merma' : 'Ajuste'} registrado.`);
            refrescar();
            openKardex(id);
        } catch (e) { handleError(e); }
    }, { ancho: '2xl', textoGuardar: 'Registrar' });
}

export const vista = {
    id: 'inventario',
    titulo: 'Inventario',
    subtitulo: 'Insumos, stock y movimientos',
    icono: 'fa-boxes-stacked',
    grupo: 'Administración',
    acciones: [{ texto: 'Nuevo Insumo', icono: 'fa-plus', fn: 'openInsumoModal' }],
    montar,
    render,
    handlers: { openInsumoModal, eliminarInsumo, openKardex },
};

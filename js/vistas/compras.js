/**
 * compras.js — Facturas de proveedor: suman stock y recalculan el costo promedio.
 * Se pueden editar o anular (el stock y el costo se revierten).
 */

import { Store } from '../store.js';
import { esc, fmt, fmtCosto, fmtNum, fmtFecha, hoyISO, folioCompra, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError, combo } from '../ui.js';
import {
    refrescar, paginar, barraPaginacion, buscador, filaVacia, botonIcono, conectarBuscador, etiqueta, claseInput, tarjeta,
} from './comun.js';

let consulta = '';

const detalle = (c) => c.items.map(i => `${fmtNum(i.cantidad)}x ${i.insumo_nombre}`).join(', ');

function montar(el) {
    el.innerHTML = tarjeta(`
        <div class="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">${buscador('buscar-compra', 'Buscar por proveedor o insumo...')}</div>
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                    <tr><th class="px-4 py-3">Compra</th><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Proveedor</th><th class="px-4 py-3">Detalle</th><th class="px-4 py-3 text-right">Total</th><th class="px-4 py-3"></th></tr>
                </thead>
                <tbody id="tbl-compras" class="text-sm divide-y divide-slate-50"></tbody>
            </table>
        </div>
        <div id="paginacion-compras"></div>`);
    conectarBuscador('buscar-compra', v => { consulta = v; }, 'compras');
}

function render() {
    const q = normalizar(consulta.trim());
    const lista = Store.state.compras.filter(c => !q || normalizar(`${folioCompra(c)} ${c.proveedor} ${detalle(c)}`).includes(q))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.folio - a.folio);
    const pag = paginar(lista, 'compras');
    document.getElementById('tbl-compras').innerHTML = pag.items.map(c => `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-mono font-semibold text-slate-600 whitespace-nowrap">${folioCompra(c)}</td>
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${fmtFecha(c.fecha)}</td>
            <td class="px-4 py-3 font-medium text-slate-700">${esc(c.proveedor)}</td>
            <td class="px-4 py-3 text-slate-600 max-w-sm"><div class="truncate" title="${esc(detalle(c))}">${esc(detalle(c))}</div></td>
            <td class="px-4 py-3 text-right font-bold text-slate-700 whitespace-nowrap">${fmt(Store.montoCompra(c))}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.openCompraModal('${c.id}')`, 'fa-solid fa-pen', 'Editar compra')}
                ${botonIcono(`App.eliminarCompra('${c.id}')`, 'fa-solid fa-trash', 'Anular compra', 'hover:text-rose-500')}
            </td>
        </tr>`).join('') || filaVacia(6, consulta ? 'Ninguna compra coincide' : 'Sin compras registradas. Usa "Nueva Compra" cuando entre mercancía.');
    const total = lista.reduce((s, c) => s + Store.montoCompra(c), 0);
    document.getElementById('paginacion-compras').innerHTML = barraPaginacion('compras', pag, pag.total ? `Total ${fmt(total)}` : '');
}

function eliminarCompra(id) {
    const c = Store.state.compras.find(x => x.id === id);
    confirmDialog(`¿Anular la compra <b>${folioCompra(c)}</b> de ${esc(c.proveedor)}?<br><br>Se restará del inventario lo que entró y se revertirá el costo promedio.`, async () => {
        try { await Store.deleteCompra(id); refrescar(); toast(`Compra ${folioCompra(c)} anulada.`); } catch (e) { handleError(e); }
    }, 'Anular compra');
}

function openCompraModal(id) {
    if (typeof id !== 'string') id = undefined;
    if (!Store.state.insumos.length) { toast('Primero crea al menos un insumo en Inventario.', 'aviso'); return; }
    const editando = id ? Store.state.compras.find(c => c.id === id) : null;
    let lineas = editando ? editando.items.map(i => ({ ...i })) : [{ insumo_id: null, cantidad: 1, costo_unitario: '' }];
    const proveedores = [...new Set(Store.state.compras.map(c => c.proveedor))].sort();

    const body = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>${etiqueta('Proveedor')}<input name="proveedor" list="lista-proveedores" required value="${esc(editando?.proveedor)}" class="${claseInput}" placeholder="Ej: ColorMake">
                <datalist id="lista-proveedores">${proveedores.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
            <div>${etiqueta('Fecha')}<input name="fecha" type="date" required value="${editando?.fecha || hoyISO()}" class="${claseInput}"></div>
        </div>
        <div class="pt-2 border-t border-slate-100">
            <div class="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-400 uppercase mb-1 px-1">
                <span class="col-span-5">Insumo</span><span class="col-span-2">Cantidad</span><span class="col-span-3">Costo unit.</span><span class="col-span-2 text-right">Subtotal</span>
            </div>
            <div id="compra-lineas" class="space-y-2"></div>
            <button type="button" id="btn-add-compra" class="mt-2 text-sm text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir insumo</button>
        </div>
        ${editando ? '<p class="text-xs text-slate-500 bg-slate-50 rounded-lg p-2"><i class="fa-solid fa-circle-info mr-1"></i>Al guardar se revierte la compra original y se aplica de nuevo con estos datos (stock y costo promedio).</p>' : ''}
        <div class="flex justify-end items-baseline gap-3 pt-2 border-t border-slate-100">
            <span class="text-sm text-slate-500">Total</span><span id="compra-total" class="text-2xl font-black text-slate-800">${fmt(0)}</span>
        </div>`;

    const { panel } = openModal(editando ? `Editar compra ${folioCompra(editando)}` : 'Nueva compra', body, async (formData) => {
        if (lineas.some(l => !l.insumo_id)) { toast('Hay una línea sin insumo: elígelo o quítala.', 'aviso'); return; }
        const items = lineas.map(l => ({ insumo_id: l.insumo_id, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) }))
            .filter(l => l.cantidad > 0);
        if (!items.length) { toast('Añade al menos un insumo con cantidad.', 'aviso'); return; }
        const datos = { proveedor: formData.get('proveedor'), fecha: formData.get('fecha'), items };
        try {
            if (editando) await Store.updateCompra(editando.id, datos); else await Store.addCompra(datos);
            closeModal();
            refrescar();
            toast(editando ? 'Compra actualizada.' : 'Compra registrada: stock y costos actualizados.');
        } catch (e) { handleError(e); }
    }, { ancho: '2xl', textoGuardar: editando ? 'Guardar cambios' : 'Registrar compra' });

    function actualizar() {
        panel.querySelector('#compra-total').textContent = fmt(lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0));
        lineas.forEach((l, i) => {
            const el = panel.querySelector(`[data-subtotal="${i}"]`);
            if (el) el.textContent = fmt((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0));
        });
    }
    function pintar() {
        const cont = panel.querySelector('#compra-lineas');
        cont.innerHTML = lineas.map((l, i) => `
            <div class="grid grid-cols-12 gap-2 items-center">
                <div class="col-span-5"><input data-insumo="${i}" class="${claseInput}" placeholder="Buscar insumo..."></div>
                <input data-campo="cantidad" data-i="${i}" type="number" step="any" min="0" value="${l.cantidad}" class="col-span-2 ${claseInput}" aria-label="Cantidad">
                <input data-campo="costo_unitario" data-i="${i}" type="number" step="any" min="0" value="${l.costo_unitario}" class="col-span-3 ${claseInput}" aria-label="Costo unitario">
                <div class="col-span-2 flex items-center justify-end gap-1">
                    <span data-subtotal="${i}" class="text-sm font-medium text-slate-700 whitespace-nowrap"></span>
                    <button type="button" data-quitar="${i}" class="text-slate-300 hover:text-rose-500 px-1" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>`).join('');
        lineas.forEach((l, i) => combo(cont.querySelector(`[data-insumo="${i}"]`), {
            items: Store.state.insumos.map(x => ({ id: x.id, label: x.nombre, sub: `Costo actual ${fmtCosto(x.costo_unitario)} / ${x.unidad_medida}` })),
            valor: l.insumo_id,
            onChange: (item) => {
                if (!item) return;
                l.insumo_id = item.id;
                // Se propone el costo actual del insumo; se puede cambiar por el de la factura.
                l.costo_unitario = Store.state.insumos.find(x => x.id === item.id)?.costo_unitario ?? '';
                cont.querySelector(`[data-campo="costo_unitario"][data-i="${i}"]`).value = l.costo_unitario;
                actualizar();
            },
        }));
        cont.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => {
            lineas[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
            actualizar();
        }));
        cont.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
            lineas.splice(Number(btn.dataset.quitar), 1);
            if (!lineas.length) lineas.push({ insumo_id: null, cantidad: 1, costo_unitario: '' });
            pintar();
        }));
        actualizar();
    }
    panel.querySelector('#btn-add-compra').addEventListener('click', () => {
        lineas.push({ insumo_id: null, cantidad: 1, costo_unitario: '' });
        pintar();
        panel.querySelector(`[data-insumo="${lineas.length - 1}"]`)?.focus();
    });
    pintar();
}

export const vista = {
    id: 'compras',
    titulo: 'Compras',
    subtitulo: 'Entrada de mercancía de proveedores',
    icono: 'fa-bag-shopping',
    grupo: 'Administración',
    acciones: [{ texto: 'Nueva Compra', icono: 'fa-plus', fn: 'openCompraModal' }],
    montar,
    render,
    handlers: { openCompraModal, eliminarCompra },
};

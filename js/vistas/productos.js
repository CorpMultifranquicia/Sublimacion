/**
 * productos.js — Catálogo con receta, costo de producción, margen y precio sugerido
 * según el margen objetivo definido en Configuración.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtCosto, fmtNum, fmtPct, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError, combo } from '../ui.js';
import {
    refrescar, paginar, barraPaginacion, buscador, chips, filaVacia, badge, botonIcono,
    conectarBuscador, conectarChips, etiqueta, claseInput, tarjeta,
} from './comun.js';

let consulta = '';
let modo = 'lista';

function badgeMargen(p) {
    const m = Store.margenPct(p);
    const objetivo = Store.margenObjetivo();
    if (!p.receta.length) return badge('Sin receta', 'bg-slate-100 text-slate-500');
    if (m < 0) return badge(`${fmtPct(m)} pérdida`, 'bg-rose-100 text-rose-700');
    if (m < objetivo) return badge(fmtPct(m), 'bg-amber-100 text-amber-700');
    return badge(fmtPct(m), 'bg-emerald-100 text-emerald-700');
}

function filtrados() {
    const q = normalizar(consulta.trim());
    return Store.state.productos.filter(p => !q || normalizar(`${p.nombre} ${p.categoria}`).includes(q));
}

function montar(el) {
    el.innerHTML = `
        <div class="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div id="chips-productos"></div>
            ${buscador('buscar-producto', 'Buscar producto o categoría...')}
        </div>
        <div id="productos-cuerpo"></div>`;
    conectarBuscador('buscar-producto', v => { consulta = v; }, 'productos');
    conectarChips('chips-productos', v => { modo = v; });
}

function render() {
    const objetivo = Store.margenObjetivo();
    document.getElementById('chips-productos').innerHTML = chips('chips-prod-int',
        [['lista', '<i class="fa-solid fa-list mr-1"></i>Lista de precios'], ['recetas', '<i class="fa-solid fa-flask mr-1"></i>Recetas y márgenes']], modo);
    const lista = filtrados();
    const cuerpo = document.getElementById('productos-cuerpo');
    const bajoObjetivo = lista.filter(p => p.receta.length && Store.margenPct(p) < objetivo).length;
    const aviso = bajoObjetivo ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${bajoObjetivo} producto${bajoObjetivo > 1 ? 's están' : ' está'} por debajo del margen objetivo (${objetivo}%). Revisa la columna "Precio sugerido".</div>` : '';

    if (modo === 'lista') {
        const pag = paginar(lista, 'productos');
        cuerpo.innerHTML = aviso + tarjeta(`<div class="overflow-x-auto"><table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                <tr><th class="px-4 py-3">Producto</th><th class="px-4 py-3">Categoría</th><th class="px-4 py-3 text-right">Costo</th>
                    <th class="px-4 py-3 text-right">Precio venta</th><th class="px-4 py-3 text-right" title="Precio que deja el margen objetivo de Configuración">Precio sugerido (${objetivo}%)</th>
                    <th class="px-4 py-3 text-center">Margen</th><th class="px-4 py-3 text-right">Ganancia</th><th class="px-4 py-3"></th></tr>
            </thead>
            <tbody class="text-sm divide-y divide-slate-50">${pag.items.map(p => {
                const costo = Store.costoProduccion(p);
                const sugerido = Store.precioSugerido(costo);
                const ganancia = Store.gananciaNeta(p);
                return `<tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 font-semibold text-slate-800">${esc(p.nombre)}</td>
                    <td class="px-4 py-3 text-slate-500">${esc(p.categoria)}</td>
                    <td class="px-4 py-3 text-right text-rose-600">${fmt(costo)}</td>
                    <td class="px-4 py-3 text-right font-black text-indigo-600">${fmt(p.precio_venta)}</td>
                    <td class="px-4 py-3 text-right ${p.precio_venta < sugerido - 0.005 ? 'text-amber-700 font-semibold' : 'text-slate-400'}">${p.receta.length ? fmt(sugerido) : '—'}</td>
                    <td class="px-4 py-3 text-center">${badgeMargen(p)}</td>
                    <td class="px-4 py-3 text-right font-bold ${ganancia < 0 ? 'text-rose-600' : 'text-emerald-600'}">${fmt(ganancia)}</td>
                    <td class="px-4 py-3 text-right whitespace-nowrap">
                        ${botonIcono(`App.openProductoModal('${p.id}')`, 'fa-solid fa-pen', 'Editar')}
                        ${botonIcono(`App.eliminarProducto('${p.id}')`, 'fa-solid fa-trash', 'Eliminar', 'hover:text-rose-500')}
                    </td>
                </tr>`;
            }).join('') || filaVacia(8, consulta ? 'Ningún producto coincide' : 'Sin productos. Crea primero los insumos en Inventario y luego tus productos aquí.')}</tbody>
        </table></div><div>${barraPaginacion('productos', pag)}</div>`);
        return;
    }

    cuerpo.innerHTML = aviso + (lista.length ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${lista.map(p => {
        const costo = Store.costoProduccion(p);
        return tarjeta(`
            <div class="p-5 border-b border-slate-100 flex justify-between items-start bg-indigo-50/30 rounded-t-2xl">
                <div><h3 class="text-lg font-bold text-slate-800">${esc(p.nombre)}</h3><p class="text-xs text-slate-500">${esc(p.categoria)}</p></div>
                ${botonIcono(`App.openProductoModal('${p.id}')`, 'fa-solid fa-pen', 'Editar')}
            </div>
            <div class="p-5">
                <table class="w-full text-sm mb-4">
                    <thead class="text-[11px] uppercase text-slate-400"><tr><th class="text-left pb-1">Insumo</th><th class="text-right pb-1">Cantidad</th><th class="text-right pb-1">Costo unit.</th><th class="text-right pb-1">Costo</th></tr></thead>
                    <tbody class="text-slate-600">${p.receta.map(item => {
                        const insumo = Store.state.insumos.find(i => i.id === item.insumo_id);
                        return `<tr><td class="py-1">${esc(insumo?.nombre || '—')}${item.merma_pct ? ` <span class="text-xs text-slate-400">+${fmtNum(item.merma_pct)}% merma</span>` : ''}</td>
                            <td class="py-1 text-right">${fmtNum(item.cantidad)} ${esc(insumo?.unidad_medida || '')}</td>
                            <td class="py-1 text-right text-slate-400">${fmtCosto(insumo?.costo_unitario || 0)}</td>
                            <td class="py-1 text-right font-medium">${fmt(Store.costoInsumoEnReceta(item))}</td></tr>`;
                    }).join('') || '<tr><td colspan="4" class="text-slate-400 py-2">Sin insumos definidos</td></tr>'}</tbody>
                </table>
                <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 text-sm">
                    <div class="flex justify-between"><span class="text-slate-500">Costo de producción</span><span class="font-bold text-rose-600">${fmt(costo)}</span></div>
                    <div class="flex justify-between"><span class="text-slate-500">Precio de venta</span><span class="text-lg font-black text-indigo-600">${fmt(p.precio_venta)}</span></div>
                    <div class="flex justify-between"><span class="text-slate-500">Precio sugerido (margen ${Store.margenObjetivo()}%)</span><span class="font-semibold text-slate-700">${fmt(Store.precioSugerido(costo))}</span></div>
                    <div class="flex justify-between items-center pt-2 border-t border-slate-200"><span>${badgeMargen(p)}</span><span class="font-bold ${Store.gananciaNeta(p) < 0 ? 'text-rose-600' : 'text-emerald-600'}">Ganancia ${fmt(Store.gananciaNeta(p))}</span></div>
                </div>
            </div>`);
    }).join('')}</div>` : tarjeta(`<p class="text-slate-400 text-center py-10 text-sm">Sin productos aún</p>`));
}

function eliminarProducto(id) {
    const p = Store.state.productos.find(x => x.id === id);
    const usado = Store.state.ventas.some(v => v.detalle.some(d => d.producto_id === id));
    confirmDialog(`¿Eliminar <b>${esc(p.nombre)}</b> del catálogo?${usado ? '<br><br>Las ventas ya registradas conservan el nombre y el costo del producto.' : ''}`, async () => {
        try { await Store.deleteProducto(id); refrescar(); toast('Producto eliminado.'); } catch (e) { handleError(e); }
    }, 'Eliminar');
}

function openProductoModal(id) {
    if (typeof id !== 'string') id = undefined;
    const editando = id ? Store.state.productos.find(p => p.id === id) : null;
    let receta = editando ? editando.receta.map(r => ({ ...r })) : [];
    const categorias = [...new Set(Store.state.productos.map(p => p.categoria))].sort();

    const body = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>${etiqueta('Nombre del producto')}<input name="nombre" required value="${esc(editando?.nombre)}" class="${claseInput}" placeholder="Ej: Taza 11oz personalizada"></div>
            <div>${etiqueta('Categoría')}<input name="categoria" list="lista-categorias" required value="${esc(editando?.categoria)}" class="${claseInput}" placeholder="Tazas, Textil, Gorras...">
                <datalist id="lista-categorias">${categorias.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        </div>
        <div class="pt-2 border-t border-slate-100">
            <div class="flex justify-between items-center mb-2">
                ${etiqueta('Receta (insumos por unidad)')}
                <button type="button" id="btn-add-receta" class="text-sm text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir insumo</button>
            </div>
            <div class="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-400 uppercase mb-1 px-1">
                <span class="col-span-6">Insumo</span><span class="col-span-3">Cantidad</span><span class="col-span-2">% Merma</span>
            </div>
            <div id="receta-rows" class="space-y-2"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div>${etiqueta('Precio de venta')}<input name="precio_venta" type="number" step="0.01" min="0" required value="${editando?.precio_venta ?? ''}" class="${claseInput}"></div>
            <div class="text-sm space-y-1">
                <p class="flex justify-between"><span class="text-slate-500">Costo:</span><span id="costo-preview" class="font-bold text-rose-600"></span></p>
                <p class="flex justify-between"><span class="text-slate-500">Margen:</span><span id="margen-preview" class="font-bold"></span></p>
                <p class="flex justify-between items-center"><span class="text-slate-500">Sugerido (${Store.margenObjetivo()}%):</span>
                    <span><span id="sugerido-preview" class="font-semibold text-slate-700"></span> <button type="button" id="usar-sugerido" class="ml-1 text-xs text-indigo-600 hover:underline">Usar</button></span></p>
            </div>
        </div>`;

    const { panel } = openModal(editando ? 'Editar producto' : 'Nuevo producto', body, async (formData) => {
        if (receta.some(r => !r.insumo_id)) { toast('Hay una línea de receta sin insumo: elígelo o quítala.', 'aviso'); return; }
        const data = {
            nombre: formData.get('nombre'),
            categoria: formData.get('categoria'),
            precio_venta: Number(formData.get('precio_venta')),
            receta: receta.filter(r => Number(r.cantidad) > 0).map(r => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad), merma_pct: Number(r.merma_pct) || 0 })),
        };
        try {
            if (editando) await Store.updateProducto(editando.id, data); else await Store.addProducto(data);
            closeModal();
            refrescar();
            toast(`Producto "${data.nombre}" guardado.`);
        } catch (e) { handleError(e); }
    }, { ancho: '2xl' });

    const precioInput = panel.querySelector('[name=precio_venta]');
    const costoActual = () => receta.reduce((s, r) => s + Store.costoInsumoEnReceta({ ...r, cantidad: Number(r.cantidad) || 0, merma_pct: Number(r.merma_pct) || 0 }), 0);

    function actualizar() {
        const costo = costoActual();
        const precio = Number(precioInput.value) || 0;
        const margen = precio ? (precio - costo) / precio * 100 : 0;
        panel.querySelector('#costo-preview').textContent = fmt(costo);
        const m = panel.querySelector('#margen-preview');
        m.textContent = precio ? `${fmtPct(margen)} (${fmt(precio - costo)})` : '—';
        m.className = `font-bold ${margen < 0 ? 'text-rose-600' : margen < Store.margenObjetivo() ? 'text-amber-600' : 'text-emerald-600'}`;
        panel.querySelector('#sugerido-preview').textContent = fmt(Store.precioSugerido(costo));
    }

    function pintar() {
        const cont = panel.querySelector('#receta-rows');
        cont.innerHTML = receta.map((r, i) => {
            const insumo = Store.state.insumos.find(x => x.id === r.insumo_id);
            return `<div class="grid grid-cols-12 gap-2 items-center">
                <div class="col-span-6"><input data-insumo="${i}" class="${claseInput}" placeholder="Buscar insumo..."></div>
                <div class="col-span-3 relative"><input data-campo="cantidad" data-i="${i}" type="number" step="any" min="0" value="${r.cantidad}" class="${claseInput} pr-12" aria-label="Cantidad">
                    <span data-unidad="${i}" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">${esc(insumo?.unidad_medida || '')}</span></div>
                <input data-campo="merma_pct" data-i="${i}" type="number" step="any" min="0" value="${r.merma_pct || 0}" class="col-span-2 ${claseInput}" aria-label="% merma">
                <button type="button" data-quitar="${i}" class="col-span-1 text-slate-300 hover:text-rose-500" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        }).join('') || '<p class="text-sm text-slate-400">Sin insumos. Añade los materiales que usa una unidad de este producto.</p>';
        receta.forEach((r, i) => combo(cont.querySelector(`[data-insumo="${i}"]`), {
            items: Store.state.insumos.map(x => ({ id: x.id, label: x.nombre, sub: `${fmtCosto(x.costo_unitario)} / ${x.unidad_medida}` })),
            valor: r.insumo_id,
            onChange: (item) => {
                if (!item) return;
                r.insumo_id = item.id;
                cont.querySelector(`[data-unidad="${i}"]`).textContent = Store.state.insumos.find(x => x.id === item.id)?.unidad_medida || '';
                actualizar();
            },
        }));
        cont.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => {
            receta[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
            actualizar();
        }));
        cont.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
            receta.splice(Number(btn.dataset.quitar), 1);
            pintar();
        }));
        actualizar();
    }

    panel.querySelector('#btn-add-receta').addEventListener('click', () => {
        if (!Store.state.insumos.length) { toast('Primero crea insumos en Inventario.', 'aviso'); return; }
        receta.push({ insumo_id: null, cantidad: 1, merma_pct: 0 });
        pintar();
        panel.querySelector(`[data-insumo="${receta.length - 1}"]`)?.focus();
    });
    panel.querySelector('#usar-sugerido').addEventListener('click', () => {
        precioInput.value = Store.precioSugerido(costoActual()).toFixed(2);
        actualizar();
    });
    precioInput.addEventListener('input', actualizar);
    pintar();
}

export const vista = {
    id: 'productos',
    titulo: 'Prod. y Precios',
    subtitulo: 'Catálogo, recetas y márgenes',
    icono: 'fa-tags',
    grupo: 'Catálogo',
    acciones: [{ texto: 'Nuevo Producto', icono: 'fa-tag', fn: 'openProductoModal' }],
    montar,
    render,
    handlers: { openProductoModal, eliminarProducto },
};

/**
 * cotizaciones.js — Cotizaciones guardadas con folio (COT-0001), vencimiento,
 * PDF, envío por WhatsApp y conversión a venta con un clic.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtNum, fmtFecha, hoyISO, folioCotizacion, folioVenta, abrirWhatsApp, normalizar, diasEntre } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError, combo } from '../ui.js';
import { generarCotizacionPDF } from '../pdf.js';
import { openVentaModal } from './ventas.js';
import {
    refrescar, paginar, barraPaginacion, buscador, chips, filaVacia, badge, botonIcono,
    conectarBuscador, conectarChips, etiqueta, claseInput, tarjeta,
} from './comun.js';

let consulta = '';
let filtro = 'pendientes';

const detalle = (c) => c.items.map(i => `${fmtNum(i.cantidad)}x ${i.producto_nombre}`).join(', ');

function estadoCotizacion(c) {
    if (c.estado === 'Convertida') {
        const v = Store.state.ventas.find(x => x.id === c.venta_id);
        return badge(`<i class="fa-solid fa-check mr-1"></i>Venta ${v ? folioVenta(v) : ''}`, 'bg-emerald-100 text-emerald-700');
    }
    const dias = diasEntre(hoyISO(), Store.venceCotizacion(c));
    if (dias < 0) return badge('Vencida', 'bg-slate-100 text-slate-500');
    if (dias <= 2) return badge(`Vence en ${dias === 0 ? 'hoy' : dias + ' día' + (dias > 1 ? 's' : '')}`, 'bg-amber-100 text-amber-700');
    return badge('Pendiente', 'bg-blue-100 text-blue-700');
}

function filtrar() {
    const q = normalizar(consulta.trim());
    return Store.state.cotizaciones.filter(c => {
        if (filtro === 'pendientes' && c.estado !== 'Pendiente') return false;
        if (filtro === 'convertidas' && c.estado !== 'Convertida') return false;
        return !q || normalizar(`${folioCotizacion(c)} ${c.cliente_nombre} ${detalle(c)}`).includes(q);
    }).sort((a, b) => b.folio - a.folio);
}

function montar(el) {
    el.innerHTML = tarjeta(`
        <div class="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between rounded-t-2xl">
            ${buscador('buscar-cotizacion', 'Buscar por folio, cliente o producto...')}
            <div id="chips-cotizaciones"></div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                    <tr><th class="px-4 py-3">Cotización</th><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Cliente</th><th class="px-4 py-3">Detalle</th>
                        <th class="px-4 py-3 text-right">Total</th><th class="px-4 py-3 whitespace-nowrap">Válida hasta</th><th class="px-4 py-3">Estado</th><th class="px-4 py-3"></th></tr>
                </thead>
                <tbody id="tbl-cotizaciones" class="text-sm divide-y divide-slate-50"></tbody>
            </table>
        </div>
        <div id="paginacion-cotizaciones"></div>`);
    conectarBuscador('buscar-cotizacion', v => { consulta = v; }, 'cotizaciones');
    conectarChips('chips-cotizaciones', v => { filtro = v; }, 'cotizaciones');
}

function render() {
    document.getElementById('chips-cotizaciones').innerHTML = chips('chips-cot-int',
        [['pendientes', 'Pendientes'], ['convertidas', 'Convertidas'], ['todas', 'Todas']], filtro);
    const pag = paginar(filtrar(), 'cotizaciones');
    document.getElementById('tbl-cotizaciones').innerHTML = pag.items.map(c => {
        const tel = Store.state.clientes.find(x => x.id === c.cliente_id)?.telefono;
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-mono font-semibold text-violet-600 whitespace-nowrap">${folioCotizacion(c)}</td>
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${fmtFecha(c.fecha)}</td>
            <td class="px-4 py-3 font-medium text-slate-700 min-w-[8rem]">${esc(c.cliente_nombre || '—')}</td>
            <td class="px-4 py-3 text-slate-600 max-w-[14rem]"><div class="truncate" title="${esc(detalle(c))}">${esc(detalle(c))}</div></td>
            <td class="px-4 py-3 text-right font-bold text-slate-700 whitespace-nowrap">${fmt(Store.montoCotizacion(c))}</td>
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${fmtFecha(Store.venceCotizacion(c))}</td>
            <td class="px-4 py-3">${estadoCotizacion(c)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.descargarCotizacion('${c.id}')`, 'fa-solid fa-file-pdf', 'Descargar PDF')}
                ${tel ? botonIcono(`App.enviarCotizacionWhatsApp('${c.id}')`, 'fa-brands fa-whatsapp', 'Enviar resumen por WhatsApp', 'hover:text-emerald-600') : ''}
                ${c.estado === 'Pendiente' ? botonIcono(`App.convertirCotizacion('${c.id}')`, 'fa-solid fa-cart-arrow-down', 'Convertir en venta', 'hover:text-emerald-600') : ''}
                ${c.estado === 'Pendiente' ? botonIcono(`App.openCotizacionModal('${c.id}')`, 'fa-solid fa-pen', 'Editar') : ''}
                ${botonIcono(`App.openCotizacionModal('${c.id}', true)`, 'fa-regular fa-copy', 'Duplicar')}
                ${botonIcono(`App.eliminarCotizacion('${c.id}')`, 'fa-solid fa-trash', 'Eliminar', 'hover:text-rose-500')}
            </td>
        </tr>`;
    }).join('') || filaVacia(8, consulta ? 'Ninguna cotización coincide' : 'Sin cotizaciones. Usa "Nueva Cotización" para crear una.');
    document.getElementById('paginacion-cotizaciones').innerHTML = barraPaginacion('cotizaciones', pag);
}

function descargarCotizacion(id) {
    const c = Store.state.cotizaciones.find(x => x.id === id);
    if (c) generarCotizacionPDF(c).catch(handleError);
}

function enviarCotizacionWhatsApp(id) {
    const c = Store.state.cotizaciones.find(x => x.id === id);
    const tel = Store.state.clientes.find(x => x.id === c.cliente_id)?.telefono;
    const negocio = Store.state.config.negocio_nombre || '';
    const lineas = c.items.map(i => `• ${fmtNum(i.cantidad)} x ${i.producto_nombre}: ${fmt(i.cantidad * i.precio_unitario)}`).join('\n');
    abrirWhatsApp(tel, `Hola ${c.cliente_nombre}, te enviamos la cotización ${folioCotizacion(c)}:\n${lineas}\n*Total: ${fmt(Store.montoCotizacion(c))}*\nVálida hasta el ${fmtFecha(Store.venceCotizacion(c))}.${negocio ? `\n\n${negocio}` : ''}`);
    toast('Adjunta también el PDF de la cotización en el chat si lo necesitas.', 'info');
}

function convertirCotizacion(id) {
    const c = Store.state.cotizaciones.find(x => x.id === id);
    const sinCatalogo = c.items.filter(i => !i.producto_id || !Store.state.productos.some(p => p.id === i.producto_id));
    if (sinCatalogo.length) toast(`Elige un producto del catálogo para: ${sinCatalogo.map(i => i.producto_nombre).join(', ')} (se necesita su receta para descontar stock).`, 'aviso');
    openVentaModal(undefined, {
        cliente_id: c.cliente_id || undefined,
        cliente_nombre: c.cliente_id ? undefined : c.cliente_nombre, // prospecto: se propone crearlo
        cotizacion_id: c.id,
        notas: c.notas,
        items: c.items.map(i => ({
            producto_id: Store.state.productos.some(p => p.id === i.producto_id) ? i.producto_id : null,
            nombre: i.producto_nombre, cantidad: i.cantidad, precio_unitario: i.precio_unitario, desdeCotizacion: true,
        })),
    });
}

function eliminarCotizacion(id) {
    const c = Store.state.cotizaciones.find(x => x.id === id);
    confirmDialog(`¿Eliminar la cotización <b>${folioCotizacion(c)}</b>?`, async () => {
        try { await Store.deleteCotizacion(id); refrescar(); toast('Cotización eliminada.'); } catch (e) { handleError(e); }
    }, 'Eliminar');
}

// ---------------- Modal ----------------

function openCotizacionModal(id, duplicar = false) {
    if (typeof id !== 'string') id = undefined;
    const original = id ? Store.state.cotizaciones.find(c => c.id === id) : null;
    const editando = original && !duplicar ? original : null;
    const cfg = Store.state.config;
    let lineas = original ? original.items.map(i => ({ ...i })) : [{ producto_id: null, producto_nombre: '', cantidad: 1, precio_unitario: 0 }];

    const body = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>${etiqueta('Cliente o prospecto')}<input id="cot-cliente" class="${claseInput}" placeholder="Buscar o escribir nombre..."></div>
            <div>${etiqueta('Fecha')}<input name="fecha" type="date" required value="${editando?.fecha || hoyISO()}" class="${claseInput}"></div>
            <div>${etiqueta('Validez (días)')}<input name="validez_dias" type="number" min="1" required value="${original?.validez_dias || cfg.cotizacion_validez_dias || 15}" class="${claseInput}"></div>
        </div>
        <div class="pt-2 border-t border-slate-100">
            <div class="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-400 uppercase mb-1 px-1">
                <span class="col-span-6">Producto o descripción</span><span class="col-span-2">Cant.</span><span class="col-span-2">Precio</span><span class="col-span-2 text-right">Subtotal</span>
            </div>
            <div id="cot-lineas" class="space-y-2"></div>
            <button type="button" id="btn-add-cot" class="mt-2 text-sm text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir línea</button>
            <p class="text-xs text-slate-400 mt-1">Puedes escribir un producto que no está en el catálogo (p. ej. un pedido especial).</p>
        </div>
        <div>${etiqueta('Notas para el cliente')}<textarea name="notas" rows="2" class="${claseInput}" placeholder="Tiempo de entrega, detalles del diseño...">${esc(original?.notas || '')}</textarea>
            <p class="text-xs text-slate-400 mt-1">Las condiciones generales se toman de Configuración.</p></div>
        <div class="flex justify-end items-baseline gap-3 pt-2 border-t border-slate-100">
            <span class="text-sm text-slate-500">Total</span><span id="cot-total" class="text-2xl font-black text-violet-600">${fmt(0)}</span>
        </div>`;

    const { panel } = openModal(editando ? `Editar ${folioCotizacion(editando)}` : 'Nueva cotización', body, async (formData) => {
        const cliente = selCliente.get();
        const items = lineas.filter(l => (l.producto_id || l.producto_nombre.trim()) && Number(l.cantidad) > 0)
            .map(l => ({ producto_id: l.producto_id, producto_nombre: l.producto_nombre, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario) }));
        if (!items.length) { toast('Añade al menos un producto.', 'aviso'); return; }
        const datos = {
            cliente_id: cliente?.id || null, cliente_nombre: cliente?.label || '',
            fecha: formData.get('fecha'), validez_dias: Number(formData.get('validez_dias')), notas: formData.get('notas'), items,
        };
        try {
            let cot;
            if (editando) {
                await Store.updateCotizacion(editando.id, datos);
                cot = Store.state.cotizaciones.find(c => c.id === editando.id);
            } else {
                const { id: nuevoId } = await Store.addCotizacion(datos);
                cot = Store.state.cotizaciones.find(c => c.id === nuevoId);
            }
            closeModal();
            refrescar();
            toast(`Cotización ${folioCotizacion(cot)} guardada.`);
            await generarCotizacionPDF(cot);
        } catch (e) { handleError(e); }
    }, { ancho: '2xl', textoGuardar: '<i class="fa-solid fa-file-pdf mr-1"></i>Guardar y descargar PDF' });

    const selCliente = combo(panel.querySelector('#cot-cliente'), {
        items: Store.state.clientes.map(c => ({ id: c.id, label: c.nombre, sub: c.telefono || '' })),
        valor: original?.cliente_id,
        permitirTexto: true,
        textoInicial: original?.cliente_nombre,
    });

    const total = () => lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);
    function actualizar() {
        panel.querySelector('#cot-total').textContent = fmt(total());
        lineas.forEach((l, i) => {
            const el = panel.querySelector(`[data-subtotal="${i}"]`);
            if (el) el.textContent = fmt((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0));
        });
    }
    function pintar() {
        const cont = panel.querySelector('#cot-lineas');
        cont.innerHTML = lineas.map((l, i) => `
            <div class="grid grid-cols-12 gap-2 items-center">
                <div class="col-span-6"><input data-producto="${i}" class="${claseInput}" placeholder="Producto o descripción..."></div>
                <input data-campo="cantidad" data-i="${i}" type="number" min="0" step="any" value="${l.cantidad}" class="col-span-2 ${claseInput}" aria-label="Cantidad">
                <input data-campo="precio_unitario" data-i="${i}" type="number" min="0" step="0.01" value="${l.precio_unitario}" class="col-span-2 ${claseInput}" aria-label="Precio">
                <div class="col-span-2 flex items-center justify-end gap-1">
                    <span data-subtotal="${i}" class="text-sm font-medium text-slate-700 whitespace-nowrap"></span>
                    <button type="button" data-quitar="${i}" class="text-slate-300 hover:text-rose-500 px-1" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>`).join('');
        lineas.forEach((l, i) => {
            combo(cont.querySelector(`[data-producto="${i}"]`), {
                items: Store.state.productos.map(p => ({ id: p.id, label: p.nombre, sub: fmt(p.precio_venta) })),
                valor: l.producto_id,
                permitirTexto: true,
                textoInicial: l.producto_nombre,
                onChange: (item) => {
                    if (!item) { // texto libre
                        l.producto_id = null;
                        l.producto_nombre = cont.querySelector(`[data-producto="${i}"]`).value;
                        return;
                    }
                    l.producto_id = item.id;
                    l.producto_nombre = item.label;
                    l.precio_unitario = Store.state.productos.find(p => p.id === item.id)?.precio_venta ?? l.precio_unitario;
                    cont.querySelector(`[data-campo="precio_unitario"][data-i="${i}"]`).value = l.precio_unitario;
                    actualizar();
                },
            });
        });
        cont.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => {
            lineas[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
            actualizar();
        }));
        cont.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
            lineas.splice(Number(btn.dataset.quitar), 1);
            if (!lineas.length) lineas.push({ producto_id: null, producto_nombre: '', cantidad: 1, precio_unitario: 0 });
            pintar();
        }));
        actualizar();
    }
    panel.querySelector('#btn-add-cot').addEventListener('click', () => {
        lineas.push({ producto_id: null, producto_nombre: '', cantidad: 1, precio_unitario: 0 });
        pintar();
        panel.querySelector(`[data-producto="${lineas.length - 1}"]`)?.focus();
    });
    pintar();
}

export const vista = {
    id: 'cotizaciones',
    titulo: 'Cotizaciones',
    subtitulo: 'Presupuestos para clientes y prospectos',
    icono: 'fa-file-invoice',
    grupo: 'Principal',
    acciones: [{ texto: 'Nueva Cotización', icono: 'fa-file-circle-plus', fn: 'openCotizacionModal' }],
    montar,
    render,
    handlers: { openCotizacionModal, descargarCotizacion, enviarCotizacionWhatsApp, convertirCotizacion, eliminarCotizacion },
};

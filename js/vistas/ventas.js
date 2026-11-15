/**
 * ventas.js — Lista de ventas, alta/edición, abonos, adjuntos y mensajes de WhatsApp.
 * Otras vistas (Producción, Clientes, Cotizaciones, Inicio) reutilizan los modales de aquí.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtNum, fmtFecha, hoyISO, folioVenta, abrirWhatsApp, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError, combo } from '../ui.js';
import { generarReciboPDF } from '../pdf.js';
import {
    refrescar, paginar, barraPaginacion, buscador, chips, filaVacia, badge, botonIcono, ESTADO_BADGE,
    conectarBuscador, conectarChips, etiqueta, claseInput, tarjeta,
} from './comun.js';

let consulta = '';
let filtro = 'todas';

// ---------------- Textos de apoyo ----------------

export function detalleTexto(venta) {
    return venta.detalle.map(d => `${fmtNum(d.cantidad)}x ${d.producto_nombre}`).join(', ');
}

export function badgeSaldo(v) {
    const saldo = Store.saldoVenta(v);
    if (saldo <= 0) return badge('<i class="fa-solid fa-check mr-1"></i>Pagado', 'bg-emerald-50 text-emerald-700');
    return badge(`Debe ${fmt(saldo)}`, Store.pagadoVenta(v) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700');
}

/** Insignia de fecha de entrega: atrasado (rojo), hoy/mañana (ámbar), futura (gris). */
export function badgeEntrega(v) {
    if (!v.fecha_entrega) return '<span class="text-slate-300 text-xs">—</span>';
    if (v.estado === 'Entregado') return `<span class="text-xs text-slate-400">${fmtFecha(v.fecha_entrega)}</span>`;
    const atraso = Store.diasAtraso(v);
    if (atraso > 0 && v.estado !== 'Listo') return badge(`<i class="fa-solid fa-clock mr-1"></i>Atrasado ${atraso} día${atraso > 1 ? 's' : ''}`, 'bg-rose-100 text-rose-700');
    if (atraso === 0) return badge('Entrega hoy', 'bg-amber-100 text-amber-700');
    if (atraso === -1) return badge('Entrega mañana', 'bg-amber-50 text-amber-700');
    return `<span class="text-xs text-slate-500">${fmtFecha(v.fecha_entrega)}</span>`;
}

/** Mensaje de WhatsApp según el estado del pedido. */
export function mensajeEstado(venta) {
    const cliente = Store.state.clientes.find(c => c.id === venta.cliente_id);
    const negocio = Store.state.config.negocio_nombre || '';
    const saldo = Store.saldoVenta(venta);
    const pedido = `#${folioVenta(venta)} (${detalleTexto(venta)})`;
    const saludo = `Hola ${cliente?.nombre || ''}`.trim();
    const textos = {
        'Por Diseñar': `${saludo}, recibimos tu pedido ${pedido}. Ya estamos trabajando en el diseño.`,
        'Imprimiendo': `${saludo}, tu pedido ${pedido} ya está en producción.`,
        'Listo': `${saludo}, ¡tu pedido ${pedido} está listo para retirar!`,
        'Entregado': `${saludo}, gracias por tu compra ${pedido}. ¡Esperamos que lo disfrutes!`,
    };
    let msg = textos[venta.estado] || `${saludo}, tu pedido ${pedido} está en estado: ${venta.estado}.`;
    msg += `\nTotal: ${fmt(Store.montoVenta(venta))}`;
    if (Store.pagadoVenta(venta) > 0) msg += ` · Abonado: ${fmt(Store.pagadoVenta(venta))}`;
    if (saldo > 0 && venta.estado !== 'Entregado') msg += `\nSaldo pendiente: *${fmt(saldo)}*`;
    if (negocio) msg += `\n\n${negocio}`;
    return msg;
}

function enviarEstadoWhatsApp(id) {
    const venta = Store.state.ventas.find(v => v.id === id);
    const cliente = Store.state.clientes.find(c => c.id === venta?.cliente_id);
    if (!cliente?.telefono) { toast('Este cliente no tiene teléfono registrado.', 'aviso'); return; }
    abrirWhatsApp(cliente.telefono, mensajeEstado(venta));
}

function descargarRecibo(id) {
    const venta = Store.state.ventas.find(v => v.id === id);
    if (venta) generarReciboPDF(venta).catch(handleError);
}

// ---------------- Lista ----------------

function filtrar() {
    const q = normalizar(consulta.trim());
    return Store.state.ventas.filter(v => {
        if (filtro === 'saldo' && Store.saldoVenta(v) <= 0) return false;
        if (filtro === 'pendientes' && v.estado === 'Entregado') return false;
        if (!q) return true;
        return normalizar(`${folioVenta(v)} ${Store.nombreClienteVenta(v)} ${detalleTexto(v)} ${v.notas}`).includes(q);
    }).sort((a, b) => b.folio - a.folio);
}

function montar(el) {
    el.innerHTML = tarjeta(`
        <div class="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between rounded-t-2xl">
            ${buscador('buscar-venta', 'Buscar por folio, cliente o producto...')}
            <div id="chips-ventas"></div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                    <tr><th class="px-4 py-3">Venta</th><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Cliente</th>
                        <th class="px-4 py-3">Detalle</th><th class="px-4 py-3">Entrega</th><th class="px-4 py-3">Estado</th>
                        <th class="px-4 py-3 text-right">Total</th><th class="px-4 py-3">Pago</th><th class="px-4 py-3"></th></tr>
                </thead>
                <tbody id="tbl-ventas" class="text-sm divide-y divide-slate-50"></tbody>
            </table>
        </div>
        <div id="paginacion-ventas"></div>`);
    conectarBuscador('buscar-venta', v => { consulta = v; }, 'ventas');
    conectarChips('chips-ventas', v => { filtro = v; }, 'ventas');
}

function render() {
    const conSaldo = Store.state.ventas.filter(v => Store.saldoVenta(v) > 0).length;
    const pendientes = Store.state.ventas.filter(v => v.estado !== 'Entregado').length;
    document.getElementById('chips-ventas').innerHTML = chips('chips-ventas-int', [
        ['todas', 'Todas'], ['saldo', `Con saldo (${conSaldo})`], ['pendientes', `Sin entregar (${pendientes})`],
    ], filtro);

    const pag = paginar(filtrar(), 'ventas');
    document.getElementById('tbl-ventas').innerHTML = pag.items.map(v => {
        const cliente = Store.state.clientes.find(c => c.id === v.cliente_id);
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-mono font-semibold text-indigo-600 whitespace-nowrap">${folioVenta(v)}</td>
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${fmtFecha(v.fecha)}</td>
            <td class="px-4 py-3 font-medium text-slate-700 min-w-[8rem]">${esc(Store.nombreClienteVenta(v))}</td>
            <td class="px-4 py-3 text-slate-600 max-w-[15rem]"><div class="truncate" title="${esc(detalleTexto(v))}">${esc(detalleTexto(v))}</div>${v.notas ? `<div class="text-xs text-slate-400 truncate" title="${esc(v.notas)}"><i class="fa-regular fa-note-sticky mr-1"></i>${esc(v.notas)}</div>` : ''}</td>
            <td class="px-4 py-3 whitespace-nowrap">${badgeEntrega(v)}</td>
            <td class="px-4 py-3">
                <select onchange="App.cambiarEstadoVenta('${v.id}', this.value)" aria-label="Estado" class="text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${ESTADO_BADGE[v.estado]}">
                    ${Store.ESTADOS_PRODUCCION.map(e => `<option value="${e}" ${e === v.estado ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
            </td>
            <td class="px-4 py-3 text-right font-bold text-slate-700 whitespace-nowrap">${fmt(Store.montoVenta(v))}</td>
            <td class="px-4 py-3 whitespace-nowrap"><button onclick="App.openPagosModal('${v.id}')" title="Ver y registrar abonos">${badgeSaldo(v)}</button></td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.descargarRecibo('${v.id}')`, 'fa-solid fa-file-pdf', 'Descargar recibo PDF')}
                ${cliente?.telefono ? botonIcono(`App.enviarEstadoWhatsApp('${v.id}')`, 'fa-brands fa-whatsapp', 'Enviar estado por WhatsApp', 'hover:text-emerald-600') : ''}
                ${botonIcono(`App.openVentaModal('${v.id}')`, 'fa-solid fa-pen', 'Editar venta')}
                ${botonIcono(`App.eliminarVenta('${v.id}')`, 'fa-solid fa-trash', 'Anular venta', 'hover:text-rose-500')}
            </td>
        </tr>`;
    }).join('') || filaVacia(9, consulta || filtro !== 'todas' ? 'Ninguna venta coincide con el filtro' : 'Sin ventas registradas. Usa "Nueva Venta" para empezar.');
    const totalFiltrado = filtrar().reduce((s, v) => s + Store.montoVenta(v), 0);
    document.getElementById('paginacion-ventas').innerHTML = barraPaginacion('ventas', pag, pag.total ? `Total ${fmt(totalFiltrado)}` : '');
}

async function cambiarEstadoVenta(id, estado) {
    try {
        await Store.updateEstadoVenta(id, estado);
        refrescar();
        const venta = Store.state.ventas.find(v => v.id === id);
        const tel = Store.state.clientes.find(c => c.id === venta?.cliente_id)?.telefono;
        toast(`${folioVenta(venta)} → ${estado}${tel && estado === 'Listo' ? '. Puedes avisar al cliente por WhatsApp.' : ''}`);
    } catch (e) { handleError(e); }
}

function eliminarVenta(id) {
    const v = Store.state.ventas.find(x => x.id === id);
    const abonado = Store.pagadoVenta(v);
    confirmDialog(`¿Anular la venta <b>${folioVenta(v)}</b>?<br><br>Los insumos que descontó vuelven al inventario${abonado > 0 ? ` y se eliminan sus abonos (${fmt(abonado)})` : ''}. Esta acción no se puede deshacer.`, async () => {
        try { await Store.deleteVenta(id); refrescar(); toast(`Venta ${folioVenta(v)} anulada; el stock fue devuelto.`); } catch (e) { handleError(e); }
    }, 'Anular venta');
}

// ---------------- Modal de venta (nueva / editar / desde cotización) ----------------

const itemsClientes = () => [
    { id: '', label: 'Mostrador (sin cliente)', sub: 'Venta rápida sin registrar cliente' },
    ...Store.state.clientes.map(c => ({ id: c.id, label: c.nombre, sub: c.telefono || '' })),
];
const itemsProductos = () => Store.state.productos.map(p => ({ id: p.id, label: p.nombre, sub: `${p.categoria} · ${fmt(p.precio_venta)}` }));

/**
 * @param {string} [id]  venta a editar
 * @param {{cliente_id?, items?, cotizacion_id?, notas?}} [prefill]  datos iniciales (p. ej. desde una cotización)
 */
export function openVentaModal(id, prefill = {}) {
    if (typeof id !== 'string') id = undefined;
    if (Store.state.productos.length === 0) { toast('Primero crea al menos un producto en "Prod. y Precios".', 'aviso'); return; }
    const editando = id ? Store.state.ventas.find(v => v.id === id) : null;
    let lineas = editando
        ? editando.detalle.map(d => ({ producto_id: d.producto_id, nombre: d.producto_nombre, cantidad: d.cantidad, precio_unitario: d.precio_unitario }))
        : (prefill.items || []).map(i => ({ ...i }));
    if (!lineas.length) lineas.push({ producto_id: null, cantidad: 1, precio_unitario: 0 });

    const body = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-1">${etiqueta('Cliente')}<input id="venta-cliente" class="${claseInput}" placeholder="Buscar o crear cliente..."></div>
            <div>${etiqueta('Fecha de venta')}<input name="fecha" type="date" required value="${editando?.fecha || hoyISO()}" class="${claseInput}"></div>
            <div>${etiqueta('Fecha de entrega')}<input name="fecha_entrega" type="date" value="${editando?.fecha_entrega || ''}" class="${claseInput}"></div>
        </div>
        <div class="pt-2 border-t border-slate-100">
            <div class="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-400 uppercase mb-1 px-1">
                <span class="col-span-6">Producto</span><span class="col-span-2">Cant.</span><span class="col-span-2">Precio</span><span class="col-span-2 text-right">Subtotal</span>
            </div>
            <div id="venta-lineas" class="space-y-2"></div>
            <button type="button" id="btn-add-linea" class="mt-2 text-sm text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir producto</button>
            <div id="venta-stock" class="mt-3"></div>
        </div>
        <div>${etiqueta('Notas del pedido')}<textarea name="notas" rows="2" class="${claseInput}" placeholder="Colores, tallas, texto a imprimir...">${esc(editando?.notas ?? prefill.notas ?? '')}</textarea></div>
        ${editando ? '' : `
        <div class="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
            <p class="text-xs font-bold text-emerald-700 uppercase mb-2"><i class="fa-solid fa-hand-holding-dollar mr-1"></i>Abono inicial (opcional)</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div><label class="block text-xs text-slate-500 mb-1">Monto</label><input name="abono_monto" type="number" step="0.01" min="0" class="${claseInput}" placeholder="0,00"></div>
                <div><label class="block text-xs text-slate-500 mb-1">Método</label><select name="abono_metodo" class="${claseInput}">${Store.METODOS_PAGO.map(m => `<option>${m}</option>`).join('')}</select></div>
                <div class="flex gap-2"><button type="button" data-abono="0.5" class="flex-1 px-2 py-2 text-xs rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-100">50%</button><button type="button" data-abono="1" class="flex-1 px-2 py-2 text-xs rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-100">Total</button></div>
            </div>
        </div>`}
        <div class="flex justify-end items-baseline gap-3 pt-2 border-t border-slate-100">
            <span class="text-sm text-slate-500">Total</span><span id="venta-total" class="text-2xl font-black text-indigo-600">${fmt(0)}</span>
        </div>`;

    const { panel } = openModal(editando ? `Editar venta ${folioVenta(editando)}` : (prefill.cotizacion_id ? 'Convertir cotización en venta' : 'Nueva venta'), body, async (formData) => {
        let cliente = selCliente.get();
        const textoCliente = panel.querySelector('#venta-cliente').value.trim();
        if (!cliente && textoCliente) {
            // Escribió un nombre que no está en la lista: se registra como cliente nuevo.
            try {
                await Store.addCliente({ nombre: textoCliente });
                const nuevo = Store.state.clientes.find(c => c.nombre === textoCliente);
                cliente = { id: nuevo.id, label: nuevo.nombre };
                toast(`Cliente "${textoCliente}" creado.`, 'info');
            } catch (e) { handleError(e); return; }
        }
        if (!cliente) { toast('Elige un cliente o "Mostrador".', 'aviso'); return; }
        if (lineas.some(l => !l.producto_id)) { toast('Hay una línea sin producto: elígelo de la lista o quítala.', 'aviso'); return; }
        const detalle = lineas.map(l => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario) }))
            .filter(l => l.cantidad > 0);
        if (!detalle.length) { toast('Añade al menos un producto con cantidad mayor a cero.', 'aviso'); return; }
        const datos = {
            cliente_id: cliente.id || null,
            fecha: formData.get('fecha'),
            fecha_entrega: formData.get('fecha_entrega') || null,
            notas: formData.get('notas'),
            detalle,
        };
        if (formData.get('fecha_entrega') && formData.get('fecha_entrega') < formData.get('fecha')) {
            toast('La fecha de entrega es anterior a la fecha de venta.', 'aviso'); return;
        }
        try {
            if (editando) {
                await Store.updateVenta(editando.id, datos);
                toast(`Venta ${folioVenta(editando)} actualizada; el stock se recalculó.`);
            } else {
                const monto = Number(formData.get('abono_monto')) || 0;
                if (monto > 0) datos.abono = { monto, metodo: formData.get('abono_metodo') };
                if (prefill.cotizacion_id) datos.cotizacion_id = prefill.cotizacion_id;
                await Store.addVenta(datos);
                const nueva = Store.state.ventas.reduce((a, b) => (a.folio > b.folio ? a : b));
                toast(`Venta ${folioVenta(nueva)} registrada.`);
            }
            closeModal();
            refrescar();
        } catch (e) { handleError(e); }
    }, { ancho: '2xl', textoGuardar: editando ? 'Guardar cambios' : 'Registrar venta' });

    const selCliente = combo(panel.querySelector('#venta-cliente'), {
        items: itemsClientes(),
        valor: editando ? (editando.cliente_id || '') : (prefill.cliente_id ?? undefined),
        textoInicial: prefill.cliente_nombre,
        crear: {
            texto: 'Crear cliente',
            accion: async (nombre) => {
                await Store.addCliente({ nombre });
                const nuevo = Store.state.clientes.find(c => c.nombre === nombre);
                toast(`Cliente "${nombre}" creado. Puedes completar su teléfono luego en Clientes.`, 'info');
                return { id: nuevo.id, label: nuevo.nombre };
            },
        },
    });

    const total = () => lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);

    function actualizarTotales() {
        panel.querySelector('#venta-total').textContent = fmt(total());
        lineas.forEach((l, i) => {
            const el = panel.querySelector(`[data-subtotal="${i}"]`);
            if (el) el.textContent = fmt((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0));
        });
        const faltan = Store.faltantesParaVenta(lineas.filter(l => l.producto_id), editando);
        panel.querySelector('#venta-stock').innerHTML = faltan.length ? `
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <p class="font-bold mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Stock insuficiente (puedes registrar la venta igual; el stock quedará en negativo)</p>
                ${faltan.map(f => `<p>${esc(f.insumo.nombre)}: necesitas ${fmtNum(f.necesario)} ${esc(f.insumo.unidad_medida)}, hay ${fmtNum(f.disponible)} → faltan <b>${fmtNum(f.falta)}</b></p>`).join('')}
            </div>` : '';
    }

    function pintarLineas() {
        const cont = panel.querySelector('#venta-lineas');
        cont.innerHTML = lineas.map((l, i) => `
            <div class="grid grid-cols-12 gap-2 items-center">
                <div class="col-span-6"><input data-producto="${i}" class="${claseInput}" placeholder="Buscar producto..."></div>
                <input data-campo="cantidad" data-i="${i}" type="number" min="0" step="any" value="${l.cantidad}" class="col-span-2 ${claseInput}" aria-label="Cantidad">
                <input data-campo="precio_unitario" data-i="${i}" type="number" min="0" step="0.01" value="${l.precio_unitario}" class="col-span-2 ${claseInput}" aria-label="Precio unitario">
                <div class="col-span-2 flex items-center justify-end gap-1">
                    <span data-subtotal="${i}" class="text-sm font-medium text-slate-700 whitespace-nowrap"></span>
                    <button type="button" data-quitar="${i}" class="text-slate-300 hover:text-rose-500 px-1" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>`).join('');
        lineas.forEach((l, i) => {
            const input = cont.querySelector(`[data-producto="${i}"]`);
            if (!l.producto_id && l.nombre) input.value = l.nombre; // producto libre de una cotización
            combo(input, {
                items: itemsProductos(),
                valor: l.producto_id,
                onChange: (item) => {
                    if (!item) return;
                    l.producto_id = item.id;
                    const p = Store.state.productos.find(x => x.id === item.id);
                    if (p && (!l.precio_unitario || !l.desdeCotizacion)) l.precio_unitario = p.precio_venta;
                    cont.querySelector(`[data-campo="precio_unitario"][data-i="${i}"]`).value = l.precio_unitario;
                    actualizarTotales();
                },
            });
        });
        cont.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => {
            lineas[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
            actualizarTotales();
        }));
        cont.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
            lineas.splice(Number(btn.dataset.quitar), 1);
            if (!lineas.length) lineas.push({ producto_id: null, cantidad: 1, precio_unitario: 0 });
            pintarLineas();
        }));
        actualizarTotales();
    }

    panel.querySelector('#btn-add-linea').addEventListener('click', () => {
        lineas.push({ producto_id: null, cantidad: 1, precio_unitario: 0 });
        pintarLineas();
        panel.querySelector(`[data-producto="${lineas.length - 1}"]`)?.focus();
    });
    panel.querySelectorAll('[data-abono]').forEach(btn => btn.addEventListener('click', () => {
        panel.querySelector('[name=abono_monto]').value = (total() * Number(btn.dataset.abono)).toFixed(2);
    }));
    pintarLineas();
}

// ---------------- Abonos ----------------

export function openPagosModal(ventaId) {
    const pintar = () => {
        const v = Store.state.ventas.find(x => x.id === ventaId);
        if (!v) { closeModal(); return; }
        const saldo = Store.saldoVenta(v);
        const body = `
            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="p-3 rounded-xl bg-slate-50"><p class="text-xs text-slate-500">Total</p><p class="font-bold text-slate-800">${fmt(Store.montoVenta(v))}</p></div>
                <div class="p-3 rounded-xl bg-emerald-50"><p class="text-xs text-emerald-700">Abonado</p><p class="font-bold text-emerald-700">${fmt(Store.pagadoVenta(v))}</p></div>
                <div class="p-3 rounded-xl ${saldo > 0 ? 'bg-rose-50' : 'bg-emerald-50'}"><p class="text-xs ${saldo > 0 ? 'text-rose-700' : 'text-emerald-700'}">Saldo</p><p class="font-black ${saldo > 0 ? 'text-rose-700' : 'text-emerald-700'}">${fmt(saldo)}</p></div>
            </div>
            <p class="text-sm text-slate-500"><b class="text-slate-700">${esc(Store.nombreClienteVenta(v))}</b> · ${esc(detalleTexto(v))}</p>
            <div>
                ${etiqueta('Abonos registrados')}
                <ul class="divide-y divide-slate-100 border border-slate-100 rounded-lg">${v.pagos.map(p => `
                    <li class="flex items-center justify-between px-3 py-2 text-sm">
                        <span><span class="text-slate-500">${fmtFecha(p.fecha)}</span> · ${esc(p.metodo)}${p.nota ? ` <span class="text-xs text-slate-400">(${esc(p.nota)})</span>` : ''}</span>
                        <span class="flex items-center gap-2"><b>${fmt(p.monto)}</b><button type="button" data-borrar-pago="${p.id}" class="text-slate-300 hover:text-rose-500" aria-label="Eliminar abono"><i class="fa-solid fa-xmark"></i></button></span>
                    </li>`).join('') || '<li class="px-3 py-3 text-sm text-slate-400 text-center">Sin abonos todavía</li>'}
                </ul>
            </div>
            ${saldo > 0 ? `
            <div class="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p class="text-xs font-bold text-slate-500 uppercase mb-2">Registrar abono</p>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input name="fecha" type="date" value="${hoyISO()}" required class="${claseInput}" aria-label="Fecha">
                    <input name="monto" type="number" step="0.01" min="0.01" max="${saldo}" value="${saldo.toFixed(2)}" required class="${claseInput}" aria-label="Monto">
                    <select name="metodo" class="${claseInput}" aria-label="Método">${Store.METODOS_PAGO.map(m => `<option>${m}</option>`).join('')}</select>
                    <input name="nota" placeholder="Nota (ref.)" class="${claseInput}" aria-label="Nota">
                </div>
            </div>` : '<p class="text-sm text-emerald-700 text-center"><i class="fa-solid fa-circle-check mr-1"></i>Esta venta está pagada por completo.</p>'}
            <div class="flex gap-2 justify-center">
                <button type="button" data-recibo class="text-sm text-indigo-600 hover:underline"><i class="fa-solid fa-file-pdf mr-1"></i>Descargar recibo</button>
            </div>`;
        const { panel } = openModal(`Abonos de ${folioVenta(v)}`, body, async (formData) => {
            try {
                await Store.addPago(ventaId, {
                    fecha: formData.get('fecha'), monto: Number(formData.get('monto')),
                    metodo: formData.get('metodo'), nota: formData.get('nota'),
                });
                toast('Abono registrado.');
                refrescar();
                pintar();
            } catch (e) { handleError(e); }
        }, { textoGuardar: 'Registrar abono', sinGuardar: saldo <= 0 });
        panel.querySelectorAll('[data-borrar-pago]').forEach(btn => btn.addEventListener('click', async () => {
            if (!window.confirm('¿Eliminar este abono?')) return;
            try { await Store.deletePago(btn.dataset.borrarPago); toast('Abono eliminado.'); refrescar(); pintar(); } catch (e) { handleError(e); }
        }));
        panel.querySelector('[data-recibo]').addEventListener('click', () => descargarRecibo(ventaId));
    };
    pintar();
}

// ---------------- Adjuntos de diseño ----------------

export function openAdjuntosModal(ventaId) {
    const venta = () => Store.state.ventas.find(v => v.id === ventaId);
    const body = `
        <ul id="lista-adjuntos" class="grid grid-cols-2 gap-2"></ul>
        <div class="pt-4 border-t border-slate-100 space-y-3">
            <div>${etiqueta('Subir imagen')}
                <input id="input-adjunto-imagen" type="file" accept="image/*" class="w-full text-sm">
                <p class="text-xs text-slate-400 mt-1">Máx. 8MB. Se comprime automáticamente.</p></div>
            <div class="flex gap-2 items-end">
                <div class="flex-1">${etiqueta('O pegar enlace (Drive, etc.)')}<input id="input-adjunto-url" type="url" placeholder="https://drive.google.com/..." class="${claseInput}"></div>
                <button type="button" id="btn-add-enlace" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">Añadir</button>
            </div>
        </div>`;
    const { panel } = openModal(`Diseños de ${folioVenta(venta())}`, body, () => closeModal(), { sinGuardar: true });

    function pintarLista() {
        const ul = panel.querySelector('#lista-adjuntos');
        ul.innerHTML = venta().adjuntos.map(a => `
            <li class="relative group border border-slate-100 rounded-lg overflow-hidden bg-slate-50">
                <a href="${esc(a.url)}" target="_blank" rel="noopener" class="block">
                    ${a.tipo === 'imagen' ? `<img src="${esc(a.url)}" alt="${esc(a.nombre)}" class="w-full h-28 object-cover">` : '<div class="h-28 flex items-center justify-center text-3xl text-slate-300"><i class="fa-solid fa-link"></i></div>'}
                    <p class="px-2 py-1 text-xs text-indigo-600 truncate">${esc(a.nombre || a.url)}</p>
                </a>
                <button type="button" data-del-adjunto="${a.id}" class="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-slate-400 hover:text-rose-500 shadow" aria-label="Eliminar"><i class="fa-solid fa-xmark"></i></button>
            </li>`).join('') || '<li class="col-span-2 text-sm text-slate-400 text-center py-4">Sin diseños adjuntos aún</li>';
        ul.querySelectorAll('[data-del-adjunto]').forEach(btn => btn.addEventListener('click', async () => {
            try { await Store.deleteAdjunto(btn.dataset.delAdjunto); pintarLista(); refrescar(); } catch (e) { handleError(e); }
        }));
    }

    panel.querySelector('#btn-add-enlace').addEventListener('click', async () => {
        const input = panel.querySelector('#input-adjunto-url');
        if (!input.value.trim()) return;
        try {
            await Store.addAdjuntoEnlace(ventaId, input.value.trim(), input.value.trim().split('/').filter(Boolean).pop());
            input.value = '';
            pintarLista();
            refrescar();
        } catch (e) { handleError(e); }
    });
    panel.querySelector('#input-adjunto-imagen').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            await Store.addAdjuntoImagen(ventaId, file);
            e.target.value = '';
            pintarLista();
            refrescar();
            toast('Imagen adjuntada.');
        } catch (err) { handleError(err); }
    });
    pintarLista();
}

export const vista = {
    id: 'ventas',
    titulo: 'Ventas',
    subtitulo: 'Pedidos, abonos y recibos',
    icono: 'fa-cart-shopping',
    grupo: 'Principal',
    acciones: [{ texto: 'Nueva Venta', icono: 'fa-cart-plus', fn: 'openVentaModal' }],
    montar,
    render,
    handlers: { openVentaModal, openPagosModal, openAdjuntosModal, cambiarEstadoVenta, eliminarVenta, descargarRecibo, enviarEstadoWhatsApp },
};

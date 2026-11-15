/**
 * clientes.js — Directorio (CRM): contacto, fechas especiales, total comprado,
 * saldo pendiente e historial de cada cliente.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtFecha, fmtDiaMes, folioVenta, waLink, abrirWhatsApp, normalizar } from '../util.js';
import { openModal, closeModal, confirmDialog, toast, handleError } from '../ui.js';
import {
    refrescar, paginar, barraPaginacion, buscador, chips, filaVacia, badge, botonIcono, ESTADO_BADGE,
    conectarBuscador, conectarChips, etiqueta, claseInput, tarjeta,
} from './comun.js';
import { detalleTexto, badgeSaldo, openVentaModal, openPagosModal } from './ventas.js';

let consulta = '';
let filtro = 'todos';

function montar(el) {
    el.innerHTML = tarjeta(`
        <div class="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between rounded-t-2xl">
            ${buscador('buscar-cliente', 'Buscar por nombre, teléfono o email...')}
            <div id="chips-clientes"></div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-semibold">
                    <tr><th class="px-4 py-3">Cliente</th><th class="px-4 py-3">Contacto</th><th class="px-4 py-3">Fecha especial</th>
                        <th class="px-4 py-3 text-right">Total comprado</th><th class="px-4 py-3 text-right">Saldo</th><th class="px-4 py-3"></th></tr>
                </thead>
                <tbody id="tbl-clientes" class="text-sm divide-y divide-slate-50"></tbody>
            </table>
        </div>
        <div id="paginacion-clientes"></div>`);
    conectarBuscador('buscar-cliente', v => { consulta = v; }, 'clientes');
    conectarChips('chips-clientes', v => { filtro = v; }, 'clientes');
}

function render() {
    const conSaldo = Store.state.clientes.filter(c => Store.totalCompradoCliente(c.id).saldo > 0).length;
    document.getElementById('chips-clientes').innerHTML = chips('chips-cli-int', [['todos', 'Todos'], ['saldo', `Con saldo (${conSaldo})`]], filtro);
    const q = normalizar(consulta.trim());
    const lista = Store.state.clientes.filter(c =>
        (!q || normalizar(`${c.nombre} ${c.telefono} ${c.email}`).includes(q)) &&
        (filtro !== 'saldo' || Store.totalCompradoCliente(c.id).saldo > 0));
    const pag = paginar(lista, 'clientes');
    document.getElementById('tbl-clientes').innerHTML = pag.items.map(c => {
        const { total, ordenes, saldo } = Store.totalCompradoCliente(c.id);
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3"><button onclick="App.openClienteDetalle('${c.id}')" class="font-semibold text-slate-700 hover:text-indigo-600 hover:underline text-left">${esc(c.nombre)}</button>
                ${c.notas ? `<p class="text-xs text-slate-400 truncate max-w-[220px]" title="${esc(c.notas)}">${esc(c.notas)}</p>` : ''}</td>
            <td class="px-4 py-3 text-slate-500">
                ${c.telefono ? `<a href="${esc(waLink(c.telefono))}" target="_blank" rel="noopener" class="hover:underline whitespace-nowrap"><i class="fa-brands fa-whatsapp text-emerald-500 mr-1"></i>${esc(c.telefono)}</a>` : ''}
                ${c.email ? `<a href="mailto:${esc(c.email)}" class="block text-xs hover:underline">${esc(c.email)}</a>` : ''}
                ${!c.telefono && !c.email ? '—' : ''}</td>
            <td class="px-4 py-3">${c.fecha_especial
                ? `<span class="bg-amber-50 text-amber-700 px-2 py-1 rounded text-xs font-medium whitespace-nowrap"><i class="fa-solid fa-cake-candles mr-1"></i>${fmtDiaMes(c.fecha_especial)} · ${esc(c.tipo_fecha || 'Especial')}</span>
                   ${c.telefono ? `<button onclick="App.enviarFelicitacion('${c.id}')" title="Enviar felicitación por WhatsApp" class="ml-1 text-emerald-500 hover:text-emerald-700"><i class="fa-brands fa-whatsapp"></i></button>` : ''}`
                : '<span class="text-slate-300 text-xs">—</span>'}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap"><span class="font-semibold text-slate-700">${fmt(total)}</span> <span class="text-xs text-slate-400">(${ordenes})</span></td>
            <td class="px-4 py-3 text-right whitespace-nowrap">${saldo > 0 ? `<span class="font-semibold text-rose-600">${fmt(saldo)}</span>` : '<span class="text-slate-300">—</span>'}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${botonIcono(`App.nuevaVentaCliente('${c.id}')`, 'fa-solid fa-cart-plus', 'Nueva venta para este cliente')}
                ${botonIcono(`App.openClienteModal('${c.id}')`, 'fa-solid fa-pen', 'Editar')}
                ${botonIcono(`App.eliminarCliente('${c.id}')`, 'fa-solid fa-trash', 'Eliminar', 'hover:text-rose-500')}
            </td>
        </tr>`;
    }).join('') || filaVacia(6, consulta || filtro !== 'todos' ? 'Ningún cliente coincide' : 'Sin clientes. Usa "Nuevo Cliente" o créalos directo desde una venta.');
    document.getElementById('paginacion-clientes').innerHTML = barraPaginacion('clientes', pag);
}

function eliminarCliente(id) {
    const c = Store.state.clientes.find(x => x.id === id);
    confirmDialog(`¿Eliminar a <b>${esc(c.nombre)}</b>?`, async () => {
        try { await Store.deleteCliente(id); refrescar(); toast('Cliente eliminado.'); } catch (e) { handleError(e); }
    }, 'Eliminar');
}

function enviarFelicitacion(id) {
    const c = Store.state.clientes.find(x => x.id === id);
    if (!c?.telefono) return;
    const motivo = (c.tipo_fecha || 'día especial').toLowerCase();
    const negocio = Store.state.config.negocio_nombre;
    abrirWhatsApp(c.telefono, `¡Feliz ${motivo}, ${c.nombre}! 🎉 Te deseamos un excelente día${negocio ? ` de parte de todo el equipo de ${negocio}` : ''}.`);
}

function nuevaVentaCliente(id) {
    closeModal();
    openVentaModal(undefined, { cliente_id: id });
}

function openClienteDetalle(id) {
    const c = Store.state.clientes.find(x => x.id === id);
    if (!c) return;
    const { total, ordenes, saldo } = Store.totalCompradoCliente(id);
    const historial = Store.state.ventas.filter(v => v.cliente_id === id).sort((a, b) => b.folio - a.folio);
    const body = `
        <div class="flex items-start justify-between gap-4">
            <div>
                <h4 class="text-lg font-bold text-slate-800">${esc(c.nombre)}</h4>
                ${c.telefono ? `<a href="${esc(waLink(c.telefono))}" target="_blank" rel="noopener" class="text-sm text-emerald-600 hover:underline block"><i class="fa-brands fa-whatsapp mr-1"></i>${esc(c.telefono)}</a>` : ''}
                ${c.email ? `<a href="mailto:${esc(c.email)}" class="text-sm text-slate-500 hover:underline block"><i class="fa-regular fa-envelope mr-1"></i>${esc(c.email)}</a>` : ''}
                ${c.fecha_especial ? `<p class="text-xs mt-1 text-amber-700"><i class="fa-solid fa-cake-candles mr-1"></i>${fmtDiaMes(c.fecha_especial)} · ${esc(c.tipo_fecha || 'Especial')}</p>` : ''}
                ${c.notas ? `<p class="text-xs mt-1 text-slate-500"><i class="fa-regular fa-note-sticky mr-1"></i>${esc(c.notas)}</p>` : ''}
            </div>
            <div class="text-right shrink-0">
                <p class="text-xs text-slate-500">Total comprado</p><p class="text-lg font-black text-indigo-600">${fmt(total)}</p>
                <p class="text-xs text-slate-400">${ordenes} pedido${ordenes !== 1 ? 's' : ''}</p>
                ${saldo > 0 ? `<p class="text-sm font-bold text-rose-600 mt-1">Debe ${fmt(saldo)}</p>` : ''}
            </div>
        </div>
        <div class="flex justify-between items-center pt-3 border-t border-slate-100">
            ${etiqueta('Historial de compras')}
            <button type="button" onclick="App.nuevaVentaCliente('${c.id}')" class="text-sm text-indigo-600 hover:underline"><i class="fa-solid fa-cart-plus mr-1"></i>Nueva venta</button>
        </div>
        <ul class="space-y-2 max-h-72 overflow-y-auto">${historial.map(v => `
            <li class="flex justify-between items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100 text-sm">
                <div class="min-w-0">
                    <p class="font-mono text-xs text-indigo-600 font-bold">${folioVenta(v)} <span class="font-sans font-normal text-slate-400">· ${fmtFecha(v.fecha)}</span> ${badge(v.estado, ESTADO_BADGE[v.estado])}</p>
                    <p class="text-slate-600 truncate">${esc(detalleTexto(v))}</p>
                </div>
                <div class="text-right shrink-0"><p class="font-bold text-slate-700">${fmt(Store.montoVenta(v))}</p>
                    <button type="button" onclick="App.openPagosModal('${v.id}')">${badgeSaldo(v)}</button></div>
            </li>`).join('') || '<li class="text-sm text-slate-400 text-center py-4">Sin compras registradas</li>'}
        </ul>`;
    openModal('Detalle de cliente', body, () => closeModal(), { sinGuardar: true, ancho: '2xl' });
}

function openClienteModal(id) {
    if (typeof id !== 'string') id = undefined;
    const editando = id ? Store.state.clientes.find(c => c.id === id) : null;
    const body = `
        <div>${etiqueta('Nombre / Empresa')}<input name="nombre" required value="${esc(editando?.nombre)}" class="${claseInput}"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>${etiqueta('WhatsApp / Teléfono')}<input name="telefono" value="${esc(editando?.telefono)}" class="${claseInput}" placeholder="0414-1234567"></div>
            <div>${etiqueta('Email')}<input name="email" type="email" value="${esc(editando?.email)}" class="${claseInput}" placeholder="opcional"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div>${etiqueta('Fecha especial')}<input name="fecha_especial" type="date" value="${esc(editando?.fecha_especial)}" class="${claseInput}"></div>
            <div>${etiqueta('Tipo')}<input name="tipo_fecha" list="tipos-fecha" value="${esc(editando?.tipo_fecha)}" placeholder="Cumpleaños..." class="${claseInput}">
                <datalist id="tipos-fecha"><option value="Cumpleaños"><option value="Aniversario"><option value="Aniversario de empresa"></datalist></div>
        </div>
        <div>${etiqueta('Notas')}<textarea name="notas" rows="2" class="${claseInput}" placeholder="Preferencias, talla, cómo nos conoció...">${esc(editando?.notas)}</textarea></div>`;
    openModal(editando ? 'Editar cliente' : 'Nuevo cliente', body, async (formData) => {
        const data = Object.fromEntries(['nombre', 'telefono', 'email', 'fecha_especial', 'tipo_fecha', 'notas'].map(k => [k, formData.get(k) || '']));
        data.fecha_especial = data.fecha_especial || null;
        try {
            if (editando) await Store.updateCliente(editando.id, data); else await Store.addCliente(data);
            closeModal();
            refrescar();
            toast(`Cliente "${data.nombre}" guardado.`);
        } catch (e) { handleError(e); }
    });
}

export const vista = {
    id: 'clientes',
    titulo: 'Clientes',
    subtitulo: 'Directorio y seguimiento',
    icono: 'fa-users',
    grupo: 'Administración',
    acciones: [{ texto: 'Nuevo Cliente', icono: 'fa-user-plus', fn: 'openClienteModal' }],
    montar,
    render,
    handlers: { openClienteModal, openClienteDetalle, eliminarCliente, enviarFelicitacion, nuevaVentaCliente, openPagosModal },
};

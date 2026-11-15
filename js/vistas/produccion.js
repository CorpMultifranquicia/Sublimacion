/**
 * produccion.js — Tablero kanban: Por Diseñar → Imprimiendo → Listo → Entregado.
 * Las tarjetas se ordenan por fecha de entrega y marcan los pedidos atrasados.
 * En "Entregado" solo se muestran los últimos 30 días para que no crezca sin fin.
 */

import { Store } from '../store.js';
import { esc, fmt, folioVenta, hoyISO, sumarDias, abrirWhatsApp } from '../util.js';
import { toast, handleError } from '../ui.js';
import { refrescar, ESTADO_BADGE } from './comun.js';
import { detalleTexto, badgeEntrega, openAdjuntosModal, openPagosModal, mensajeEstado } from './ventas.js';

const DIAS_ENTREGADOS = 30;
const COLOR_COLUMNA = { 'Por Diseñar': 'border-t-blue-400', 'Imprimiendo': 'border-t-amber-400', 'Listo': 'border-t-violet-400', 'Entregado': 'border-t-emerald-400' };

function ordenar(a, b) {
    // Primero los que tienen fecha de entrega (la más próxima arriba), luego por folio.
    if (a.fecha_entrega && b.fecha_entrega) return a.fecha_entrega.localeCompare(b.fecha_entrega) || a.folio - b.folio;
    if (a.fecha_entrega) return -1;
    if (b.fecha_entrega) return 1;
    return a.folio - b.folio;
}

function tarjeta(v, idxEstado) {
    const cliente = Store.state.clientes.find(c => c.id === v.cliente_id);
    const siguiente = Store.ESTADOS_PRODUCCION[idxEstado + 1];
    const saldo = Store.saldoVenta(v);
    const atrasado = (Store.diasAtraso(v) ?? 0) > 0 && v.estado !== 'Listo';
    return `<div class="kanban-card bg-white p-3.5 rounded-lg shadow-sm border ${atrasado ? 'border-rose-200 ring-1 ring-rose-100' : 'border-slate-100'} hover:border-indigo-300 transition-colors" draggable="true" data-venta-id="${v.id}">
        <div class="flex justify-between items-center gap-2 mb-1.5">
            <span class="text-xs font-mono text-indigo-600 font-bold">${folioVenta(v)}</span>
            ${badgeEntrega(v)}
        </div>
        <p class="font-semibold text-slate-800 text-sm mb-1 leading-snug">${esc(detalleTexto(v))}</p>
        ${v.notas ? `<p class="text-xs text-slate-500 mb-1.5 line-clamp-2"><i class="fa-regular fa-note-sticky mr-1"></i>${esc(v.notas)}</p>` : ''}
        <div class="flex justify-between items-center text-xs mb-2">
            <span class="text-slate-500 truncate"><i class="fa-regular fa-user mr-1"></i>${esc(Store.nombreClienteVenta(v))}</span>
            <span class="font-bold text-slate-700">${fmt(Store.montoVenta(v))}</span>
        </div>
        ${saldo > 0 ? `<button onclick="App.openPagosModal('${v.id}')" class="w-full text-left text-xs mb-2 px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100"><i class="fa-solid fa-hand-holding-dollar mr-1"></i>Saldo pendiente ${fmt(saldo)}</button>` : ''}
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-50">
            <button onclick="App.openAdjuntosModal('${v.id}')" title="Diseños adjuntos" class="text-xs ${v.adjuntos.length ? 'text-indigo-600' : 'text-slate-400'} hover:text-indigo-600 flex items-center gap-1 whitespace-nowrap">
                <i class="fa-solid fa-paperclip"></i>${v.adjuntos.length ? `${v.adjuntos.length} diseño${v.adjuntos.length > 1 ? 's' : ''}` : 'Diseño'}
            </button>
            <div class="flex items-center gap-1">
                ${cliente?.telefono && v.estado !== 'Entregado' ? `<button onclick="App.avisarCliente('${v.id}')" title="Avisar al cliente por WhatsApp" class="w-7 h-7 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
                ${siguiente ? `<button onclick="App.avanzarEstado('${v.id}')" title="Pasar a ${siguiente}" class="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white whitespace-nowrap">${siguiente} <i class="fa-solid fa-arrow-right ml-0.5"></i></button>` : ''}
            </div>
        </div>
    </div>`;
}

function render(el) {
    const desdeEntregados = sumarDias(hoyISO(), -DIAS_ENTREGADOS);
    el.innerHTML = `<div class="flex gap-4 h-full overflow-x-auto pb-4" id="kanban-board">${Store.ESTADOS_PRODUCCION.map((estado, idx) => {
        let ventas = Store.state.ventas.filter(v => v.estado === estado);
        let ocultos = 0;
        if (estado === 'Entregado') {
            const recientes = ventas.filter(v => (v.entregado_en || v.fecha) >= desdeEntregados);
            ocultos = ventas.length - recientes.length;
            ventas = recientes.sort((a, b) => (b.entregado_en || '').localeCompare(a.entregado_en || '') || b.folio - a.folio);
        } else {
            ventas.sort(ordenar);
        }
        return `<div class="kanban-col min-w-[225px] flex-1 flex flex-col bg-slate-100/60 rounded-xl p-3 border border-slate-200/60 border-t-4 ${COLOR_COLUMNA[estado]}" data-estado="${estado}">
            <div class="flex justify-between items-center mb-3 px-1">
                <h3 class="font-bold text-slate-700 text-sm">${idx + 1}. ${estado}</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_BADGE[estado]}">${ventas.length}</span>
            </div>
            <div class="space-y-3 flex-1 min-h-[80px]">
                ${ventas.map(v => tarjeta(v, idx)).join('') || '<p class="text-xs text-slate-400 text-center py-6">Vacío</p>'}
            </div>
            ${ocultos ? `<p class="text-xs text-slate-400 text-center mt-3">${ocultos} entregado${ocultos > 1 ? 's' : ''} hace más de ${DIAS_ENTREGADOS} días (ver en Ventas)</p>` : ''}
        </div>`;
    }).join('')}</div>`;

    const board = el.querySelector('#kanban-board');
    board.querySelectorAll('.kanban-card').forEach(card => {
        card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.ventaId));
    });
    board.querySelectorAll('.kanban-col').forEach(col => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            moverA(e.dataTransfer.getData('text/plain'), col.dataset.estado);
        });
    });
}

async function moverA(ventaId, estado) {
    const venta = Store.state.ventas.find(v => v.id === ventaId);
    if (!venta || venta.estado === estado) return;
    try {
        await Store.updateEstadoVenta(ventaId, estado);
        refrescar();
        const v = Store.state.ventas.find(x => x.id === ventaId);
        const saldo = Store.saldoVenta(v);
        toast(`${folioVenta(v)} → ${estado}${estado === 'Entregado' && saldo > 0 ? ` · ¡Ojo! Tiene saldo pendiente de ${fmt(saldo)}` : ''}`, estado === 'Entregado' && saldo > 0 ? 'aviso' : 'ok');
    } catch (e) { handleError(e); }
}

function avanzarEstado(ventaId) {
    const v = Store.state.ventas.find(x => x.id === ventaId);
    const idx = Store.ESTADOS_PRODUCCION.indexOf(v.estado);
    moverA(ventaId, Store.ESTADOS_PRODUCCION[idx + 1]);
}

function avisarCliente(ventaId) {
    const v = Store.state.ventas.find(x => x.id === ventaId);
    const tel = Store.state.clientes.find(c => c.id === v.cliente_id)?.telefono;
    abrirWhatsApp(tel, mensajeEstado(v));
}

export const vista = {
    id: 'produccion',
    titulo: 'Producción',
    subtitulo: 'Tablero de pedidos por etapa',
    icono: 'fa-clipboard-check',
    grupo: 'Principal',
    acciones: [{ texto: 'Nueva Venta', icono: 'fa-cart-plus', fn: 'openVentaModal' }],
    render,
    handlers: { avanzarEstado, avisarCliente, openAdjuntosModal, openPagosModal },
};

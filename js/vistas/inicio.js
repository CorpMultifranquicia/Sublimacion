/**
 * inicio.js — Resumen del día: KPIs del mes vs. mes anterior, cuentas por cobrar,
 * entregas atrasadas/próximas, fechas especiales de clientes, stock bajo y
 * recordatorio de respaldo.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtNum, fmtFecha, fmtDiaMes, hoyISO, rangoMes, diasEntre, folioVenta, nombreMes, parseISO } from '../util.js';
import { tarjeta, badge, ESTADO_BADGE } from './comun.js';
import { detalleTexto, badgeEntrega, badgeSaldo } from './ventas.js';

const DIAS_AVISO_RESPALDO = 7;

function variacion(actual, anterior) {
    if (!anterior) return actual ? '<span class="text-xs text-slate-400">primer mes con datos</span>' : '';
    const pct = (actual - anterior) / Math.abs(anterior) * 100;
    const sube = pct >= 0;
    return `<span class="text-xs font-semibold ${sube ? 'text-emerald-600' : 'text-rose-600'}"><i class="fa-solid fa-arrow-${sube ? 'up' : 'down'} mr-0.5"></i>${Math.abs(pct).toFixed(0)}%</span> <span class="text-xs text-slate-400">vs. mes anterior</span>`;
}

function kpi(titulo, valor, pie, icono, color, onclick = '') {
    return `<button ${onclick ? `onclick="${onclick}"` : 'disabled'} class="text-left bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between gap-3 ${onclick ? 'hover:border-indigo-200 cursor-pointer' : 'cursor-default'} transition-colors">
        <div class="min-w-0"><p class="text-sm font-medium text-slate-500 mb-1">${titulo}</p><p class="text-2xl font-bold text-slate-800 truncate">${valor}</p><div class="mt-1">${pie}</div></div>
        <div class="w-11 h-11 bg-${color}-50 text-${color}-600 rounded-xl flex items-center justify-center text-lg shrink-0"><i class="fa-solid ${icono}"></i></div>
    </button>`;
}

function avisoRespaldo() {
    const hayDatos = Store.state.ventas.length || Store.state.insumos.length || Store.state.clientes.length;
    if (!hayDatos) return '';
    const ultimo = Store.state.config.ultimo_respaldo;
    const dias = ultimo ? diasEntre(ultimo, hoyISO()) : null;
    if (dias !== null && dias < DIAS_AVISO_RESPALDO) return '';
    return `<div class="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <p class="text-sm text-amber-800"><i class="fa-solid fa-shield-halved mr-2"></i>${dias === null ? 'Aún no has descargado un respaldo de tus datos.' : `Hace ${dias} días que no descargas un respaldo.`} Guárdalo en un pendrive o en Drive por si la PC falla.</p>
        <a href="/api/respaldo" onclick="setTimeout(() => App.iniciar(), 1500)" class="shrink-0 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 text-center"><i class="fa-solid fa-download mr-1"></i>Descargar respaldo</a>
    </div>`;
}

function render(el) {
    const hoy = hoyISO();
    const actual = rangoMes(hoy);
    const anterior = rangoMes(hoy, -1);
    const r = Store.resumenPeriodo(actual.desde, actual.hasta);
    const rAnt = Store.resumenPeriodo(anterior.desde, anterior.hasta);
    const porCobrar = Store.porCobrarTotal();
    const activos = Store.state.ventas.filter(v => v.estado !== 'Entregado');
    const atrasados = Store.ventasAtrasadas();
    const stockBajo = Store.state.insumos.filter(i => Store.estadoStock(i) !== 'Óptimo');
    const mesTxt = nombreMes(parseISO(hoy).getFullYear(), parseISO(hoy).getMonth());

    // Entregas: atrasadas + próximos 3 días, sin las ya entregadas.
    const entregas = activos.filter(v => v.fecha_entrega && diasEntre(hoy, v.fecha_entrega) <= 3)
        .sort((a, b) => a.fecha_entrega.localeCompare(b.fecha_entrega));
    const fechas = Store.fechasEspecialesProximas(7);
    const recientes = [...Store.state.ventas].sort((a, b) => b.folio - a.folio).slice(0, 6);

    el.innerHTML = `
        ${avisoRespaldo()}
        <p class="text-sm text-slate-500 mb-3 capitalize">${mesTxt}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            ${kpi('Ventas del mes', fmt(r.ingresos), variacion(r.ingresos, rAnt.ingresos), 'fa-arrow-trend-up', 'emerald', "App.showTab('reportes')")}
            ${kpi('Utilidad bruta del mes', fmt(r.utilidadBruta), `<span class="text-xs text-slate-500">Margen ${r.margen.toFixed(0)}%</span> · ${variacion(r.utilidadBruta, rAnt.utilidadBruta)}`, 'fa-sack-dollar', 'indigo', "App.showTab('reportes')")}
            ${kpi('Por cobrar', fmt(porCobrar.total), `<span class="text-xs text-slate-500">${porCobrar.ventas} venta${porCobrar.ventas !== 1 ? 's' : ''} con saldo</span>`, 'fa-hand-holding-dollar', porCobrar.total > 0 ? 'rose' : 'slate', "App.verVentasConSaldo()")}
            ${kpi('Pedidos activos', activos.length, atrasados.length ? `<span class="text-xs font-semibold text-rose-600"><i class="fa-solid fa-clock mr-1"></i>${atrasados.length} atrasado${atrasados.length > 1 ? 's' : ''}</span>` : '<span class="text-xs text-emerald-600">Todo a tiempo</span>', 'fa-clipboard-list', atrasados.length ? 'rose' : 'blue', "App.showTab('produccion')")}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            ${tarjeta(`<div class="p-5">
                <div class="flex justify-between items-center mb-4"><h3 class="font-bold text-slate-800"><i class="fa-solid fa-truck-fast text-indigo-500 mr-2"></i>Entregas</h3>
                    <button class="text-sm text-indigo-600 hover:underline" onclick="App.showTab('produccion')">Producción</button></div>
                <ul class="space-y-2">${entregas.slice(0, 6).map(v => `
                    <li class="flex items-center justify-between gap-2 text-sm">
                        <div class="min-w-0"><span class="font-mono text-xs text-indigo-600 font-bold">${folioVenta(v)}</span> <span class="text-slate-700">${esc(Store.nombreClienteVenta(v))}</span>
                            <p class="text-xs text-slate-400 truncate">${esc(detalleTexto(v))}</p></div>
                        <div class="text-right shrink-0">${badgeEntrega(v)}<div class="mt-0.5">${badge(v.estado, ESTADO_BADGE[v.estado])}</div></div>
                    </li>`).join('') || '<li class="text-sm text-slate-400 text-center py-4">Sin entregas para los próximos 3 días</li>'}</ul>
            </div>`)}
            ${tarjeta(`<div class="p-5">
                <h3 class="font-bold text-slate-800 mb-4"><i class="fa-solid fa-cake-candles text-amber-500 mr-2"></i>Fechas especiales (7 días)</h3>
                <ul class="space-y-2">${fechas.map(f => `
                    <li class="flex items-center justify-between gap-2 text-sm">
                        <div class="min-w-0"><p class="text-slate-700 font-medium truncate">${esc(f.cliente.nombre)}</p>
                            <p class="text-xs text-slate-400">${esc(f.cliente.tipo_fecha || 'Fecha especial')} · ${fmtDiaMes(f.fecha)} · ${f.faltan === 0 ? '<b class="text-amber-600">¡hoy!</b>' : f.faltan === 1 ? 'mañana' : `en ${f.faltan} días`}</p></div>
                        ${f.cliente.telefono ? `<button onclick="App.enviarFelicitacion('${f.cliente.id}')" class="shrink-0 text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><i class="fa-brands fa-whatsapp mr-1"></i>Felicitar</button>` : ''}
                    </li>`).join('') || '<li class="text-sm text-slate-400 text-center py-4">Ninguna esta semana</li>'}</ul>
            </div>`)}
            ${tarjeta(`<div class="p-5">
                <div class="flex justify-between items-center mb-4"><h3 class="font-bold text-slate-800"><i class="fa-solid fa-triangle-exclamation text-rose-500 mr-2"></i>Stock bajo</h3>
                    <button class="text-sm text-indigo-600 hover:underline" onclick="App.showTab('inventario')">Inventario</button></div>
                <ul class="space-y-2">${stockBajo.slice(0, 6).map(i => {
                    const critico = Store.estadoStock(i) === 'Crítico';
                    return `<li class="flex items-center justify-between gap-2 text-sm">
                        <span class="text-slate-700 truncate">${esc(i.nombre)}</span>
                        <span class="text-xs font-semibold ${critico ? 'text-rose-600' : 'text-amber-600'} whitespace-nowrap">${fmtNum(i.stock_actual)} / ${fmtNum(i.stock_minimo)} ${esc(i.unidad_medida)}</span>
                    </li>`;
                }).join('') || '<li class="text-sm text-slate-400 text-center py-4">Todo en orden ✅</li>'}
                ${stockBajo.length > 6 ? `<li class="text-xs text-slate-400 text-center">y ${stockBajo.length - 6} más</li>` : ''}</ul>
            </div>`)}
        </div>

        ${tarjeta(`<div class="p-5">
            <div class="flex justify-between items-center mb-4"><h3 class="font-bold text-slate-800">Ventas recientes</h3>
                <button class="text-sm text-indigo-600 hover:underline" onclick="App.showTab('ventas')">Ver todas</button></div>
            <div class="overflow-x-auto"><table class="w-full text-left text-sm">
                <thead><tr class="border-b border-slate-100 text-xs uppercase text-slate-400 font-semibold">
                    <th class="pb-2">Venta</th><th class="pb-2">Fecha</th><th class="pb-2">Cliente</th><th class="pb-2">Detalle</th><th class="pb-2">Estado</th><th class="pb-2 text-right">Total</th><th class="pb-2 text-right">Pago</th></tr></thead>
                <tbody class="divide-y divide-slate-50">${recientes.map(v => `
                    <tr><td class="py-2.5 font-mono text-xs font-bold text-indigo-600">${folioVenta(v)}</td>
                        <td class="py-2.5 text-slate-500 whitespace-nowrap">${fmtFecha(v.fecha)}</td>
                        <td class="py-2.5 text-slate-700">${esc(Store.nombreClienteVenta(v))}</td>
                        <td class="py-2.5 text-slate-500 max-w-[240px] truncate">${esc(detalleTexto(v))}</td>
                        <td class="py-2.5">${badge(v.estado, ESTADO_BADGE[v.estado])}</td>
                        <td class="py-2.5 text-right font-bold text-slate-700 whitespace-nowrap">${fmt(Store.montoVenta(v))}</td>
                        <td class="py-2.5 text-right"><button onclick="App.openPagosModal('${v.id}')">${badgeSaldo(v)}</button></td></tr>`).join('')
                    || '<tr><td colspan="7" class="py-8 text-center text-slate-400">Sin ventas aún. Orden sugerido: Inventario → Prod. y Precios → Ventas.</td></tr>'}</tbody>
            </table></div>
        </div>`)}`;
}

function verVentasConSaldo() {
    window.App.showTab('ventas');
    document.querySelector('#chips-ventas [data-valor="saldo"]')?.click();
}

export const vista = {
    id: 'inicio',
    titulo: 'Inicio',
    subtitulo: 'Resumen del negocio',
    icono: 'fa-chart-pie',
    grupo: 'Principal',
    acciones: [
        { texto: 'Nueva Cotización', icono: 'fa-file-circle-plus', fn: 'openCotizacionModal', variante: 'secundario' },
        { texto: 'Nueva Venta', icono: 'fa-cart-plus', fn: 'openVentaModal' },
    ],
    render,
    handlers: { verVentasConSaldo },
};


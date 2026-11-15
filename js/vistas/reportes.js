/**
 * reportes.js — Rentabilidad real: ventas, costo de lo vendido (guardado en cada
 * venta), gastos generales y utilidad neta, por período. Exporta a Excel.
 */

import { Store } from '../store.js';
import { esc, fmt, fmtNum, fmtFecha, hoyISO, rangoMes, enRango, mesCorto, parseISO, isoDe } from '../util.js';
import { tarjeta, claseInput } from './comun.js';

let periodo = 'mes';
let personalizado = { desde: rangoMes().desde, hasta: hoyISO() };

function rangoActual() {
    const hoy = hoyISO();
    const y = parseISO(hoy).getFullYear();
    switch (periodo) {
        case 'mes': return rangoMes(hoy);
        case 'anterior': return rangoMes(hoy, -1);
        case 'trimestre': return { desde: rangoMes(hoy, -2).desde, hasta: rangoMes(hoy).hasta };
        case 'anio': return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
        default: return personalizado;
    }
}

function montar(el) {
    el.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between mb-6">
            <div class="flex flex-wrap items-center gap-2">
                <select id="rep-periodo" class="${claseInput} w-auto" aria-label="Período">
                    <option value="mes">Este mes</option><option value="anterior">Mes anterior</option>
                    <option value="trimestre">Últimos 3 meses</option><option value="anio">Este año</option><option value="custom">Personalizado...</option>
                </select>
                <span id="rep-custom" class="hidden items-center gap-2">
                    <input id="rep-desde" type="date" class="${claseInput} w-auto" value="${personalizado.desde}" aria-label="Desde">
                    <span class="text-slate-400">a</span>
                    <input id="rep-hasta" type="date" class="${claseInput} w-auto" value="${personalizado.hasta}" aria-label="Hasta">
                </span>
                <span id="rep-rango" class="text-sm text-slate-500"></span>
            </div>
            <a id="rep-excel" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-md shadow-emerald-100 text-center" href="#"><i class="fa-solid fa-file-excel mr-1"></i>Exportar a Excel</a>
        </div>
        <div id="rep-cuerpo"></div>`;
    el.querySelector('#rep-periodo').addEventListener('change', (e) => { periodo = e.target.value; render(); });
    ['desde', 'hasta'].forEach(k => el.querySelector(`#rep-${k}`).addEventListener('change', (e) => { personalizado[k] = e.target.value; render(); }));
}

function kpi(titulo, valor, detalle, color = 'slate') {
    return tarjeta(`<div class="p-4"><p class="text-xs font-medium text-slate-500 mb-1">${titulo}</p>
        <p class="text-xl font-bold text-${color}-${color === 'slate' ? '800' : '600'}">${valor}</p>${detalle ? `<p class="text-xs text-slate-400 mt-0.5">${detalle}</p>` : ''}</div>`);
}

/** Gráfico de barras de los últimos 6 meses hasta el fin del período. */
function grafico(hasta) {
    const fin = parseISO(hasta);
    const meses = [];
    for (let i = 5; i >= 0; i--) {
        const r = rangoMes(isoDe(new Date(fin.getFullYear(), fin.getMonth() - i, 1)));
        const res = Store.resumenPeriodo(r.desde, r.hasta);
        meses.push({ label: mesCorto(parseISO(r.desde).getMonth()), ventas: res.ingresos, egresos: res.costo + res.gastos, neta: res.utilidadNeta });
    }
    const max = Math.max(1, ...meses.flatMap(m => [m.ventas, m.egresos]));
    return `<div class="flex items-end justify-between gap-2 h-48 border-b border-slate-200 pb-1">${meses.map(m => `
        <div class="flex-1 h-full flex flex-col justify-end items-center">
            <div class="flex gap-1 items-end w-full justify-center h-full">
                <div class="bg-indigo-500 w-1/3 max-w-[22px] rounded-t" style="height:${(m.ventas / max * 100).toFixed(1)}%" title="Ventas: ${fmt(m.ventas)}"></div>
                <div class="bg-rose-400 w-1/3 max-w-[22px] rounded-t" style="height:${(m.egresos / max * 100).toFixed(1)}%" title="Costo + gastos: ${fmt(m.egresos)}"></div>
            </div>
        </div>`).join('')}</div>
        <div class="flex justify-between gap-2 mt-2">${meses.map(m => `
            <div class="flex-1 text-center"><p class="text-xs text-slate-500 font-medium capitalize">${m.label}</p>
                <p class="text-[11px] font-semibold ${m.neta >= 0 ? 'text-emerald-600' : 'text-rose-600'}" title="Utilidad neta">${m.ventas || m.egresos ? fmt(m.neta) : '—'}</p></div>`).join('')}</div>
        <div class="flex justify-center gap-5 mt-4 text-xs text-slate-600">
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 bg-indigo-500 rounded-sm"></span>Ventas</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 bg-rose-400 rounded-sm"></span>Costo + gastos</span>
            <span class="flex items-center gap-1.5"><span class="text-emerald-600 font-bold">$</span>Utilidad neta</span>
        </div>`;
}

function tabla(titulo, encabezados, filas, vacio) {
    return tarjeta(`<div class="p-5"><h3 class="font-bold text-slate-800 mb-3">${titulo}</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="text-[11px] uppercase text-slate-400 border-b border-slate-100">${encabezados.map((h, i) => `<th class="pb-2 ${i ? 'text-right pl-3' : 'text-left'}">${h}</th>`).join('')}</tr></thead>
            <tbody class="divide-y divide-slate-50">${filas.map(f => `<tr>${f.map((c, i) => `<td class="py-2 ${i ? 'text-right whitespace-nowrap pl-3' : 'text-slate-700'}">${c}</td>`).join('')}</tr>`).join('')
                || `<tr><td colspan="${encabezados.length}" class="py-6 text-center text-slate-400">${vacio}</td></tr>`}</tbody>
        </table></div></div>`);
}

function render() {
    const { desde, hasta } = rangoActual();
    document.getElementById('rep-custom').classList.toggle('hidden', periodo !== 'custom');
    document.getElementById('rep-custom').classList.toggle('flex', periodo === 'custom');
    document.getElementById('rep-rango').textContent = periodo === 'custom' ? '' : `${fmtFecha(desde)} – ${fmtFecha(hasta)}`;
    document.getElementById('rep-excel').href = `/api/exportar?desde=${desde}&hasta=${hasta}`;

    const r = Store.resumenPeriodo(desde, hasta);

    // Rentabilidad por producto
    const porProducto = {};
    r.ventas.forEach(v => v.detalle.forEach(d => {
        const x = porProducto[d.producto_nombre] ||= { uds: 0, ventas: 0, costo: 0 };
        x.uds += d.cantidad; x.ventas += d.cantidad * d.precio_unitario; x.costo += d.cantidad * d.costo_unitario;
    }));
    const productos = Object.entries(porProducto).sort((a, b) => (b[1].ventas - b[1].costo) - (a[1].ventas - a[1].costo));

    // Por cliente
    const porCliente = {};
    r.ventas.forEach(v => {
        const x = porCliente[Store.nombreClienteVenta(v)] ||= { pedidos: 0, ventas: 0, utilidad: 0, saldo: 0 };
        x.pedidos++; x.ventas += Store.montoVenta(v); x.utilidad += Store.montoVenta(v) - Store.costoVenta(v); x.saldo += Store.saldoVenta(v);
    });
    const clientes = Object.entries(porCliente).sort((a, b) => b[1].ventas - a[1].ventas).slice(0, 10);

    // Gastos por categoría y cobros por método
    const gastosCat = {};
    Store.state.gastos.filter(g => enRango(g.fecha, desde, hasta)).forEach(g => { gastosCat[g.categoria] = (gastosCat[g.categoria] || 0) + g.monto; });
    const cobros = {};
    Store.state.ventas.flatMap(v => v.pagos).filter(p => enRango(p.fecha, desde, hasta)).forEach(p => { cobros[p.metodo] = (cobros[p.metodo] || 0) + p.monto; });

    const margenTxt = (u, v) => v ? `${(u / v * 100).toFixed(0)}%` : '—';

    document.getElementById('rep-cuerpo').innerHTML = `
        <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            ${kpi('Ventas', fmt(r.ingresos), `${r.ventas.length} pedido${r.ventas.length !== 1 ? 's' : ''}`, 'indigo')}
            ${kpi('Costo de lo vendido', fmt(r.costo), 'insumos según receta', 'rose')}
            ${kpi('Utilidad bruta', fmt(r.utilidadBruta), `margen ${r.margen.toFixed(0)}%`, r.utilidadBruta >= 0 ? 'emerald' : 'rose')}
            ${kpi('Gastos generales', fmt(r.gastos), 'alquiler, servicios...', 'amber')}
            ${kpi('Utilidad neta', fmt(r.utilidadNeta), 'bruta − gastos', r.utilidadNeta >= 0 ? 'emerald' : 'rose')}
            ${kpi('Cobrado', fmt(r.cobrado), r.porCobrar > 0 ? `<span class="text-rose-600">falta cobrar ${fmt(r.porCobrar)}</span>` : 'todo cobrado')}
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            ${tarjeta(`<div class="p-5"><h3 class="font-bold text-slate-800 mb-4">Últimos 6 meses</h3>${grafico(hasta)}</div>`)}
            ${tabla('Rentabilidad por producto', ['Producto', 'Uds.', 'Ventas', 'Costo', 'Utilidad', 'Margen'],
                productos.map(([n, x]) => [esc(n), fmtNum(x.uds), fmt(x.ventas), `<span class="text-rose-600">${fmt(x.costo)}</span>`,
                    `<b class="${x.ventas - x.costo >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${fmt(x.ventas - x.costo)}</b>`, margenTxt(x.ventas - x.costo, x.ventas)]),
                'Sin ventas en el período')}
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div class="xl:col-span-2">${tabla('Mejores clientes', ['Cliente', 'Pedidos', 'Ventas', 'Utilidad', 'Saldo'],
                clientes.map(([n, x]) => [esc(n), x.pedidos, fmt(x.ventas), fmt(x.utilidad), x.saldo > 0 ? `<span class="text-rose-600 font-semibold">${fmt(x.saldo)}</span>` : '—']),
                'Sin ventas en el período')}</div>
            <div class="space-y-6">
                ${tabla('Gastos por categoría', ['Categoría', 'Monto'], Object.entries(gastosCat).sort((a, b) => b[1] - a[1]).map(([c, m]) => [esc(c), fmt(m)]), 'Sin gastos registrados')}
                ${tabla('Cobros por método', ['Método', 'Monto'], Object.entries(cobros).sort((a, b) => b[1] - a[1]).map(([c, m]) => [esc(c), fmt(m)]), 'Sin cobros en el período')}
            </div>
        </div>
        <p class="text-xs text-slate-400 mt-6"><i class="fa-solid fa-circle-info mr-1"></i>El costo de cada venta se guarda al momento de venderla, así los cambios de precio de los insumos no alteran los reportes pasados. Las compras de insumos no se cuentan como gasto: se reflejan cuando el insumo se vende (costo de lo vendido).</p>`;
}

export const vista = {
    id: 'reportes',
    titulo: 'Reportes',
    subtitulo: 'Rentabilidad y análisis',
    icono: 'fa-chart-line',
    grupo: 'Administración',
    montar,
    render,
};

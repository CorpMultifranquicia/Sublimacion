/**
 * store.js — Capa de datos de SubliApp.
 *
 * Mantiene una copia en memoria (`state`) de todo lo que hay en la base, para que
 * las vistas lean de forma síncrona. Toda escritura va a la API local (/api/...)
 * y luego recarga el estado.
 *
 * Aquí también viven los cálculos de negocio que usan las vistas
 * (costos, márgenes, saldos, resúmenes por período).
 */

import { compressImage } from './imageUtils.js';
import { configurarMoneda, hoyISO, enRango, parseISO, diasEntre, sumarDias, isoDe } from './util.js';

let state = {
    config: {},
    insumos: [],
    productos: [],
    clientes: [],
    ventas: [],
    compras: [],
    cotizaciones: [],
    gastos: [],
};

/** Llama a la API local y lanza un Error con el mensaje del servidor si algo falla. */
async function api(metodo, ruta, datos) {
    const opciones = { method: metodo };
    if (datos instanceof FormData) {
        opciones.body = datos;
    } else if (datos !== undefined) {
        opciones.headers = { 'Content-Type': 'application/json' };
        opciones.body = JSON.stringify(datos);
    }
    let res;
    try {
        res = await fetch(ruta, opciones);
    } catch {
        throw new Error('No hay conexión con SubliApp. ¿Se cerró la ventana negra del programa?');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    return json;
}

async function load() {
    state = await api('GET', '/api/estado');
    configurarMoneda(state.config.moneda, state.config.moneda_local);
}

/** Ejecuta una escritura y recarga el estado. Devuelve la respuesta de la API. */
async function escribir(metodo, ruta, datos) {
    const res = await api(metodo, ruta, datos);
    await load();
    return res;
}

const buscar = (lista, id) => lista.find(x => x.id === id);

// ---------- Productos: costos y márgenes ----------

function costoInsumoEnReceta(item) {
    const insumo = buscar(state.insumos, item.insumo_id);
    if (!insumo) return 0;
    return insumo.costo_unitario * item.cantidad * (1 + (item.merma_pct || 0) / 100);
}

function costoProduccion(producto) {
    return producto.receta.reduce((sum, item) => sum + costoInsumoEnReceta(item), 0);
}

function margenPct(producto) {
    if (!producto.precio_venta) return 0;
    return ((producto.precio_venta - costoProduccion(producto)) / producto.precio_venta) * 100;
}

function gananciaNeta(producto) {
    return producto.precio_venta - costoProduccion(producto);
}

function margenObjetivo() {
    const m = Number(state.config.margen_objetivo);
    return Number.isFinite(m) && m >= 0 && m < 100 ? m : 50;
}

/** Precio que deja el margen objetivo: costo / (1 - margen). */
function precioSugerido(costo) {
    return costo / (1 - margenObjetivo() / 100);
}

// ---------- Inventario ----------

function estadoStock(insumo) {
    if (insumo.stock_actual <= insumo.stock_minimo * 0.5) return 'Crítico';
    if (insumo.stock_actual <= insumo.stock_minimo) return 'Alerta';
    return 'Óptimo';
}

/** Insumos que faltarían para producir `detalle` ([{producto_id, cantidad}]). */
function faltantesParaVenta(detalle, ventaEditada = null) {
    const necesario = {};
    detalle.forEach(d => {
        const p = buscar(state.productos, d.producto_id);
        p?.receta.forEach(r => {
            necesario[r.insumo_id] = (necesario[r.insumo_id] || 0) + r.cantidad * (1 + (r.merma_pct || 0) / 100) * (Number(d.cantidad) || 0);
        });
    });
    // Al editar, lo que la venta ya había descontado vuelve a estar disponible.
    const devuelto = {};
    ventaEditada?.detalle.forEach(d => {
        const p = buscar(state.productos, d.producto_id);
        p?.receta.forEach(r => {
            devuelto[r.insumo_id] = (devuelto[r.insumo_id] || 0) + r.cantidad * (1 + (r.merma_pct || 0) / 100) * d.cantidad;
        });
    });
    return Object.entries(necesario).map(([id, cant]) => {
        const insumo = buscar(state.insumos, id);
        const disponible = (insumo?.stock_actual || 0) + (devuelto[id] || 0);
        return { insumo, necesario: cant, disponible, falta: cant - disponible };
    }).filter(x => x.insumo && x.falta > 1e-9);
}

function valorInventario() {
    return state.insumos.reduce((s, i) => s + Math.max(i.stock_actual, 0) * i.costo_unitario, 0);
}

// ---------- Ventas ----------

const ESTADOS_PRODUCCION = ['Por Diseñar', 'Imprimiendo', 'Listo', 'Entregado'];
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Pago móvil', 'Zelle', 'Punto de venta', 'Otro'];

const montoVenta = (v) => v.detalle.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0);
const costoVenta = (v) => v.detalle.reduce((s, d) => s + d.cantidad * d.costo_unitario, 0);
const pagadoVenta = (v) => v.pagos.reduce((s, p) => s + p.monto, 0);
const saldoVenta = (v) => Math.max(0, Math.round((montoVenta(v) - pagadoVenta(v)) * 100) / 100);

function nombreClienteVenta(v) {
    return buscar(state.clientes, v.cliente_id)?.nombre || 'Mostrador';
}

/** Días de atraso respecto a la fecha de entrega (0 o negativo = a tiempo). */
function diasAtraso(v) {
    if (!v.fecha_entrega || v.estado === 'Entregado') return null;
    return diasEntre(v.fecha_entrega, hoyISO());
}

function ventasAtrasadas() {
    return state.ventas.filter(v => (diasAtraso(v) ?? -1) > 0 && v.estado !== 'Listo');
}

// ---------- Clientes ----------

function totalCompradoCliente(clienteId) {
    const ventas = state.ventas.filter(v => v.cliente_id === clienteId);
    return {
        total: ventas.reduce((s, v) => s + montoVenta(v), 0),
        saldo: ventas.reduce((s, v) => s + saldoVenta(v), 0),
        ordenes: ventas.length,
    };
}

/** Clientes con fecha especial en los próximos `dias` días (sin importar el año). */
function fechasEspecialesProximas(dias = 7) {
    const hoy = parseISO(hoyISO());
    return state.clientes.filter(c => c.fecha_especial).map(c => {
        const f = parseISO(c.fecha_especial);
        let proxima = new Date(hoy.getFullYear(), f.getMonth(), f.getDate());
        if (proxima < hoy) proxima = new Date(hoy.getFullYear() + 1, f.getMonth(), f.getDate());
        return { cliente: c, fecha: isoDe(proxima), faltan: diasEntre(isoDe(hoy), isoDe(proxima)) };
    }).filter(x => x.faltan <= dias).sort((a, b) => a.faltan - b.faltan);
}

// ---------- Compras y cotizaciones ----------

const montoCompra = (c) => c.items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0);
const montoCotizacion = (c) => c.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
const venceCotizacion = (c) => sumarDias(c.fecha, c.validez_dias);

// ---------- Bolívares y tasa del día ----------

/** ¿Está activado el manejo de bolívares en Configuración? */
const bsActivo = () => state.config.bs_activo === '1';

/** Tasa del día (Bs por $) o null si no se ha cargado. */
function tasaDia() {
    const t = Number(state.config.tasa_dia);
    return t > 0 ? t : null;
}

/** ¿La tasa cargada es de hoy? */
const tasaEsDeHoy = () => state.config.tasa_fecha === hoyISO();

/** Convierte un monto en $ a Bs con la tasa indicada (o la del día). */
function aBs(monto, tasa = tasaDia()) {
    return tasa ? monto * tasa : null;
}

// ---------- Resúmenes por período ----------

function resumenPeriodo(desde, hasta) {
    const ventas = state.ventas.filter(v => enRango(v.fecha, desde, hasta));
    const ingresos = ventas.reduce((s, v) => s + montoVenta(v), 0);
    const costo = ventas.reduce((s, v) => s + costoVenta(v), 0);
    const gastos = state.gastos.filter(g => enRango(g.fecha, desde, hasta)).reduce((s, g) => s + g.monto, 0);
    const compras = state.compras.filter(c => enRango(c.fecha, desde, hasta)).reduce((s, c) => s + montoCompra(c), 0);
    const cobrado = state.ventas.flatMap(v => v.pagos).filter(p => enRango(p.fecha, desde, hasta)).reduce((s, p) => s + p.monto, 0);
    return {
        ventas, ingresos, costo, gastos, compras, cobrado,
        utilidadBruta: ingresos - costo,
        utilidadNeta: ingresos - costo - gastos,
        margen: ingresos ? (ingresos - costo) / ingresos * 100 : 0,
        porCobrar: ventas.reduce((s, v) => s + saldoVenta(v), 0),
    };
}

function porCobrarTotal() {
    const conSaldo = state.ventas.filter(v => saldoVenta(v) > 0);
    return { total: conSaldo.reduce((s, v) => s + saldoVenta(v), 0), ventas: conSaldo.length };
}

// ---------- Escrituras ----------

export const Store = {
    get state() { return state; },
    load,

    // cálculos
    costoInsumoEnReceta, costoProduccion, margenPct, gananciaNeta, margenObjetivo, precioSugerido,
    estadoStock, faltantesParaVenta, valorInventario,
    ESTADOS_PRODUCCION, METODOS_PAGO,
    montoVenta, costoVenta, pagadoVenta, saldoVenta, nombreClienteVenta, diasAtraso, ventasAtrasadas,
    totalCompradoCliente, fechasEspecialesProximas,
    montoCompra, montoCotizacion, venceCotizacion,
    resumenPeriodo, porCobrarTotal,
    bsActivo, tasaDia, tasaEsDeHoy, aBs,

    // insumos
    addInsumo: (d) => escribir('POST', '/api/insumos', d),
    updateInsumo: (id, d) => escribir('PUT', `/api/insumos/${id}`, d),
    deleteInsumo: (id) => escribir('DELETE', `/api/insumos/${id}`),
    ajustarStock: (id, d) => escribir('POST', `/api/insumos/${id}/ajuste`, d),
    movimientos: (id) => api('GET', `/api/insumos/${id}/movimientos`),

    // productos
    addProducto: (d) => escribir('POST', '/api/productos', d),
    updateProducto: (id, d) => escribir('PUT', `/api/productos/${id}`, d),
    deleteProducto: (id) => escribir('DELETE', `/api/productos/${id}`),

    // clientes
    addCliente: (d) => escribir('POST', '/api/clientes', d),
    updateCliente: (id, d) => escribir('PUT', `/api/clientes/${id}`, d),
    deleteCliente: (id) => escribir('DELETE', `/api/clientes/${id}`),

    // ventas
    addVenta: (d) => escribir('POST', '/api/ventas', d),
    updateVenta: (id, d) => escribir('PUT', `/api/ventas/${id}`, d),
    updateEstadoVenta: (id, estado) => escribir('PUT', `/api/ventas/${id}/estado`, { estado }),
    deleteVenta: (id) => escribir('DELETE', `/api/ventas/${id}`),
    addPago: (ventaId, d) => escribir('POST', `/api/ventas/${ventaId}/pagos`, d),
    deletePago: (id) => escribir('DELETE', `/api/pagos/${id}`),

    // adjuntos
    addAdjuntoEnlace: (ventaId, url, nombre) => escribir('POST', `/api/ventas/${ventaId}/adjuntos/enlace`, { url, nombre }),
    async addAdjuntoImagen(ventaId, file) {
        const comprimido = await compressImage(file);
        const form = new FormData();
        form.append('archivo', comprimido);
        form.append('nombre', file.name);
        return escribir('POST', `/api/ventas/${ventaId}/adjuntos/imagen`, form);
    },
    deleteAdjunto: (id) => escribir('DELETE', `/api/adjuntos/${id}`),

    // compras
    addCompra: (d) => escribir('POST', '/api/compras', d),
    updateCompra: (id, d) => escribir('PUT', `/api/compras/${id}`, d),
    deleteCompra: (id) => escribir('DELETE', `/api/compras/${id}`),

    // cotizaciones
    addCotizacion: (d) => escribir('POST', '/api/cotizaciones', d),
    updateCotizacion: (id, d) => escribir('PUT', `/api/cotizaciones/${id}`, d),
    deleteCotizacion: (id) => escribir('DELETE', `/api/cotizaciones/${id}`),

    // gastos
    addGasto: (d) => escribir('POST', '/api/gastos', d),
    updateGasto: (id, d) => escribir('PUT', `/api/gastos/${id}`, d),
    deleteGasto: (id) => escribir('DELETE', `/api/gastos/${id}`),

    // tasa de cambio
    guardarTasa: (fecha, tasa) => escribir('POST', '/api/tasas', { fecha, tasa }),
    borrarTasa: (fecha) => escribir('DELETE', `/api/tasas/${fecha}`),

    // configuración y sistema
    guardarConfig: (d) => escribir('PUT', '/api/config', d),
    abrirCarpetaDatos: () => api('POST', '/api/abrir-carpeta'),
};

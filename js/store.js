/**
 * store.js — Capa de datos de SubliApp, respaldada por el servidor local (Python + SQLite).
 * Mantiene una caché en memoria (`state`) para que app.js lea de forma síncrona;
 * toda escritura se confirma contra la API local (/api/...) y luego refresca la caché.
 */

import { compressImage } from './imageUtils.js';

let state = {
    insumos: [],
    productos: [],
    clientes: [],
    ventas: [],
    compras: [],
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
        throw new Error('No hay conexión con SubliApp. ¿Se cerró la ventana del programa?');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    return json;
}

async function load() {
    state = await api('GET', '/api/estado');
}

// ---------- Cálculos financieros (puro JS, sin red) ----------

function costoInsumoEnReceta(item) {
    const insumo = state.insumos.find(i => i.id === item.insumo_id);
    if (!insumo) return 0;
    const merma = 1 + (item.merma_pct || 0) / 100;
    return insumo.costo_unitario * item.cantidad * merma;
}

function costoProduccion(producto) {
    return producto.receta.reduce((sum, item) => sum + costoInsumoEnReceta(item), 0);
}

function margenPct(producto) {
    const costo = costoProduccion(producto);
    if (!producto.precio_venta) return 0;
    return ((producto.precio_venta - costo) / producto.precio_venta) * 100;
}

function gananciaNeta(producto) {
    return producto.precio_venta - costoProduccion(producto);
}

function estadoStock(insumo) {
    if (insumo.stock_actual <= insumo.stock_minimo * 0.5) return 'Crítico';
    if (insumo.stock_actual <= insumo.stock_minimo) return 'Alerta';
    return 'Óptimo';
}

// ---------- Insumos ----------

async function addInsumo(data) {
    await api('POST', '/api/insumos', data);
    await load();
}

async function updateInsumo(id, data) {
    await api('PUT', `/api/insumos/${id}`, data);
    await load();
}

async function deleteInsumo(id) {
    await api('DELETE', `/api/insumos/${id}`);
    await load();
}

// ---------- Productos ----------

async function addProducto(data) {
    await api('POST', '/api/productos', data);
    await load();
}

async function updateProducto(id, data) {
    await api('PUT', `/api/productos/${id}`, data);
    await load();
}

async function deleteProducto(id) {
    await api('DELETE', `/api/productos/${id}`);
    await load();
}

// ---------- Clientes ----------

async function addCliente(data) {
    await api('POST', '/api/clientes', data);
    await load();
}

async function updateCliente(id, data) {
    await api('PUT', `/api/clientes/${id}`, data);
    await load();
}

async function deleteCliente(id) {
    await api('DELETE', `/api/clientes/${id}`);
    await load();
}

function totalCompradoCliente(clienteId) {
    const ventasCliente = state.ventas.filter(v => v.cliente_id === clienteId);
    const total = ventasCliente.reduce((sum, v) => sum + montoVenta(v), 0);
    return { total, ordenes: ventasCliente.length };
}

// ---------- Ventas ----------

const ESTADOS_PRODUCCION = ['Por Diseñar', 'Imprimiendo', 'Listo/Entregado'];

function montoVenta(venta) {
    return venta.detalle.reduce((sum, d) => sum + d.cantidad * d.precio_unitario, 0);
}

async function addVenta({ cliente_id, fecha, detalle, estado }) {
    await api('POST', '/api/ventas', { cliente_id, fecha, detalle, estado: estado || 'Por Diseñar' });
    await load();
}

async function updateEstadoVenta(id, estado) {
    await api('PUT', `/api/ventas/${id}/estado`, { estado });
    await load();
}

async function deleteVenta(id) {
    await api('DELETE', `/api/ventas/${id}`);
    await load();
}

// ---------- Adjuntos de producción ----------

async function addAdjuntoEnlace(ventaId, url, nombre) {
    await api('POST', `/api/ventas/${ventaId}/adjuntos/enlace`, { url, nombre });
    await load();
}

async function addAdjuntoImagen(ventaId, file) {
    const comprimido = await compressImage(file);
    const form = new FormData();
    form.append('archivo', comprimido);
    form.append('nombre', file.name);
    await api('POST', `/api/ventas/${ventaId}/adjuntos/imagen`, form);
    await load();
}

async function deleteAdjunto(id) {
    await api('DELETE', `/api/adjuntos/${id}`);
    await load();
}

// ---------- Compras ----------

async function addCompra({ proveedor, fecha, items }) {
    await api('POST', '/api/compras', { proveedor, fecha, items });
    await load();
}

function montoCompra(compra) {
    return compra.items.reduce((sum, i) => sum + i.cantidad * i.costo_unitario, 0);
}

// ---------- KPIs / Dashboard ----------

function kpisDelMes(fechaRef = new Date()) {
    const y = fechaRef.getFullYear(), m = fechaRef.getMonth();
    const enMes = (fechaStr) => {
        const d = new Date(fechaStr);
        return d.getFullYear() === y && d.getMonth() === m;
    };
    const ingresos = state.ventas.filter(v => enMes(v.fecha)).reduce((s, v) => s + montoVenta(v), 0);
    const gastos = state.compras.filter(c => enMes(c.fecha)).reduce((s, c) => s + montoCompra(c), 0);
    const ordenesActivas = state.ventas.filter(v => v.estado !== 'Listo/Entregado').length;
    const alertasStock = state.insumos.filter(i => estadoStock(i) !== 'Óptimo').length;
    return { ingresos, gastos, ordenesActivas, alertasStock };
}

export const Store = {
    get state() { return state; },
    load,
    costoInsumoEnReceta, costoProduccion, margenPct, gananciaNeta,
    estadoStock,
    addInsumo, updateInsumo, deleteInsumo,
    addProducto, updateProducto, deleteProducto,
    addCliente, updateCliente, deleteCliente, totalCompradoCliente,
    ESTADOS_PRODUCCION, montoVenta, addVenta, updateEstadoVenta, deleteVenta,
    addAdjuntoEnlace, addAdjuntoImagen, deleteAdjunto,
    addCompra, montoCompra,
    kpisDelMes,
};

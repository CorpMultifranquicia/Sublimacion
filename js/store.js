/**
 * store.js — Capa de datos de SubliApp, respaldada por Supabase (Postgres + RLS).
 * Mantiene una caché local en memoria (`state`) para que el resto de la app
 * (render.js/app.js) siga leyendo de forma síncrona; toda escritura confirma
 * contra Supabase primero y luego refresca la caché.
 */

import { supabase } from './supabaseClient.js';

let state = {
    insumos: [],
    productos: [],
    clientes: [],
    ventas: [],
    compras: [],
};

async function load() {
    const [insumosRes, productosRes, recetasRes, clientesRes, ventasRes, ventasDetalleRes, adjuntosRes, comprasRes, comprasDetalleRes] = await Promise.all([
        supabase.from('insumos').select('*').order('nombre'),
        supabase.from('productos_finales').select('*').order('nombre'),
        supabase.from('recetas_detalle').select('*'),
        supabase.from('clientes').select('*').order('nombre'),
        supabase.from('ventas').select('*').order('fecha', { ascending: false }),
        supabase.from('ventas_detalle').select('*'),
        supabase.from('venta_adjuntos').select('*').order('created_at'),
        supabase.from('compras').select('*').order('fecha', { ascending: false }),
        supabase.from('compras_detalle').select('*'),
    ]);

    const firstError = [insumosRes, productosRes, recetasRes, clientesRes, ventasRes, ventasDetalleRes, adjuntosRes, comprasRes, comprasDetalleRes]
        .map(r => r.error).find(Boolean);
    if (firstError) throw firstError;

    state.insumos = insumosRes.data.map(i => ({
        ...i,
        costo_unitario: Number(i.costo_unitario),
        stock_actual: Number(i.stock_actual),
        stock_minimo: Number(i.stock_minimo),
    }));
    state.clientes = clientesRes.data;

    state.productos = productosRes.data.map(p => ({
        ...p,
        precio_venta: Number(p.precio_venta),
        receta: recetasRes.data
            .filter(r => r.producto_id === p.id)
            .map(r => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad_usada), merma_pct: Number(r.porcentaje_merma) })),
    }));

    state.ventas = ventasRes.data.map(v => ({
        id: v.id,
        folio: v.folio,
        cliente_id: v.cliente_id,
        fecha: v.fecha,
        estado: v.estado_produccion,
        detalle: ventasDetalleRes.data
            .filter(d => d.venta_id === v.id)
            .map(d => ({ producto_id: d.producto_id, cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario) })),
        adjuntos: adjuntosRes.data
            .filter(a => a.venta_id === v.id)
            .map(a => ({ id: a.id, tipo: a.tipo, url: a.url, nombre: a.nombre })),
    }));

    state.compras = comprasRes.data.map(c => ({
        id: c.id,
        folio: c.folio,
        proveedor: c.proveedor,
        fecha: c.fecha,
        items: comprasDetalleRes.data
            .filter(i => i.compra_id === c.id)
            .map(i => ({ insumo_id: i.insumo_id, cantidad: Number(i.cantidad), costo_unitario: Number(i.costo_unitario) })),
    }));
}

function must(res) {
    if (res.error) throw res.error;
    return res.data;
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
    must(await supabase.from('insumos').insert(data));
    await load();
}

async function updateInsumo(id, data) {
    must(await supabase.from('insumos').update(data).eq('id', id));
    await load();
}

async function deleteInsumo(id) {
    must(await supabase.from('insumos').delete().eq('id', id));
    await load();
}

// ---------- Productos ----------

async function addProducto({ receta, ...data }) {
    const producto = must(await supabase.from('productos_finales').insert(data).select().single());
    if (receta.length) {
        must(await supabase.from('recetas_detalle').insert(
            receta.map(r => ({ producto_id: producto.id, insumo_id: r.insumo_id, cantidad_usada: r.cantidad, porcentaje_merma: r.merma_pct }))
        ));
    }
    await load();
}

async function updateProducto(id, { receta, ...data }) {
    must(await supabase.from('productos_finales').update(data).eq('id', id));
    must(await supabase.from('recetas_detalle').delete().eq('producto_id', id));
    if (receta.length) {
        must(await supabase.from('recetas_detalle').insert(
            receta.map(r => ({ producto_id: id, insumo_id: r.insumo_id, cantidad_usada: r.cantidad, porcentaje_merma: r.merma_pct }))
        ));
    }
    await load();
}

async function deleteProducto(id) {
    must(await supabase.from('productos_finales').delete().eq('id', id));
    await load();
}

// ---------- Clientes ----------

async function addCliente(data) {
    must(await supabase.from('clientes').insert(data));
    await load();
}

async function updateCliente(id, data) {
    must(await supabase.from('clientes').update(data).eq('id', id));
    await load();
}

async function deleteCliente(id) {
    must(await supabase.from('clientes').delete().eq('id', id));
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
    const { error } = await supabase.rpc('registrar_venta', {
        p_cliente_id: cliente_id,
        p_fecha: fecha,
        p_estado: estado || 'Por Diseñar',
        p_detalle: detalle,
    });
    if (error) throw error;
    await load();
}

async function updateEstadoVenta(id, estado) {
    must(await supabase.from('ventas').update({ estado_produccion: estado }).eq('id', id));
    await load();
}

async function deleteVenta(id) {
    must(await supabase.from('ventas').delete().eq('id', id));
    await load();
}

// ---------- Adjuntos de producción ----------

async function addAdjuntoEnlace(ventaId, url, nombre) {
    must(await supabase.from('venta_adjuntos').insert({ venta_id: ventaId, tipo: 'enlace', url, nombre }));
    await load();
}

async function addAdjuntoImagen(ventaId, file) {
    const path = `${ventaId}/${crypto.randomUUID()}-${file.name}`;
    const upload = await supabase.storage.from('adjuntos').upload(path, file);
    if (upload.error) throw upload.error;
    const { data: { publicUrl } } = supabase.storage.from('adjuntos').getPublicUrl(path);
    must(await supabase.from('venta_adjuntos').insert({ venta_id: ventaId, tipo: 'imagen', url: publicUrl, nombre: file.name }));
    await load();
}

async function deleteAdjunto(id) {
    must(await supabase.from('venta_adjuntos').delete().eq('id', id));
    await load();
}

// ---------- Compras ----------

async function addCompra({ proveedor, fecha, items }) {
    const { error } = await supabase.rpc('registrar_compra', {
        p_proveedor: proveedor,
        p_fecha: fecha,
        p_items: items,
    });
    if (error) throw error;
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

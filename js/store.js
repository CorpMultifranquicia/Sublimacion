/**
 * store.js — Capa de datos de SubliApp.
 * Persistencia en localStorage. Aislada del resto de la app para poder
 * sustituirla más adelante por Supabase/Firebase sin tocar la UI.
 */

const STORAGE_KEY = 'subliapp_data_v1';

function seedData() {
    return {
        nextId: { insumo: 5, producto: 4, cliente: 4, venta: 48, compra: 3 },
        insumos: [
            { id: 1, nombre: 'Taza en Blanco 11oz AAA', categoria: 'Sustrato', unidad_medida: 'ud', costo_unitario: 1.20, stock_actual: 72, stock_minimo: 36 },
            { id: 2, nombre: 'Franela Poliéster Blanca (M)', categoria: 'Sustrato', unidad_medida: 'ud', costo_unitario: 3.50, stock_actual: 12, stock_minimo: 10 },
            { id: 3, nombre: 'Tinta Sublimación Cian', categoria: 'Consumible', unidad_medida: 'ml', costo_unitario: 0.10, stock_actual: 15, stock_minimo: 50 },
            { id: 4, nombre: 'Papel Sublimación A4', categoria: 'Consumible', unidad_medida: 'hoja', costo_unitario: 0.10, stock_actual: 80, stock_minimo: 50 },
        ],
        productos: [
            {
                id: 1, nombre: 'Taza Blanca 11oz', categoria: 'Cerámica', precio_venta: 5.00,
                receta: [
                    { insumo_id: 1, cantidad: 1, merma_pct: 0 },
                    { insumo_id: 3, cantidad: 2, merma_pct: 5 },
                    { insumo_id: 4, cantidad: 1, merma_pct: 0 },
                ]
            },
            {
                id: 2, nombre: 'Franela Poliéster Blanca', categoria: 'Textil', precio_venta: 10.00,
                receta: [
                    { insumo_id: 2, cantidad: 1, merma_pct: 0 },
                    { insumo_id: 3, cantidad: 3, merma_pct: 5 },
                    { insumo_id: 4, cantidad: 1, merma_pct: 0 },
                ]
            },
            {
                id: 3, nombre: 'Gorra Camionera', categoria: 'Textil / Accesorios', precio_venta: 6.00,
                receta: [
                    { insumo_id: 3, cantidad: 1.5, merma_pct: 5 },
                    { insumo_id: 4, cantidad: 1, merma_pct: 0 },
                ]
            },
        ],
        clientes: [
            { id: 1, nombre: 'María Pérez', telefono: '+58 414-1234567', fecha_especial: '2026-08-14', tipo_fecha: 'Cumpleaños' },
            { id: 2, nombre: 'Carlos Gómez', telefono: '+58 412-9876543', fecha_especial: '2026-10-10', tipo_fecha: 'Aniversario' },
            { id: 3, nombre: 'Valeria Castro (Equipo Softbol)', telefono: '+58 424-5551234', fecha_especial: '', tipo_fecha: '' },
        ],
        ventas: [
            {
                id: 45, cliente_id: 3, fecha: '2026-07-29', estado: 'Entregado',
                detalle: [{ producto_id: 1, cantidad: 3, precio_unitario: 7.50 }]
            },
            {
                id: 46, cliente_id: 2, fecha: '2026-08-01', estado: 'Por Diseñar',
                detalle: [{ producto_id: 2, cantidad: 1, precio_unitario: 10.00 }, { producto_id: 1, cantidad: 1, precio_unitario: 5.00 }]
            },
            {
                id: 47, cliente_id: 3, fecha: '2026-08-02', estado: 'Imprimiendo',
                detalle: [{ producto_id: 3, cantidad: 5, precio_unitario: 6.00 }]
            },
        ],
        compras: [
            { id: 1, proveedor: 'Distribuidora Textil', fecha: '2026-07-28', items: [{ insumo_id: 2, cantidad: 12, costo_unitario: 3.50 }] },
            { id: 2, proveedor: 'Tintas Y Papeles C.A.', fecha: '2026-07-10', items: [{ insumo_id: 4, cantidad: 100, costo_unitario: 0.10 }, { insumo_id: 3, cantidad: 100, costo_unitario: 0.145 }] },
        ],
    };
}

let state = load();

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('No se pudo leer localStorage', e); }
    const fresh = seedData();
    save(fresh);
    return fresh;
}

function save(s = state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function nextId(kind) {
    const id = state.nextId[kind]++;
    save();
    return id;
}

// ---------- Cálculos financieros ----------

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

// ---------- Insumos ----------

function estadoStock(insumo) {
    if (insumo.stock_actual <= insumo.stock_minimo * 0.5) return 'Crítico';
    if (insumo.stock_actual <= insumo.stock_minimo) return 'Alerta';
    return 'Óptimo';
}

function addInsumo(data) {
    const insumo = { id: nextId('insumo'), stock_actual: 0, ...data };
    state.insumos.push(insumo);
    save();
    return insumo;
}

function updateInsumo(id, data) {
    const insumo = state.insumos.find(i => i.id === id);
    if (!insumo) return;
    Object.assign(insumo, data);
    save();
}

function deleteInsumo(id) {
    state.insumos = state.insumos.filter(i => i.id !== id);
    save();
}

// ---------- Productos ----------

function addProducto(data) {
    const producto = { id: nextId('producto'), receta: [], ...data };
    state.productos.push(producto);
    save();
    return producto;
}

function updateProducto(id, data) {
    const producto = state.productos.find(p => p.id === id);
    if (!producto) return;
    Object.assign(producto, data);
    save();
}

function deleteProducto(id) {
    state.productos = state.productos.filter(p => p.id !== id);
    save();
}

// ---------- Clientes ----------

function addCliente(data) {
    const cliente = { id: nextId('cliente'), ...data };
    state.clientes.push(cliente);
    save();
    return cliente;
}

function updateCliente(id, data) {
    const cliente = state.clientes.find(c => c.id === id);
    if (!cliente) return;
    Object.assign(cliente, data);
    save();
}

function deleteCliente(id) {
    state.clientes = state.clientes.filter(c => c.id !== id);
    save();
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

function addVenta({ cliente_id, fecha, detalle, estado }) {
    const venta = { id: nextId('venta'), cliente_id, fecha, estado: estado || 'Por Diseñar', detalle };
    state.ventas.push(venta);
    // Descuenta stock de insumos según receta de cada producto vendido
    detalle.forEach(d => {
        const producto = state.productos.find(p => p.id === d.producto_id);
        if (!producto) return;
        producto.receta.forEach(item => {
            const insumo = state.insumos.find(i => i.id === item.insumo_id);
            if (!insumo) return;
            const merma = 1 + (item.merma_pct || 0) / 100;
            insumo.stock_actual -= item.cantidad * merma * d.cantidad;
        });
    });
    save();
    return venta;
}

function updateEstadoVenta(id, estado) {
    const venta = state.ventas.find(v => v.id === id);
    if (!venta) return;
    venta.estado = estado;
    save();
}

function deleteVenta(id) {
    state.ventas = state.ventas.filter(v => v.id !== id);
    save();
}

// ---------- Compras ----------

function addCompra({ proveedor, fecha, items }) {
    const compra = { id: nextId('compra'), proveedor, fecha, items };
    state.compras.push(compra);
    // Actualiza stock y recalcula costo unitario promedio ponderado
    items.forEach(item => {
        const insumo = state.insumos.find(i => i.id === item.insumo_id);
        if (!insumo) return;
        const valorActual = insumo.costo_unitario * insumo.stock_actual;
        const valorNuevo = item.costo_unitario * item.cantidad;
        const stockTotal = insumo.stock_actual + item.cantidad;
        insumo.costo_unitario = stockTotal > 0 ? (valorActual + valorNuevo) / stockTotal : insumo.costo_unitario;
        insumo.stock_actual = stockTotal;
    });
    save();
    return compra;
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
    load, save,
    costoInsumoEnReceta, costoProduccion, margenPct, gananciaNeta,
    estadoStock,
    addInsumo, updateInsumo, deleteInsumo,
    addProducto, updateProducto, deleteProducto,
    addCliente, updateCliente, deleteCliente, totalCompradoCliente,
    ESTADOS_PRODUCCION, montoVenta, addVenta, updateEstadoVenta, deleteVenta,
    addCompra, montoCompra,
    kpisDelMes,
};

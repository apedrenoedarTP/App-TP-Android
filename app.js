/* =============================================================================
   EDAR Torre Pacheco — app.js
   Secciones:
     1. ESTADO          — datos de la aplicación
     2. CONFIGURACIÓN   — Firebase, GitHub
     3. UTILIDADES      — funciones puras sin DOM
     4. PERSISTENCIA    — localStorage + Firebase read/write
     5. EXCEL / GITHUB  — exportación de informes
     6. UI — POPUPS     — creación y destrucción de popups
     7. UI — ICONOS     — actualización de iconos de notificación
     8. UI — PANTALLAS  — navegación entre pantallas
     9. UI — LISTAS     — renderizado de listas dinámicas
    10. UI — FORMULARIOS — lectura y reset de formularios
    11. LÓGICA — PARTES DE TRABAJO
    12. LÓGICA — MANTENIMIENTOS
    13. LÓGICA — EQUIPOS
    14. AUTOCOMPLETE    — sugerencias en campos de equipo
    15. FOTO            — captura y previsualización
    16. INICIALIZACIÓN  — listeners Firebase en tiempo real
    17. ARRANQUE        — DOMContentLoaded
============================================================================= */


/* =============================================================================
   1. ESTADO
============================================================================= */

const db = {
  operarios: [],
  familias: [],
  zonas: [],
  equipos: [],
  items: [],
  incidencias: [],
  rutinas: [],
  preventivos: [],
  correctivos: [],
  modificativos: [],
  pendingRecords: {
    incidencias: [],
    rutinas: [],
    preventivos: [],
    correctivos: [],
    modificativos: [],
    workorders: []
  },
  workOrders: [],
  workOrdersAverias: [],
  workOrdersTareas: [],
  mantenimientosPeriodicos: [],
  preventivosEquipos: [],
  tareasProgramadas: [],
  trabajosPeriodicos: [],
  recambios: [],
  historialEquipos: {},
  isOffline: false
};

window.db = db;

window.equiposDb = {
  familias: [],
  zonas: [],
  equipos: [],
  modelos: [],
  recambios: [],
  equiposGuardados: []
};


/* =============================================================================
   2. CONFIGURACIÓN
============================================================================= */

// ── Detección de entorno ──────────────────────────────────────────────────
// PROD  → hostname de producción   → Firebase indusguard-f2a96  (datos reales)
// DEV   → localhost / 127.0.0.1 / file:// / red local → Firebase gestion-mantenimiento-2775
// Para forzar DEV en cualquier host: FORCE_DEV = true  (nunca subir a prod)
const firebaseConfig = {
  apiKey: "AIzaSyCZCnrS2x6NN-90xWiHxp-GEptykBDlEx4",
  authDomain: "gestion-mantenimiento-2775.firebaseapp.com",
  databaseURL: "https://gestion-mantenimiento-2775-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gestion-mantenimiento-2775",
  storageBucket: "gestion-mantenimiento-2775.firebasestorage.app",
  messagingSenderId: "617941743072",
  appId: "1:617941743072:web:34dbddade02d7d7321a785"
};

// Claves de localStorage aisladas por entorno
const LS_KEY_APP     = 'edarData';
const LS_KEY_EQUIPOS = 'equiposDb';

const GITHUB_CONFIG = {
  token: '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',
  owner: 'apedrenoedarTP',
  repo: 'Gesti-n-EDAR',
  branch: 'main'
};

const ADMIN_PIN = '2378';

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const realDb = firebase.database();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => console.log('Auth persistence enabled'))
  .catch((error) => console.error('Error enabling auth persistence:', error));

auth.onAuthStateChanged((user) => {
  if (user && !user.isAnonymous) {
    console.log('User is signed in:', user.uid, user.email);
    updateStockIcon();
  }
});

// ── Fase 1: login email/password paralelo al sistema PIN ─────────────────────
// No reemplaza nada. El sistema PIN sigue funcionando exactamente igual.

async function loginHibrido(email, password) {
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;
    // Leer perfil del usuario en /usuarios/{uid}
    const snap = await realDb.ref('usuarios/' + uid).once('value');
    const perfil = snap.val();
    if (!perfil) {
      await auth.signOut();
      return { ok: false, error: 'Usuario no registrado en el sistema. Contacta con el administrador.' };
    }
    if (perfil.estado !== 'activo') {
      await auth.signOut();
      return { ok: false, error: perfil.estado === 'pendiente' ? 'Acceso pendiente de aprobación.' : 'Acceso bloqueado. Contacta con el administrador.' };
    }
    // Guardar uid en sessionStorage para uso interno
    localStorage.setItem('usuarioUid', uid);
    localStorage.setItem('usuarioRol', perfil.rol || 'operario');
    localStorage.setItem('usuarioNombre', perfil.nombre || email);
    localStorage.setItem('usuarioEmail', email);
    _guardarEmailReciente(email);
    // Actualizar último acceso (no bloqueante)
    realDb.ref('usuarios/' + uid + '/ultimoAcceso').set(new Date().toISOString()).catch(() => {});
    console.log('[Auth] Login OK:', email, '| rol:', perfil.rol);
    return { ok: true, perfil };
  } catch (e) {
    console.error('[Auth] loginHibrido error:', e);
    return { ok: false, error: e.message };
  }
}

function _guardarEmailReciente(email) {
  if (!email) return;
  const KEY = 'usuariosRecientes';
  let lista = JSON.parse(localStorage.getItem(KEY) || '[]');
  lista = [email, ...lista.filter(e => e !== email)].slice(0, 10);
  localStorage.setItem(KEY, JSON.stringify(lista));
}

function _renderLoginRecientes() {
  const KEY = 'usuariosRecientes';
  const panel = document.getElementById('loginRecientes');
  if (!panel) return;
  const lista = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (!lista.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  panel.innerHTML = `<p style="font-size:0.78rem;color:var(--text-muted);margin:4px 0 2px">Usuarios recientes</p>` +
    lista.map(e =>
      `<button onclick="document.getElementById('loginEmail').value='${e}';document.getElementById('loginPassword').focus()"
        style="background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:0.82rem;cursor:pointer;text-align:left">${e}</button>`
    ).join('');
}

async function _registrarUsuarioFirebase(email, password, nombre) {
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;
    await realDb.ref('usuarios/' + uid).set({
      email,
      nombre:        nombre || email,
      rol:           'operario',
      estado:        'pendiente',
      instalaciones: [],
      creadoEn:      new Date().toISOString(),
      ultimoAcceso:  ''
    });
    await auth.signOut(); // esperar aprobación, no entrar aún
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

window.loginHibrido          = loginHibrido;
window._registrarUsuarioFirebase = _registrarUsuarioFirebase;

// ── Fase 2: UI de login email/password en pantalla principal ─────────────────

async function uiLoginHibrido() {
  const email    = (document.getElementById('loginEmail')    || {}).value || '';
  const password = (document.getElementById('loginPassword') || {}).value || '';
  const msg      = document.getElementById('loginMsg');
  if (!email || !password) { if (msg) msg.textContent = 'Introduce email y contraseña'; return; }
  if (msg) msg.textContent = 'Verificando...';
  const res = await loginHibrido(email, password);
  if (res.ok) {
    if (msg) msg.textContent = '';
    // Usar _decidirPantallaInicial para ir al sitio correcto según estado
    await _decidirPantallaInicial();
  } else {
    if (msg) msg.textContent = res.error || 'Error de acceso';
  }
}

function _mostrarPanelLogin() {
  const user  = auth.currentUser;
  const panel = document.getElementById('loginEmailPanel');
  if (!panel) return;
  if (user && !user.isAnonymous) {
    // Ya hay sesión email activa — mostrar panel con usuario logueado
    realDb.ref('usuarios/' + user.uid).once('value').then(snap => {
      const p = snap.val();
      if (!p) return;
      panel.style.display = '';
      const activo = document.getElementById('loginUsuarioActivo');
      const inputs = panel.querySelectorAll('input, button');
      if (activo) { activo.textContent = '✓ ' + (p.nombre || user.email); activo.style.display = ''; }
      // Ocultar inputs si ya está logueado
      inputs.forEach(el => el.style.display = 'none');
    }).catch(() => { panel.style.display = ''; });
  } else {
    panel.style.display = '';
  }
}

function mostrarPanelLogin() {
  document.getElementById('panelBotonesAcceso').style.display = 'none';
  const panel = document.getElementById('loginEmailPanel');
  panel.style.display = 'flex';
  setTimeout(() => document.getElementById('loginEmail').focus(), 100);
  _renderLoginRecientes();
}

function ocultarPanelLogin() {
  document.getElementById('loginEmailPanel').style.display = 'none';
  document.getElementById('panelBotonesAcceso').style.display = 'flex';
}

function volverAInstalaciones() {
  const panelBot   = document.getElementById('panelBotonesAcceso');
  const panelLogin = document.getElementById('loginEmailPanel');
  const panelInst  = document.getElementById('panelInstalaciones');
  if (panelBot)   panelBot.style.display   = 'none';
  if (panelLogin) panelLogin.style.display = 'none';
  if (panelInst)  panelInst.style.display  = 'flex';
  cargarInstalaciones();
  showScreen('mainScreen');
}
window.volverAInstalaciones = volverAInstalaciones;
window.mostrarPanelLogin  = mostrarPanelLogin;
window.ocultarPanelLogin  = ocultarPanelLogin;
window.uiLoginHibrido    = uiLoginHibrido;
window._mostrarPanelLogin = _mostrarPanelLogin;

async function uiRegistrarUsuario() {
  const nombre   = (document.getElementById('regNombre')    || {}).value || '';
  const email    = (document.getElementById('regEmail')     || {}).value || '';
  const pass     = (document.getElementById('regPassword')  || {}).value || '';
  const pass2    = (document.getElementById('regPassword2') || {}).value || '';
  const msg      = document.getElementById('regMsg');

  if (!nombre || !email || !pass) { if (msg) msg.textContent = 'Completa todos los campos'; return; }
  if (pass !== pass2)             { if (msg) msg.textContent = 'Las contraseñas no coinciden'; return; }
  if (pass.length < 6)            { if (msg) msg.textContent = 'La contraseña debe tener al menos 6 caracteres'; return; }

  if (msg) msg.textContent = 'Enviando solicitud...';
  const res = await _registrarUsuarioFirebase(email, pass, nombre);
  if (res.ok) {
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '✓ Solicitud enviada. El administrador revisará tu acceso.'; }
    ['regNombre','regEmail','regPassword','regPassword2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  } else {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = res.error || 'Error al registrar'; }
  }
}

window.uiRegistrarUsuario = uiRegistrarUsuario;

// ── Logout explícito + info usuario en menú ──────────────────────────────────

async function uiCerrarSesionCompleta() {
  const user = auth.currentUser;
  if (user && !user.isAnonymous) {
    await auth.signOut().catch(() => {});
    localStorage.removeItem('usuarioUid');
    localStorage.removeItem('usuarioRol');
    localStorage.removeItem('usuarioNombre');
    localStorage.removeItem('usuarioEmail');

  }
  cerrarSesion(); // limpia localStorage e instalacionActiva, recarga
}

function _mostrarUsuarioEnMenu() {
  const el = document.getElementById('menuUsuarioActivo');
  if (!el) return;
  const user = auth.currentUser;
  if (!user || user.isAnonymous) { el.textContent = ''; return; }
  realDb.ref('usuarios/' + user.uid + '/nombre').once('value')
    .then(snap => { el.textContent = '👤 ' + (snap.val() || user.email); })
    .catch(() => { el.textContent = '👤 ' + user.email; });
  const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
  const wb  = document.getElementById('workOrderBtn');
  const eb  = document.getElementById('equiposBtn');
  const mab = document.getElementById('menuAdminBtn');
  if (wb)  wb.style.display  = esAdmin ? '' : 'none';
  if (eb)  eb.style.display  = esAdmin ? '' : 'none';
  if (mab) mab.style.display = esAdmin ? '' : 'none';
}

window.uiCerrarSesionCompleta = uiCerrarSesionCompleta;

// Mock de upload (comportamiento original preservado)
// Multi-instalación: cambia 'instalacionActiva' en localStorage para separar datos
function INST() { return localStorage.getItem('instalacionActiva') || 'default'; }
window.INST = INST;
console.log('[INST()] Instalación activa:', INST());

const websim = {
  upload: (blob) => Promise.resolve('https://example.com/uploaded-file.xlsx')
};


/* =============================================================================
   3. UTILIDADES — funciones puras, sin DOM, sin efectos secundarios
============================================================================= */

// Filtra array segun rol: admin ve todo, operario ve sin asignar + asignados a el
function _filtrarPorRol(arr) {
  const rol = localStorage.getItem('usuarioRol');
  const uid = localStorage.getItem('usuarioUid');
  if (rol === 'admin') return arr;
  return arr.filter(o => {
    const uids = _getAsignadosUids(o);
    return !uids.length || uids.includes(uid);
  });
}

// Indica si una instalación tiene trabajo pendiente relevante para el usuario actual
// (vencidos en mantenimientos periódicos, o averías/tareas pendientes/en curso)
function _instalacionTienePendientes(instData) {
  if (!instData) return false;
  const mants   = _filtrarPorRol((instData.mantenimientosPeriodicos || []).filter(Boolean));
  const averias = _filtrarPorRol((instData.workOrdersAverias || []).filter(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso')));
  const tareas  = _filtrarPorRol((instData.workOrdersTareas  || []).filter(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso')));
  const hayVencidos = mants.some(m => esMantenimientoVencido(m));
  return hayVencidos || averias.length > 0 || tareas.length > 0;
}

// Devuelve los datos del usuario autenticado en sesión para trazabilidad
function _sesionAutor() {
  return {
    uid:    localStorage.getItem('usuarioUid')    || '',
    nombre: localStorage.getItem('usuarioNombre') || '',
    email:  localStorage.getItem('usuarioEmail')  || ''
  };
}

// Calcula la próxima fecha de mantenimiento dado el último registro
// Usa fechaUltimaEjecucion si existe (nuevo campo), cae en 'fecha' para compatibilidad
function calcularProximaFecha(mantenimiento) {
  const ancla = mantenimiento.fechaUltimaEjecucion || mantenimiento.fecha;
  const lastDate = new Date(ancla);
  return new Date(lastDate.getTime() + mantenimiento.periodicidad * 24 * 60 * 60 * 1000);
}

// Determina si un mantenimiento está vencido
function esMantenimientoVencido(mantenimiento) {
  if (!mantenimiento) return false;
  const ancla = mantenimiento.fechaUltimaEjecucion || mantenimiento.fecha;
  if (!ancla) return false;
  return new Date() > calcularProximaFecha(mantenimiento);
}

// Devuelve siempre un array de uids asignados, compatible con formato antiguo (string) y nuevo (array)
function _getAsignadosUids(registro) {
  if (!registro) return [];
  if (Array.isArray(registro.asignadoAUids)) return registro.asignadoAUids.filter(Boolean);
  if (registro.asignadoAUid) return [registro.asignadoAUid];
  return [];
}

// Devuelve siempre un array de nombres asignados, en paralelo a _getAsignadosUids
function _getAsignadosNombres(registro) {
  if (!registro) return [];
  if (Array.isArray(registro.asignadoANombres)) return registro.asignadoANombres.filter(Boolean);
  if (registro.asignadoANombre) return [registro.asignadoANombre];
  return [];
}

// Ordena un array por una propiedad de texto
function ordenarPorPropiedad(arr, prop) {
  return [...arr].sort((a, b) => {
    if (!a || !b || !a[prop] || !b[prop]) return 0;
    return a[prop].localeCompare(b[prop]);
  });
}

// Convierte un Blob a Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Construye un Excel de una sola hoja a partir de un array de objetos
function crearExcelBlob(filas, nombreHoja) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

// Verifica si un equipo tiene algún recambio sin stock
function equipoTieneStockAgotado(equipo) {
  if (!equipo) return false;
  if (equipo.cantidad === 0) return true;
  return equipo.recambios &&
    Array.isArray(equipo.recambios) &&
    equipo.recambios.some(r => r.cantidad === 0);
}

// Pide el PIN al usuario y devuelve true si es correcto
function verificarPin() {
  return prompt('Por favor ingrese el código de administrador:') === ADMIN_PIN;
}


/* =============================================================================
   4. PERSISTENCIA — lectura y escritura de datos
============================================================================= */

// Guarda el estado principal en localStorage y en Firebase
async function saveToLocalStorage() {
  try {
    const user = auth.currentUser;
    if (!user) console.warn('Not authenticated, saving locally only');
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    // Sin instalación activa no se escribe en Firebase
    if (INST() === 'default') return;
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Persiste el equiposDb en localStorage
function guardarEquiposDb() {
  (function backupEquipos(){
    try {
      const key = 'equipos_backup_' + Date.now();
      localStorage.setItem(key, JSON.stringify(window.equiposDb.equiposGuardados || []));
      const backups = Object.keys(localStorage)
        .filter(k => k.startsWith('equipos_backup_'))
        .sort();
      while (backups.length > 5) { localStorage.removeItem(backups.shift()); }
    } catch(e) { console.warn('backupEquipos error:', e); }
  })();
  localStorage.setItem(LS_KEY_EQUIPOS, JSON.stringify(window.equiposDb));
}

// Helper: carga una referencia de Firebase una sola vez, con manejo de error
function _cargarDesdeFirebase(refPath, callback, label) {
  return new Promise((resolve) => {
    realDb.ref(refPath).once('value', (snapshot) => {
      callback(snapshot.val());
      resolve();
    }).catch((error) => {
      console.warn(`Unable to load ${label} from Firebase:`, error);
      resolve();
    });
  });
}

// Aplica el stock recibido de Firebase en memoria y localStorage
function _aplicarStockFirebase(firebaseStock) {
  if (!Array.isArray(firebaseStock)) return;
  const saved = localStorage.getItem(LS_KEY_EQUIPOS);
  if (!saved) return;
  const edb = JSON.parse(saved);
  edb.equiposGuardados = firebaseStock;
  localStorage.setItem(LS_KEY_EQUIPOS, JSON.stringify(edb));
  if (window.equiposDb) window.equiposDb.equiposGuardados = firebaseStock;
  updateStockIcon();
}

// Lee desde localStorage y luego sincroniza con Firebase
async function loadFromLocalStorage() {
  try {
    await new Promise((resolve) => auth.onAuthStateChanged(() => resolve()));

    // Sin instalación activa → no cargar nada, esperar selección
    if (INST() === 'default') {
      console.log('[session] No hay instalación activa, omitiendo carga');
      return;
    }

    const data = localStorage.getItem(LS_KEY_APP);
    if (data) {
      console.log('Loading data from localStorage:', data);
      const loadedData = JSON.parse(data);

      // Saneamiento de arrays
      loadedData.mantenimientosPeriodicos = Array.isArray(loadedData.mantenimientosPeriodicos)
        ? loadedData.mantenimientosPeriodicos.filter(m => m && m.accion && m.equipo && m.fecha && m.periodicidad)
        : [];
      ['operarios', 'familias', 'zonas', 'equipos', 'items', 'workOrders', 'workOrdersAverias', 'workOrdersTareas'].forEach(key => {
        loadedData[key] = Array.isArray(loadedData[key]) ? loadedData[key].filter(Boolean) : [];
      });
      loadedData.pendingRecords = loadedData.pendingRecords || {
        incidencias: [], rutinas: [], preventivos: [], correctivos: [], modificativos: [], workorders: []
      };

      // Migración: añadir campos nuevos a datos existentes sin romper nada
      loadedData.workOrders = (loadedData.workOrders || []).map(wo => {
        if (!wo) return wo;
        return {
          ...wo,
          fechaProgramada:  wo.fechaProgramada  ?? wo.fecha ?? null,
          fechaCreacion:    wo.fechaCreacion     ?? null,
          fechaEjecucion:   wo.fechaEjecucion    ?? null,
          spareParts:       wo.spareParts        ?? []
        };
      });
      loadedData.mantenimientosPeriodicos = (loadedData.mantenimientosPeriodicos || []).map(m => {
        if (!m) return m;
        return {
          ...m,
          fechaUltimaEjecucion: m.fechaUltimaEjecucion ?? m.fecha ?? null,
          historial:            m.historial             ?? []
        };
      });

      loadedData.historialEquipos = (loadedData.historialEquipos && typeof loadedData.historialEquipos === 'object')
        ? loadedData.historialEquipos : {};

      Object.assign(db, loadedData);

      reconstruirMantenimientos();

      console.log('Loaded database:', db);
      actualizarListaMantenimientos();
    }

    // ── CARGA FIREBASE: Lee directamente de instalaciones/${INST()} ──────────────
    // Lee SIEMPRE desde instalaciones/${INST()} — sin fallback a edarData
    async function _leerConFallback(clave) {
      if (INST() === 'default') return null; // sin instalación → nada
      const snap = await realDb.ref(`instalaciones/${INST()}/${clave}`).once('value').catch(() => null);
      return snap ? snap.val() : null;
    }

    // workOrders
    const _wo = await _leerConFallback('workOrders');
    if (Array.isArray(_wo)) {
      db.workOrders = _wo.filter(wo => wo !== null && wo !== undefined);
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    }

    // workOrdersAverias
    const _woa = await _leerConFallback('workOrdersAverias');
    if (_woa !== null) {
      db.workOrdersAverias = Array.isArray(_woa) ? _woa.filter(Boolean) : [];
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    }

    // workOrdersTareas
    const _wot = await _leerConFallback('workOrdersTareas');
    if (_wot !== null) {
      db.workOrdersTareas = Array.isArray(_wot) ? _wot.filter(Boolean) : [];
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    }

    // mantenimientosPeriodicos
    const _mant = await _leerConFallback('mantenimientosPeriodicos');
    if (Array.isArray(_mant)) {
      db.mantenimientosPeriodicos = _mant.filter(m => m && m.accion);
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    }

    // equiposDb (estructura biblioteca)
    const _edb = await _leerConFallback('equiposDb');
    if (_edb) { window.equiposDb = _edb; guardarEquiposDb(); }

    // stock (equiposGuardados — inventario con cantidades)
    const _stock = await _leerConFallback('stock');
    if (Array.isArray(_stock) && window.equiposDb) {
      window.equiposDb.equiposGuardados = _stock;
      guardarEquiposDb();
      updateStockIcon();
    }

    // Leer equiposDb desde localStorage si Firebase no tenía nada
    const savedEquiposDb = localStorage.getItem(LS_KEY_EQUIPOS);
    if (savedEquiposDb && !_edb) window.equiposDb = JSON.parse(savedEquiposDb);

    updateStockIcon();

    // historialEquipos
    try {
      const _hist = await _leerConFallback('historialEquipos');
      if (_hist && typeof _hist === 'object') db.historialEquipos = _hist;
    } catch(e) { console.warn('historialEquipos load error:', e); }

    // Listeners se registran solo al entrar (ver enterBtn)

  } catch (error) {
    console.error('Error loading data:', error);
    console.log('Current database state:', db);
  }
}


/* =============================================================================
   5. EXCEL / GITHUB — exportación de informes
============================================================================= */

async function uploadToGitHub(path, content, message) {
  const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${path}`;
  const headers = {
    'Authorization': `token ${GITHUB_CONFIG.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  // GET to obtain SHA (needed for update); 404 means file doesn't exist yet — that's fine
  let sha = null;
  const getRes = await fetch(url, { headers });
  if (getRes.ok) {
    const fileData = await getRes.json();
    sha = fileData.sha;
  } else if (getRes.status !== 404) {
    // Any status other than 404 is unexpected
    throw new Error(`GitHub GET error: ${getRes.status}`);
  }

  const body = { message, content, branch: GITHUB_CONFIG.branch };
  if (sha) body.sha = sha;

  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub PUT error ${putRes.status}: ${errText}`);
  }
  return putRes.json();
}

// Exporta una fila a un único archivo Excel persistente en GitHub (append)
async function _exportarInformeGitHub(nuevaFila, nombreHoja, archivo, mensajeGit, mensajeExito) {
  try {
    const path = `instalaciones/${INST()}/${archivo}.xlsx`;
    const url  = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${path}`;
    const headers = {
      'Authorization': `token ${GITHUB_CONFIG.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // Single GET: SHA + existing rows
    let sha = null;
    let rows = [];
    const getRes = await fetch(url, { headers });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      const raw = Uint8Array.from(atob(fileData.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      const wb  = XLSX.read(raw, { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else if (getRes.status !== 404) {
      throw new Error(`GitHub GET error: ${getRes.status}`);
    }

    rows.push(nuevaFila);
    const encoded = await blobToBase64(crearExcelBlob(rows, nombreHoja));
    const body = { message: mensajeGit, content: encoded, branch: GITHUB_CONFIG.branch };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!putRes.ok) throw new Error(`GitHub PUT error ${putRes.status}: ${await putRes.text()}`);
    alert(mensajeExito);
  } catch (error) {
    console.error(`Error exporting ${archivo}:`, error);
    alert(`Error al exportar: ${error.message}`);
  }
}

// Descarga un fichero localmente sin pasar por GitHub
function _descargarLocal(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportarWorkOrderToExcel(workOrder) {
  const fila = {
    Fecha:            workOrder.fechaEjecucion || workOrder.fecha || '',
    Equipo:           workOrder.equipo || '',
    Descripcion:      workOrder.descripcion || '',
    Tipo:             workOrder.tipo || 'parte',
    Operario:         workOrder.operario || '',
    Material:         workOrder.material || '',
    RecambiosUsados:  (workOrder.spareParts || []).map(p => `${p.nombre}:${p.cantidad}`).join(', ')
  };
  // Reuses _exportarInformeGitHub for consistent append logic; throws on failure
  // so completeWorkOrder can catch and show specific message
  const instActiva = localStorage.getItem('instalacionActiva') || INST();
  const path = `instalaciones/${instActiva}/partes`;
  const url  = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${path}.xlsx`;
  const headers = {
    'Authorization': `token ${GITHUB_CONFIG.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
  let sha = null; let rows = [];
  const getRes = await fetch(url, { headers });
  if (getRes.ok) {
    const fd = await getRes.json(); sha = fd.sha;
    const raw = Uint8Array.from(atob(fd.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    rows = XLSX.utils.sheet_to_json(XLSX.read(raw, { type: 'array' }).Sheets[XLSX.read(raw, { type: 'array' }).SheetNames[0]]);
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub GET error: ${getRes.status}`);
  }
  rows.push(fila);
  const encoded = await blobToBase64(crearExcelBlob(rows, 'Partes'));
  const body = { message: `Parte completado: ${workOrder.equipo}`, content: encoded, branch: GITHUB_CONFIG.branch };
  if (sha) body.sha = sha;
  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) throw new Error(`GitHub PUT error ${putRes.status}: ${await putRes.text()}`);
  console.log('partes.xlsx actualizado en GitHub');
}

// --- Exportadores por tipo de informe ---

async function exportarIncidenciaGitHub() {
  const fecha      = document.getElementById('fechaIncidencia').value;
  const operario   = document.getElementById('operarioIncidencia').value;
  const equipo     = document.getElementById('incidenciaEquipo').value;
  const descripcion = document.getElementById('descripcionIncidencia').value;
  if (!fecha || !operario || !descripcion) { alert('Por favor complete todos los campos'); return; }
  await _exportarInformeGitHub(
    { Fecha: fecha, Operario: operario, Descripcion: descripcion },
    'Incidencias', 'incidencias', 'Add incident report', 'Incidencia exportada a GitHub con éxito'
  );
}

async function exportarIncidenciaLocal() {
  const fecha      = document.getElementById('fechaIncidencia').value;
  const operario   = document.getElementById('operarioIncidencia').value;
  const equipo     = document.getElementById('incidenciaEquipo').value;
  const descripcion = document.getElementById('descripcionIncidencia').value;
  if (!fecha || !operario || !equipo || !descripcion) { alert('Por favor complete todos los campos'); return; }
  try {
    const blob = crearExcelBlob([{ Fecha: fecha, Operario: operario, Equipo: equipo, Descripcion: descripcion }], 'Incidencia');
    _descargarLocal(blob, `incidencia_${Date.now()}.xlsx`);
    alert('Incidencia descargada con éxito');
  } catch (error) {
    console.error('Error downloading incident:', error);
    alert('Error al descargar la incidencia: ' + error.message);
  }
}

async function exportarRutinaGitHub() {
  const fecha      = document.getElementById('fechaRutina').value;
  const operario   = _sesionAutor().nombre || _sesionAutor().email;
  const equipo     = document.getElementById('rutinaEquipo').value;
  const descripcion = document.getElementById('descripcionRutina').value;
  if (!fecha || !descripcion) { alert('Por favor complete todos los campos'); return; }
  await _exportarInformeGitHub(
    { Fecha: fecha, Operario: operario, Descripcion: descripcion },
    'Rutinas', 'rutinas', 'Add routine report', 'Rutina exportada a GitHub con éxito'
  );
}

async function exportarPreventivoGitHub() {
  const fecha      = document.getElementById('fechaPreventivo').value;
  const operario   = document.getElementById('operarioPreventivo').value;
  const equipo     = document.getElementById('preventivoEquipo').value;
  const descripcion = document.getElementById('descripcionPreventivo').value;
  const gravedad   = document.getElementById('gravedadPreventivo').value;
  if (!fecha || !operario || !equipo || !descripcion) { alert('Por favor complete todos los campos'); return; }
  if (equipo) {
    try {
      await _guardarHistorialEquipo(equipo, { fecha, descripcion, tipo: 'preventivo' });
    } catch(e) { console.warn('historial preventivo error:', e); }
  }
  await _exportarInformeGitHub(
    { Fecha: fecha, Operario: operario, Equipo: equipo, Descripcion: descripcion,
      CreadoPorUid: _sesionAutor().uid, CreadoPorNombre: _sesionAutor().nombre, CreadoPorEmail: _sesionAutor().email },
    'Preventivos', 'preventivos', 'Add preventive maintenance report', 'Preventivo exportado a GitHub con éxito'
  );
}
async function exportarCorrectivoGitHub() {
  const fecha      = document.getElementById('fechaCorrectivo').value;
  const operario   = document.getElementById('operarioCorrectivo').value;
  const equipo     = document.getElementById('correctivoEquipo').value;
  const descripcion = document.getElementById('descripcionCorrectivo').value;
  const gravedad   = document.getElementById('gravedadCorrectivo').value;
  const solucion   = document.getElementById('solucionCorrectivo').value;
  const averia   = document.getElementById('averiaCorrectivo')     ? document.getElementById('averiaCorrectivo').value     : '';
  const causa    = document.getElementById('causaCorrectivo')      ? document.getElementById('causaCorrectivo').value      : '';
  const fechaFin = document.getElementById('fechaFinCorrectivo')   ? document.getElementById('fechaFinCorrectivo').value   : '';
  if (!fecha || !equipo || !descripcion) { alert('Por favor complete todos los campos'); return; }
  if (equipo) {
    try {
      await _guardarHistorialEquipo(equipo, { fecha: fechaFin || fecha, descripcion, tipo: 'correctivo' });
    } catch(e) { console.warn('historial correctivo error:', e); }
  }
  await _exportarInformeGitHub(
    { Equipo: equipo, FechaInicio: fecha, Averia: averia, Causa: causa, FechaFin: fechaFin, Descripcion: descripcion,
      CreadoPorUid: _sesionAutor().uid, CreadoPorNombre: _sesionAutor().nombre, CreadoPorEmail: _sesionAutor().email },
    'Correctivos', 'correctivos', 'Add corrective maintenance report', 'Correctivo exportado a GitHub con éxito'
  );
}

async function exportarModificativoGitHub() {
  const fecha      = document.getElementById('fechaModificativo').value;
  const operario   = document.getElementById('operarioModificativo').value;
  const equipo     = document.getElementById('equipoModificativo').value;
  const descripcion = document.getElementById('descripcionModificativo').value;
  const motivo     = document.getElementById('motivoModificativo').value;
  const averia   = document.getElementById('averiaModificativo')   ? document.getElementById('averiaModificativo').value   : '';
  const causa    = document.getElementById('causaModificativo')    ? document.getElementById('causaModificativo').value    : '';
  const fechaFin = document.getElementById('fechaFinModificativo') ? document.getElementById('fechaFinModificativo').value : '';
  if (!fecha || !equipo || !descripcion) { alert('Por favor complete todos los campos'); return; }
  if (equipo) {
    try {
      await _guardarHistorialEquipo(equipo, { fecha: fechaFin || fecha, descripcion, tipo: 'modificativo' });
    } catch(e) { console.warn('historial modificativo error:', e); }
  }
  await _exportarInformeGitHub(
    { Equipo: equipo, FechaInicio: fecha, Averia: averia, Causa: causa, FechaFin: fechaFin, Descripcion: descripcion,
      CreadoPorUid: _sesionAutor().uid, CreadoPorNombre: _sesionAutor().nombre, CreadoPorEmail: _sesionAutor().email },
    'Modificativos', 'modificativos', 'Add modificative maintenance report', 'Modificativo exportado a GitHub con éxito'
  );
}

async function exportarBackup() {
  try {
    const backupData = {
      equipos: window.equiposDb.equiposGuardados || [],
      mantenimientos: db.mantenimientosPeriodicos || []
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    _descargarLocal(blob, `EDAR_backup_${new Date().toISOString().split('T')[0]}.json`);
    alert('Backup exportado con éxito');
  } catch (error) {
    console.error('Error al exportar backup:', error);
    alert('Error al exportar el backup: ' + error.message);
  }
}

async function importarBackup() {
  const fileInput = document.getElementById('backupFileInput');
  const file = fileInput.files[0];
  if (!file) { alert('Por favor seleccione un archivo'); return; }
  try {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || (!data.equipos && !data.mantenimientos)) throw new Error('Formato de archivo inválido');
        if (data.equipos && Array.isArray(data.equipos)) {
          window.equiposDb.equiposGuardados = data.equipos;
          await realDb.ref(`instalaciones/${INST()}/equiposDb`).set(window.equiposDb);
          guardarEquiposDb();
        }
        if (data.mantenimientos && Array.isArray(data.mantenimientos)) {
          db.mantenimientosPeriodicos = data.mantenimientos;
          await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(data.mantenimientos);
          localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
        }
        alert('Backup importado con éxito');
        actualizarListaMantenimientos();
        actualizarListaEquipos();
        updateStockIcon();
        updateNotificationIcons();
        fileInput.value = '';
      } catch (error) {
        console.error('Error parsing backup file:', error);
        alert('Error al procesar el archivo de backup: ' + error.message);
      }
    };
    reader.readAsText(file);
  } catch (error) {
    console.error('Error al importar backup:', error);
    alert('Error al importar el backup: ' + error.message);
  }
}


/* =============================================================================
   6. UI — POPUPS
============================================================================= */

// Crea y muestra un popup genérico; devuelve el contenedor de contenido
function _crearPopup(titulo) {
  const existing = document.querySelector('.notification-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'notification-popup';
  popup.innerHTML = `
    <h3>${titulo}</h3>
    <div id="popupContent"></div>
    <button class="button" onclick="closePopup(this)">Cerrar</button>
  `;
  document.body.appendChild(popup);
  popup.style.display = 'block';
  popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  return popup.querySelector('#popupContent');
}


function closePopup(buttonElement) {
  const popup = buttonElement.closest('.notification-popup');
  if (popup) popup.remove();
}

function showPendingWorkOrders() {
  const content = _crearPopup('Partes de Trabajo Pendientes');

  const pendingOrders = ordenarPorPropiedad(
    _filtrarPorRol((db.workOrders || []).filter(o => o && o.estado === 'pendiente' && o.familia !== 'MANTENIMIENTO')),
    'equipo'
  );

  if (!pendingOrders.length) {
    content.innerHTML = '<p>No hay partes de trabajo pendientes</p>';
    return;
  }

  pendingOrders.forEach(order => {
    const photoHtml = order.photo
      ? `<div class="work-order-photos"><img src="${order.photo}" class="work-order-photo" onclick="showPhotoModal('${order.photo}')" alt="Foto del parte de trabajo"></div>`
      : '';
    const div = document.createElement('div');
    div.className = 'pending-record overdue';
    div.dataset.id = order.id;
    div.innerHTML = `
      <h4>${order.equipo || ''}</h4>
      <p><strong>Programado:</strong> ${order.fechaProgramada || order.fecha || ''} &nbsp;|&nbsp; <strong>Creado:</strong> ${order.fechaCreacion ? order.fechaCreacion.split('T')[0] : ''}</p>
      <p>Operario: <input type="text" value="${order.operario || ''}" onchange="updateWorkOrderOperator(${order.id}, this.value)"></p>
      <p>Descripción: ${order.descripcion || ''}</p>
      <p>Estado: ${order.estado || ''}</p>
      ${photoHtml}
      <button class="button" onclick="editWorkOrder(${order.id})">Editar</button>
      <button class="button" onclick="completeWorkOrder(${order.id}, this)">Marcar como completado</button>
      <div class="work-order-edit-form" id="edit-form-${order.id}">
        <div class="form-group">
          <label>Descripción:</label>
          <textarea id="edit-description-${order.id}">${order.descripcion || ''}</textarea>
        </div>
        <div class="form-group">
          <label>Operario:</label>
          <input type="text" id="edit-operator-${order.id}" value="${order.operario || ''}">
        </div>
        <div class="form-group">
          <label>Consumo de Recambios:</label>
          <select id="spare-part-${order.id}">
            <option value="">Seleccionar recambio</option>
            ${getSparePartsOptions(order.equipo)}
          </select>
          <input type="number" id="spare-part-quantity-${order.id}" placeholder="Cantidad" min="1">
          <button class="button" onclick="addSparePart(${order.id})">Añadir Recambio</button>
        </div>
        <div id="spare-parts-list-${order.id}" class="spare-parts-list">
          ${renderUsedSpareParts(order.spareParts || [])}
        </div>
        <div class="edit-delete-buttons">
          <button class="button" onclick="saveWorkOrderChanges(${order.id})">Guardar Cambios</button>
          <button class="button" onclick="cancelWorkOrderEdit(${order.id})">Cancelar</button>
        </div>
      </div>
    `;
    content.appendChild(div);
  });
}

async function showPendingMaintenances() {
  const content = _crearPopup('Mantenimientos Pendientes');

  if (!db.mantenimientosPeriodicos || !Array.isArray(db.mantenimientosPeriodicos)) {
    content.innerHTML = '<p>No hay mantenimientos vencidos</p>';
    return;
  }

  const vencidos = ordenarPorPropiedad(
    _filtrarPorRol((db.mantenimientosPeriodicos || []).filter(m => m && m.tipo === 'preventivo' && esMantenimientoVencido(m))),
    'equipo'
  );

  if (!vencidos.length) {
    content.innerHTML = '<p>No hay preventivos vencidos</p>';
    return;
  }

  vencidos.forEach(m => {
    if (!m) return;
    const nextDate = calcularProximaFecha(m);
    const div = document.createElement('div');
    div.className = 'pending-record overdue';
    div.innerHTML = `
      <h4>${m.equipo}</h4>
      <p>Operario: <input type="text" value="${m.operario || ''}" onchange="updateMaintenanceOperator('${m.id}', this.value)"></p>
      <p><strong>Acción:</strong> ${m.accion}</p>
      <p><strong>Periodicidad:</strong> ${m.periodicidad} días</p>
      <p><strong>Última ejecución:</strong> ${m.fechaUltimaEjecucion || m.fecha || '—'}</p>
      <p><strong>Fecha prevista:</strong> ${nextDate.toLocaleDateString()}</p>
      <p><strong>Ejecuciones registradas:</strong> ${(m.historial || []).length}</p>
      <div class="edit-delete-buttons">
        <button class="button" onclick="completeMaintenance('${m.id}', this)">Marcar como completado</button>
      </div>
    `;
    content.appendChild(div);
  });
}

function showStockAlerts() {
  const content = _crearPopup('Alertas de Stock');

  if (!window.equiposDb || !window.equiposDb.equiposGuardados) {
    content.innerHTML = '<p>No hay datos de inventario disponibles</p>';
    return;
  }

  const outOfStockItems = [];
  window.equiposDb.equiposGuardados.forEach(equipo => {
    if (!equipo) return;
    if (equipo.cantidad === 0) {
      outOfStockItems.push({ equipo: equipo.equipo, recambio: equipo.recambio, cantidad: 0 });
    }
    if (equipo.recambios && Array.isArray(equipo.recambios)) {
      equipo.recambios.forEach(r => {
        if (r.cantidad === 0) outOfStockItems.push({ equipo: equipo.equipo, recambio: r.nombre, cantidad: 0 });
      });
    }
  });

  if (!outOfStockItems.length) {
    content.innerHTML = '<p>No hay items sin stock</p>';
    return;
  }

  ordenarPorPropiedad(outOfStockItems, 'equipo').forEach(item => {
    const div = document.createElement('div');
    div.className = 'stock-info';
    div.innerHTML = `<h4>${item.equipo}</h4><p>Recambio: ${item.recambio}</p><p>Stock: ${item.cantidad}</p>`;
    content.appendChild(div);
  });
}

function showPhotoModal(photoUrl) {
  const modal = document.createElement('div');
  modal.className = 'photo-modal';
  modal.innerHTML = `
    <button class="photo-modal-close" onclick="this.parentElement.remove()">×</button>
    <img src="${photoUrl}" alt="Foto ampliada">
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}


/* =============================================================================
   7. UI — ICONOS DE NOTIFICACIÓN
============================================================================= */

// Aplica o elimina la clase 'has-notifications' en un elemento icono
function _setIconEstado(iconEl, activo) {
  if (!iconEl) return;
  if (activo) {
    iconEl.classList.add('has-notifications');
    iconEl.style.color = '#0055a4';
  } else {
    iconEl.classList.remove('has-notifications');
    iconEl.style.color = 'white';
  }
}

function updateNotificationIcons() {
  // Sin instalación activa, no mostrar nada
  if (INST() === 'default') {
    ['maintenanceIcon','tareasProgramadasIcon','workOrderIconAverias','workOrderIconTareas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-notifications'); el.style.color = ''; }
    });
    return;
  }
  const tienePreventivos = (db.mantenimientosPeriodicos || []).some(m => m && m.tipo === 'preventivo' && esMantenimientoVencido(m));
  _setIconEstado(document.getElementById('maintenanceIcon'), tienePreventivos);

  const tieneTareasProg = (db.mantenimientosPeriodicos || []).some(m => m && m.tipo === 'trabajo' && esMantenimientoVencido(m));
  _setIconEstado(document.getElementById('tareasProgramadasIcon'), tieneTareasProg);

  if (!tienePreventivos && !tieneTareasProg) {
    const popup = document.querySelector('.notification-popup');
    if (popup) popup.remove();
  }

  const tieneAverias = (db.workOrdersAverias || []).some(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'));
  _setIconEstado(document.getElementById('workOrderIconAverias'), tieneAverias);

  const tiene = (db.workOrdersTareas || []).some(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'));
  _setIconEstado(document.getElementById('workOrderIconTareas'), tiene);
}

window.updateNotificationIcons = updateNotificationIcons;
window.actualizarDatalistEquipos        = actualizarDatalistEquipos;
window.poblarSelectEquiposJerarquico    = poblarSelectEquiposJerarquico;
window.showPendingAverias      = showPendingAverias;
window.showPendingTareas               = showPendingTareas;
window._aplicarFiltroPendientesAverias = _aplicarFiltroPendientesAverias;
window._aplicarFiltroPendientesTareas  = _aplicarFiltroPendientesTareas;
window.renderMantenimientosSeparados   = renderMantenimientosSeparados;
window.reconstruirMantenimientos       = reconstruirMantenimientos;

function showPreventivosEquipos() {
  const content = _crearPopup('Preventivos de Equipos');
  const vencidos = (db.mantenimientosPeriodicos || []).filter(m =>
    m && m.tipo === 'preventivo' && esMantenimientoVencido(m)
  );
  if (!vencidos.length) { content.innerHTML = '<p>No hay preventivos vencidos</p>'; return; }
  vencidos.forEach(m => {
    const nextDate = calcularProximaFecha(m);
    const div = document.createElement('div');
    div.className = 'pending-record overdue';
    const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
    const asigHtml = esAdmin
      ? '<div class="work-order-edit-form" id="asig-form-' + m.id + '" style="display:none;margin-top:8px">'
        + '<div class="form-group"><label>Asignado a (usuario(s) sistema):</label><div id="asig-sel-' + m.id + '" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px"></div></div>'
        + '<div class="form-group"><label>Asignado a (externo / turno):</label><input type="text" id="asig-ext-' + m.id + '" value="' + (m.asignadoAExterno || '') + '" placeholder="Ej: Tecnicwater, Turno tarde..."></div>'
        + '<button class="button button--sm" onclick="guardarAsignacionIcono(\'' + m.id + '\')">💾 Guardar asignación</button>'
        + '</div>'
      : '';
    div.innerHTML = `
      <h4>${m.equipo}</h4>
      <p><strong>Acción:</strong> ${m.accion}</p>
      <p><strong>Periodicidad:</strong> ${m.periodicidad} días</p>
      <p><strong>Próxima fecha:</strong> ${nextDate.toLocaleDateString()}</p>
      <p><strong>Asignado a:</strong> ${_getAsignadosNombres(m).join(', ') || m.asignadoAExterno || '<span class="opacity-muted">Sin asignar</span>'}</p>
      ${esAdmin ? '<button class="button" onclick="toggleAsigForm(\'' + m.id + '\')">👤 Asignar</button>' : ''}
      <button class="button" onclick="completeMaintenance('${m.id}', this)">Marcar como completado</button>
    ` + asigHtml;
    content.appendChild(div);
  });
}

// Alias para compatibilidad con onclick en HTML
function showPendingPreventivos() { showPreventivosEquipos(); }

function showTareasProgramadas() {
  const content = _crearPopup('Trabajos Periódicos');
  const vencidos = (db.mantenimientosPeriodicos || []).filter(m =>
    m && m.tipo === 'trabajo' && esMantenimientoVencido(m)
  );
  if (!vencidos.length) { content.innerHTML = '<p>No hay trabajos periódicos vencidos</p>'; return; }
  vencidos.forEach(m => {
    const nextDate = calcularProximaFecha(m);
    const div = document.createElement('div');
    div.className = 'pending-record overdue';
    const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
    const asigHtml = esAdmin
      ? '<div class="work-order-edit-form" id="asig-form-' + m.id + '" style="display:none;margin-top:8px">'
        + '<div class="form-group"><label>Asignado a (usuario(s) sistema):</label><div id="asig-sel-' + m.id + '" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px"></div></div>'
        + '<div class="form-group"><label>Asignado a (externo / turno):</label><input type="text" id="asig-ext-' + m.id + '" value="' + (m.asignadoAExterno || '') + '" placeholder="Ej: Tecnicwater, Turno tarde..."></div>'
        + '<button class="button button--sm" onclick="guardarAsignacionIcono(\'' + m.id + '\')">💾 Guardar asignación</button>'
        + '</div>'
      : '';
    div.innerHTML = `
      <h4>${m.equipo || m.accion || 'Trabajo periódico'}</h4>
      <p><strong>Acción:</strong> ${m.accion || '—'}</p>
      <p><strong>Periodicidad:</strong> ${m.periodicidad} días</p>
      <p><strong>Próxima fecha:</strong> ${nextDate.toLocaleDateString()}</p>
      <p><strong>Asignado a:</strong> ${_getAsignadosNombres(m).join(', ') || m.asignadoAExterno || '<span class="opacity-muted">Sin asignar</span>'}</p>
      ${esAdmin ? '<button class="button" onclick="toggleAsigForm(\'' + m.id + '\')">👤 Asignar</button>' : ''}
      <button class="button" onclick="completeMaintenance('${m.id}', this)">Marcar como completado</button>
    ` + asigHtml;
    content.appendChild(div);
  });
}

window.showPreventivosEquipos  = showPreventivosEquipos;
window.showPendingPreventivos   = showPendingPreventivos;
window.showTareasProgramadas   = showTareasProgramadas;
window.checkPendingAverias     = checkPendingAverias;
window.checkPendingTareas      = checkPendingTareas;

async function toggleAsigForm(id) {
  const f = document.getElementById('asig-form-' + id);
  if (!f) return;
  const abrir = f.style.display === 'none';
  f.style.display = abrir ? 'block' : 'none';
  if (abrir) {
    const sel = document.getElementById('asig-sel-' + id);
    if (sel && !sel.dataset.cargado) {
      const m = db.mantenimientosPeriodicos.find(m => String(m.id) === String(id));
      await _cargarOperariosCheckboxes('asig-sel-' + id, _getAsignadosUids(m));
      sel.dataset.cargado = '1';
    }
  }
}

async function guardarAsignacionIcono(id) {
  const idx = db.mantenimientosPeriodicos.findIndex(m => String(m.id) === String(id));
  if (idx === -1) { alert('No encontrado.'); return; }
  const sel     = document.getElementById('asig-sel-' + id);
  const ext     = document.getElementById('asig-ext-' + id);
  const marcados = sel ? Array.from(sel.querySelectorAll('input[type=checkbox]:checked')) : [];
  const uids    = marcados.map(c => c.value);
  const nombres = marcados.map(c => c.dataset.nombre);
  const extVal  = ext?.value.trim() || '';
  db.mantenimientosPeriodicos[idx].asignadoAUids    = uids;
  db.mantenimientosPeriodicos[idx].asignadoANombres = nombres;
  db.mantenimientosPeriodicos[idx].asignadoAExterno = uids.length ? '' : extVal;
  // Limpieza de campos antiguos para evitar inconsistencia de datos
  delete db.mantenimientosPeriodicos[idx].asignadoAUid;
  delete db.mantenimientosPeriodicos[idx].asignadoANombre;
  try {
    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    await saveToLocalStorage();
    alert('✅ Asignación guardada.');
    toggleAsigForm(id);
    const p = document.querySelector('.notification-popup');
    if (p) p.remove();
    updateNotificationIcons();
  } catch(e) { alert('Error: ' + e.message); }
}
window.toggleAsigForm          = toggleAsigForm;
window.guardarAsignacionIcono  = guardarAsignacionIcono;



function checkPendingWorkOrders() {
  // kept for compatibility — delegates to split functions
  checkPendingAverias();
  checkPendingTareas();
}

function checkPendingAverias() {
  const tiene = (db.workOrdersAverias || []).some(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'));
  _setIconEstado(document.getElementById('workOrderIconAverias'), tiene);
  if (!tiene) {
    const popup = document.querySelector('.notification-popup');
    if (popup) popup.remove();
  }
}

function checkPendingTareas() {
  const tiene = (db.workOrdersTareas || []).some(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'));
  _setIconEstado(document.getElementById('workOrderIconTareas'), tiene);
  if (!tiene) {
    const popup = document.querySelector('.notification-popup');
    if (popup) popup.remove();
  }
}

let _pendAveriasCache = [];
let _pendTareasCache  = [];

function showPendingAverias() {
  const content = _crearPopup('Partes de Avería Pendientes');
  _pendAveriasCache = ordenarPorPropiedad(
    _filtrarPorRol((db.workOrdersAverias || []).filter(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'))),
    'equipo'
  );
  if (!_pendAveriasCache.length) { content.innerHTML = '<p>No hay partes de avería pendientes</p>'; return; }

  const asignados = [...new Set(_pendAveriasCache.flatMap(o => _getAsignadosNombres(o)))].filter(Boolean);
  content.innerHTML = `
    <div class="pending-filter-bar">
      <select id="pendFiltroEstadoAv" onchange="_aplicarFiltroPendientesAverias()">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_curso">En curso</option>
      </select>
      <select id="pendFiltroAsigAv" onchange="_aplicarFiltroPendientesAverias()">
        <option value="">Todos los asignados</option>
        ${asignados.map(n => `<option value="${n}">${n}</option>`).join('')}
      </select>
      <select id="pendFiltroOrdenAv" onchange="_aplicarFiltroPendientesAverias()">
        <option value="equipo">Ordenar: Equipo</option>
        <option value="fechaProgramada">Ordenar: Fecha programada</option>
      </select>
    </div>
    <div id="pendListAv"></div>
  `;
  _aplicarFiltroPendientesAverias();
}

function _aplicarFiltroPendientesAverias() {
  const estado = document.getElementById('pendFiltroEstadoAv')?.value || '';
  const asig   = document.getElementById('pendFiltroAsigAv')?.value || '';
  const orden  = document.getElementById('pendFiltroOrdenAv')?.value || 'equipo';
  const cont   = document.getElementById('pendListAv');
  if (!cont) return;

  let lista = _pendAveriasCache.filter(o => {
    if (estado && (o.estado || 'pendiente') !== estado) return false;
    if (asig && !_getAsignadosNombres(o).includes(asig)) return false;
    return true;
  });
  lista = ordenarPorPropiedad(lista, orden);

  cont.innerHTML = '';
  if (!lista.length) { cont.innerHTML = '<p>No hay partes que coincidan con el filtro</p>'; return; }
  lista.forEach(order => cont.appendChild(_crearItemPendienteAveria(order)));
}

function _crearItemPendienteAveria(order) {
  const photoHtml = order.photo
    ? `<div class="work-order-photos"><img src="${order.photo}" class="work-order-photo" onclick="showPhotoModal('${order.photo}')" alt="Foto"></div>`
    : '';
  const div = document.createElement('div');
  div.className = 'pending-record overdue';
  div.dataset.id = order.id;
  const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
  div.innerHTML = `
    <h4>${order.equipo || ''}</h4>
    <p><strong>Programado:</strong> ${order.fechaProgramada || order.fecha || ''} &nbsp;|&nbsp; <strong>Creado:</strong> ${order.fechaCreacion ? order.fechaCreacion.split('T')[0] : ''}</p>
    <p><strong>Descripción:</strong> ${order.descripcion || ''}</p>
    <p><strong>Estado:</strong> ${order.estado || ''}</p>
    <p><strong>Asignado a:</strong> ${_getAsignadosNombres(order).join(', ') || order.asignadoAExterno || '<span class="opacity-muted">Sin asignar</span>'}</p>
    ${photoHtml}
    <button class="button" onclick="editWorkOrder(${order.id})">Editar</button>
    <button class="button" onclick="completeWorkOrder(${order.id}, this)">Marcar como completado</button>
    <div class="work-order-edit-form" id="edit-form-${order.id}">
      <div class="form-group"><label>Descripción:</label><textarea id="edit-description-${order.id}">${order.descripcion || ''}</textarea></div>
      <div class="form-group"><label>Operario:</label><input type="text" id="edit-operator-${order.id}" value="${order.operario || ''}" ${esAdmin ? '' : 'readonly class="opacity-muted"'}></div>
      ${esAdmin ? `
      <div class="form-group"><label>Asignado a (usuario(s) sistema):</label><div id="edit-asignado-${order.id}" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px"></div></div>
      <div class="form-group"><label>Asignado a (externo / empresa):</label><input type="text" id="edit-asignado-ext-${order.id}" value="${order.asignadoAExterno || ''}" placeholder="Ej: Tecnicwater"></div>
      ` : ''}
      <div class="form-group">
        <label>Consumo de Recambios:</label>
        <select id="spare-part-${order.id}"><option value="">Seleccionar recambio</option>${getSparePartsOptions(order.equipo)}</select>
        <input type="number" id="spare-part-quantity-${order.id}" placeholder="Cantidad" min="1">
        <button class="button" onclick="addSparePart(${order.id})">Añadir Recambio</button>
      </div>
      <div id="spare-parts-list-${order.id}" class="spare-parts-list">${renderUsedSpareParts(order.spareParts || [])}</div>
      <div class="edit-delete-buttons">
        <button class="button" onclick="saveWorkOrderChanges(${order.id})">Guardar Cambios</button>
        <button class="button" onclick="cancelWorkOrderEdit(${order.id})">Cancelar</button>
      </div>
    </div>
  `;
  return div;
}

function showPendingTareas() {
  const content = _crearPopup('Tareas Operativas Pendientes');
  _pendTareasCache = ordenarPorPropiedad(
    _filtrarPorRol((db.workOrdersTareas || []).filter(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'))),
    'equipo'
  );
  if (!_pendTareasCache.length) { content.innerHTML = '<p>No hay tareas operativas pendientes</p>'; return; }

  const asignados = [...new Set(_pendTareasCache.flatMap(o => _getAsignadosNombres(o)))].filter(Boolean);
  content.innerHTML = `
    <div class="pending-filter-bar">
      <select id="pendFiltroEstadoTa" onchange="_aplicarFiltroPendientesTareas()">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_curso">En curso</option>
      </select>
      <select id="pendFiltroAsigTa" onchange="_aplicarFiltroPendientesTareas()">
        <option value="">Todos los asignados</option>
        ${asignados.map(n => `<option value="${n}">${n}</option>`).join('')}
      </select>
      <select id="pendFiltroOrdenTa" onchange="_aplicarFiltroPendientesTareas()">
        <option value="equipo">Ordenar: Equipo</option>
        <option value="fechaProgramada">Ordenar: Fecha programada</option>
      </select>
    </div>
    <div id="pendListTa"></div>
  `;
  _aplicarFiltroPendientesTareas();
}

function _aplicarFiltroPendientesTareas() {
  const estado = document.getElementById('pendFiltroEstadoTa')?.value || '';
  const asig   = document.getElementById('pendFiltroAsigTa')?.value || '';
  const orden  = document.getElementById('pendFiltroOrdenTa')?.value || 'equipo';
  const cont   = document.getElementById('pendListTa');
  if (!cont) return;

  let lista = _pendTareasCache.filter(o => {
    if (estado && (o.estado || 'pendiente') !== estado) return false;
    if (asig && !_getAsignadosNombres(o).includes(asig)) return false;
    return true;
  });
  lista = ordenarPorPropiedad(lista, orden);

  cont.innerHTML = '';
  if (!lista.length) { cont.innerHTML = '<p>No hay tareas que coincidan con el filtro</p>'; return; }
  lista.forEach(order => cont.appendChild(_crearItemPendienteTarea(order)));
}

function _crearItemPendienteTarea(order) {
  const photoHtml = order.photo
    ? `<div class="work-order-photos"><img src="${order.photo}" class="work-order-photo" onclick="showPhotoModal('${order.photo}')" alt="Foto"></div>`
    : '';
  const div = document.createElement('div');
  div.className = 'pending-record overdue';
  div.dataset.id = order.id;
  const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
  div.innerHTML = `
    <h4>${order.equipo || ''}</h4>
    <p><strong>Programado:</strong> ${order.fechaProgramada || order.fecha || ''} &nbsp;|&nbsp; <strong>Creado:</strong> ${order.fechaCreacion ? order.fechaCreacion.split('T')[0] : ''}</p>
    <p><strong>Descripción:</strong> ${order.descripcion || ''}</p>
    <p><strong>Estado:</strong> ${order.estado || ''}</p>
    <p><strong>Asignado a:</strong> ${_getAsignadosNombres(order).join(', ') || order.asignadoAExterno || '<span class="opacity-muted">Sin asignar</span>'}</p>
    ${photoHtml}
    <button class="button" onclick="editWorkOrder(${order.id})">Editar</button>
    <button class="button" onclick="completeWorkOrder(${order.id}, this)">Marcar como completado</button>
    <div class="work-order-edit-form" id="edit-form-${order.id}">
      <div class="form-group"><label>Descripción:</label><textarea id="edit-description-${order.id}">${order.descripcion || ''}</textarea></div>
      <div class="form-group"><label>Operario:</label><input type="text" id="edit-operator-${order.id}" value="${order.operario || ''}" ${esAdmin ? '' : 'readonly class="opacity-muted"'}></div>
      ${esAdmin ? `
      <div class="form-group"><label>Asignado a (usuario(s) sistema):</label><div id="edit-asignado-${order.id}" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px"></div></div>
      <div class="form-group"><label>Asignado a (externo / empresa):</label><input type="text" id="edit-asignado-ext-${order.id}" value="${order.asignadoAExterno || ''}" placeholder="Ej: Tecnicwater"></div>
      ` : ''}
      <div class="form-group"><label>Material empleado / Aclaraciones:</label><textarea id="edit-material-${order.id}" rows="3" placeholder="Material empleado o aclaraciones...">${order.material || ''}</textarea></div>
      <div class="edit-delete-buttons">
        <button class="button" onclick="saveWorkOrderChanges(${order.id})">Guardar Cambios</button>
        <button class="button" onclick="cancelWorkOrderEdit(${order.id})">Cancelar</button>
      </div>
    </div>
  `;
  return div;
}

function updateStockIcon() {
  const stockIcon = document.getElementById('stockIcon');
  if (!stockIcon) return;

  const saved = localStorage.getItem(LS_KEY_EQUIPOS);
  if (!saved) { stockIcon.classList.add('hidden'); return; }

  try {
    const edb = JSON.parse(saved);
    if (!edb || !edb.equiposGuardados) { stockIcon.classList.add('hidden'); return; }
    const hayAgotados = edb.equiposGuardados.some(equipoTieneStockAgotado);
    stockIcon.classList.toggle('hidden', !hayAgotados);
  } catch (error) {
    console.error('Error checking stock:', error);
    stockIcon.classList.remove('hidden');
  }
}


/* =============================================================================
   8. UI — PANTALLAS
============================================================================= */

async function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; });

  const screenElement = document.getElementById(screenId);
  if (!screenElement) { console.error(`Screen ${screenId} not found`); return; }
  screenElement.style.display = screenId === 'mainScreen' ? 'flex' : 'block';

  if (screenId === 'adminUsuariosScreen') {
    cargarUsuariosAdmin();
  }
  if (screenId === 'adminPeriodicidadScreen') {
    updateAdminLists();
  }
  if (screenId === 'adminInstalacionesScreen') {
    cargarInstalacionesAdmin();
  }
  if (screenId === 'adminNotificacionesScreen') {
    cargarDestinatariosNotifAdmin(); cargarNotificacionesAdmin();
  }
  if (screenId === 'adminHistorialScreen') {
    cargarSelectHistorialUsuarios();
  }
  if (screenId === 'workOrderScreen') {
    showWorkOrderScreen();
    const list = document.getElementById('workOrdersList');
    if (list) list.style.display = 'none';
  }
  if (screenId === 'equiposScreen')   actualizarListaEquipos();
  if (screenId !== 'mainScreen' && screenId !== 'menuScreen') updateSelectors();
  if (screenId === 'menuScreen')      { checkPendingWorkOrders(); _mostrarUsuarioEnMenu(); checkPastDueMaintenances(); updateNotificationIcons(); }
  if (screenId === 'mainScreen')      { 
    const cerrarBtn = document.getElementById('cerrarSesionBtn');
    const adminBtn = document.getElementById('adminBtn');
    const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
    if (cerrarBtn) cerrarBtn.style.display = localStorage.getItem('instalacionActiva') ? '' : 'none';
    if (adminBtn) adminBtn.style.display = esAdmin ? '' : 'none';
  }

  setupAutocomplete();
}

window.showScreen = showScreen;

function authenticateAdmin() {
  if (verificarPin()) {
    showScreen('adminScreen');
  } else {
    alert('Código incorrecto. Acceso denegado.');
    showScreen('menuScreen');
  }
}

// Pide PIN y navega a la pantalla indicada si es correcto
function _autenticarYMostrar(screenId) {
  if (verificarPin()) {
    showScreen(screenId);
  } else {
    alert('Código incorrecto. Acceso denegado.');
    showScreen('menuScreen');
  }
}

function updateAdminLists() {
  const lista = document.getElementById('listaMantenimientosPeriodicos');
  if (lista && lista.style.display !== 'none') actualizarListaMantenimientos();
}


/* =============================================================================
   9. UI — LISTAS (renderizado de elementos dinámicos)
============================================================================= */

// Lista de recambios en modo lectura
function generarListaRecambios(recambios) {
  return (recambios || []).map(r => `
    <div class="spare-part-item"><span>${r.nombre}: ${r.cantidad} unidades</span></div>
  `).join('');
}

// Lista de recambios en modo edición
function generarFormularioRecambios(recambios, equipoIndex) {
  return (recambios || []).map((r, i) => `
    <div class="spare-part-item">
      <input type="text"   id="recambio-nombre-${equipoIndex}-${i}"   value="${r.nombre}">
      <input type="number" id="recambio-cantidad-${equipoIndex}-${i}" value="${r.cantidad}" min="0">
    </div>
  `).join('');
}

// Opciones de recambios de un equipo para un <select>
function getSparePartsOptions(equipoName) {
  if (!window.equiposDb || !window.equiposDb.equiposGuardados) return '';
  const equipo = window.equiposDb.equiposGuardados.find(e => e && e.equipo === equipoName);
  if (!equipo || !equipo.recambios) return '';
  return equipo.recambios.map(r => `<option value="${r.nombre}">${r.nombre}</option>`).join('');
}

// Recambios ya usados en un parte de trabajo
function renderUsedSpareParts(spareParts) {
  if (!spareParts || !spareParts.length) return '';
  return spareParts.map(p => `<div class="spare-part-item">${p.nombre}: ${p.cantidad} unidades</div>`).join('');
}

async function actualizarListaMantenimientos() {
  const listaDiv = document.getElementById('listaMantenimientosPeriodicos');
  if (!listaDiv) return;
  listaDiv.innerHTML = '';

  if (!db.mantenimientosPeriodicos || !Array.isArray(db.mantenimientosPeriodicos)) {
    console.warn('No hay mantenimientos periódicos definidos');
    return;
  }

  const validos     = db.mantenimientosPeriodicos.filter(m => m && m.accion);
  const preventivos = validos.filter(m => m.tipo === 'preventivo' || (m.tipo !== 'trabajo' && m.equipo && m.equipo.trim() !== ''));
  const tareas      = validos.filter(m => m.tipo === 'trabajo');
  actualizarContadorMantenimientos(validos.length);

  // Helper que crea una tarjeta de mantenimiento idéntica para ambos tipos
  function crearCardMantenimiento(m, body) {
    const nextDate = calcularProximaFecha(m);
    const vencido  = esMantenimientoVencido(m);
    const titulo   = m.tipo === 'trabajo' ? (m.equipo || m.accion) : (m.equipo || '—');
    const div = document.createElement('div');
    div.className = 'pending-record' + (vencido ? ' overdue' : '');
    div.dataset.id = m.id;
    div.innerHTML = `
      <div class="equipo-record-header" onclick="this.nextElementSibling.classList.toggle('eq-detail-open')">
        <strong>${titulo}</strong>
        <span class="eq-model-tag">c/${m.periodicidad}d</span>
        <span class="eq-model-tag" style="color:${vencido ? 'var(--red)' : 'var(--green)'}">
          ${vencido ? '⚠ vencido' : '✓ ' + nextDate.toLocaleDateString()}
        </span>
        <span class="eq-chevron">›</span>
      </div>
      <div class="eq-detail">
        <p><strong>Acción:</strong> ${m.accion}</p>
        <p><strong>ID:</strong> ${m.id}</p>
        <p><strong>Operario:</strong> ${m.operario || '—'}</p>
        <p><strong>Periodicidad:</strong> ${m.periodicidad} días</p>
        <p><strong>Última ejecución:</strong> ${m.fechaUltimaEjecucion || m.fecha || '—'}</p>
        <p><strong>Asignado a:</strong> ${_getAsignadosNombres(m).join(', ') || '<span class="opacity-muted">Sin asignar</span>'}</p>
        <p><strong>Próxima fecha:</strong> ${nextDate.toLocaleDateString()}</p>
        <p><strong>Ejecuciones registradas:</strong> ${(m.historial || []).length}</p>
        <div class="edit-delete-buttons">
          <button class="button" onclick="editarMantenimiento('${m.id}')">Editar</button>
          <button class="button" onclick="eliminarMantenimiento('${m.id}')">Eliminar</button>
        </div>
        <div id="edit-${m.id}" class="edit-form" style="display:none;">
          <div class="form-group"><label>Última ejecución</label><input type="date" id="newDate-${m.id}" value="${m.fechaUltimaEjecucion || m.fecha || ''}"></div>
          <div class="form-group"><label>Operario</label><input type="text" id="newOperator-${m.id}" value="${m.operario || ''}"></div>
          <div class="form-group"><label>Equipo</label><input type="text" id="newEquipment-${m.id}" value="${m.equipo || ''}"></div>
          <div class="form-group"><label>Acción</label><input type="text" id="newAction-${m.id}" value="${m.accion || ''}"></div>
          <div class="form-group"><label>Periodicidad (días)</label><input type="number" id="newPeriod-${m.id}" value="${m.periodicidad || ''}"></div>
          <div class="form-group admin-only" id="bloque-asignado-${m.id}" style="display:none">
            <label>Asignado a (usuario sistema)</label>
            <div id="newAsignado-${m.id}" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px"></div>
          </div>
          <div class="form-group admin-only" id="bloque-asignado-ext-${m.id}" style="display:none">
            <label>Asignado a (externo / empresa)</label>
            <input type="text" id="newAsignadoExt-${m.id}" value="${m.asignadoAExterno || ''}" placeholder="Ej: Tecnicwater">
          </div>
          <button class="button" onclick="guardarEdicionMantenimiento('${m.id}')">Guardar cambios</button>
        </div>
      </div>
    `;
    body.appendChild(div);
    if (localStorage.getItem('usuarioRol') === 'admin') {
      const ba = div.querySelector(`[id="bloque-asignado-${m.id}"]`);
      const be = div.querySelector(`[id="bloque-asignado-ext-${m.id}"]`);
      if (ba) ba.style.display = 'block';
      if (be) be.style.display = 'block';
    }
  }

  // ── BLOQUE 1: Preventivos de Equipos ─────────────────────────────────────
  const secPrev = document.createElement('div');
  secPrev.className = 'eq-familia eq-collapsed';
  secPrev.style.borderColor = 'var(--blue)';
  const vencPrev = preventivos.filter(esMantenimientoVencido).length;
  secPrev.innerHTML = `
    <div class="eq-familia-header" onclick="this.parentElement.classList.toggle('eq-collapsed')"
         style="background:var(--blue-dim)">
      <span class="eq-familia-icon">▾</span>
      <span>⚙️ Preventivos de Equipos</span>
      <span class="eq-familia-count">${preventivos.length}${vencPrev ? ' · <span style="color:var(--red)">' + vencPrev + ' vencido(s)</span>' : ''}</span>
    </div>
    <div class="eq-familia-body"></div>
  `;
  listaDiv.appendChild(secPrev);
  const bodyPrev = secPrev.querySelector('.eq-familia-body');

  preventivos
    .slice()
    .sort((a, b) => (a.equipo || '').localeCompare(b.equipo || ''))
    .forEach(m => crearCardMantenimiento(m, bodyPrev));

  // ── BLOQUE 2: Trabajos Periódicos ─────────────────────────────────────────
  const secTar = document.createElement('div');
  secTar.className = 'eq-familia eq-collapsed';
  secTar.style.borderColor = 'var(--green)';
  const vencTar = tareas.filter(esMantenimientoVencido).length;
  secTar.innerHTML = `
    <div class="eq-familia-header" onclick="this.parentElement.classList.toggle('eq-collapsed')"
         style="background:rgba(39,174,96,0.12)">
      <span class="eq-familia-icon">▾</span>
      <span>🛠️ Trabajos Periódicos</span>
      <span class="eq-familia-count">${tareas.length}${vencTar ? ' · <span style="color:var(--red)">' + vencTar + ' vencido(s)</span>' : ''}</span>
    </div>
    <div class="eq-familia-body"></div>
  `;
  listaDiv.appendChild(secTar);
  const bodyTar = secTar.querySelector('.eq-familia-body');

  tareas
    .slice()
    .sort((a, b) => (a.equipo || a.accion || '').localeCompare(b.equipo || b.accion || ''))
    .forEach(m => crearCardMantenimiento(m, bodyTar));
}

async function actualizarListaEquipos() {
  const listaDiv = document.getElementById('listaEquiposGuardados');
  if (!listaDiv) return;

  if (!window.equiposDb || !window.equiposDb.equiposGuardados) {
    listaDiv.innerHTML = '<p>No hay equipos guardados</p>';
    return;
  }

  // Estado de navegación local (persiste entre llamadas via closure en el propio DOM)
  _equiposNav = { paso: 'familia', familia: null, zona: null };
  _renderEquiposNav(listaDiv);
}

// Objeto de estado de navegación para la pantalla Equipos
let _equiposNav = { paso: 'familia', familia: null, zona: null };
let _origenAltaMantenimiento = null;

// Render central de la navegación jerárquica Equipos
function _renderEquiposNav(listaDiv) {
  if (!listaDiv) { listaDiv = document.getElementById('listaEquiposGuardados'); }
  if (!listaDiv) return;
  listaDiv.innerHTML = '';

  const equipos = window.equiposDb.equiposGuardados || [];

  if (_equiposNav.paso === 'familia') {
    // ── PASO 1: listar familias ───────────────────────────────
    const familias = new Map();
    equipos.forEach(eq => {
      if (!eq) return;
      const fam = eq.familia || '(Sin familia)';
      familias.set(fam, (familias.get(fam) || 0) + 1);
    });
    [...familias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
      .forEach(([fam, count]) => {
        const btn = document.createElement('div');
        btn.className = 'eq-familia';
        btn.innerHTML = `
          <div class="eq-familia-header" onclick="window._equiposNavIr('zona','${fam.replace(/'/g,"\\'")}')">
            <span class="eq-familia-icon">📂</span>
            <span>${fam}</span>
            <span class="eq-familia-count">${count} equipo(s)</span>
            <span class="eq-chevron">›</span>
          </div>`;
        listaDiv.appendChild(btn);
      });

  } else if (_equiposNav.paso === 'zona') {
    // ── PASO 2: listar zonas de la familia seleccionada ───────
    const fam = _equiposNav.familia;
    const zonas = new Map();
    equipos.filter(eq => eq && (eq.familia || '(Sin familia)') === fam).forEach(eq => {
      const z = eq.zona || '(Sin zona)';
      zonas.set(z, (zonas.get(z) || 0) + 1);
    });

    // Botón atrás
    const back = document.createElement('div');
    back.className = 'eq-nav-back';
    back.innerHTML = `<button class="button back-button" onclick="window._equiposNavIr('familia')">‹ Familias</button>
      <span class="eq-nav-breadcrumb">${fam}</span>`;
    listaDiv.appendChild(back);

    [...zonas.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
      .forEach(([zona, count]) => {
        const btn = document.createElement('div');
        btn.className = 'eq-familia';
        btn.innerHTML = `
          <div class="eq-familia-header" onclick="window._equiposNavIr('equipo','${fam.replace(/'/g,"\\'")}','${zona.replace(/'/g,"\\'")}')">
            <span class="eq-familia-icon">📍</span>
            <span>${zona}</span>
            <span class="eq-familia-count">${count} equipo(s)</span>
            <span class="eq-chevron">›</span>
          </div>`;
        listaDiv.appendChild(btn);
      });

  } else if (_equiposNav.paso === 'equipo') {
    // ── PASO 3: listar equipos de familia+zona ────────────────
    const fam  = _equiposNav.familia;
    const zona = _equiposNav.zona;
    const filtrados = equipos
      .map((eq, i) => eq ? { ...eq, originalIndex: i } : null)
      .filter(eq => eq && (eq.familia || '(Sin familia)') === fam && (eq.zona || '(Sin zona)') === zona)
      .sort((a, b) => (a.equipo || '').localeCompare(b.equipo || '', undefined, { numeric: true, sensitivity: 'base' }));

    // Botón atrás
    const back = document.createElement('div');
    back.className = 'eq-nav-back';
    back.innerHTML = `<button class="button back-button" onclick="window._equiposNavIr('zona','${fam.replace(/'/g,"\\'")}')">‹ Zonas</button>
      <span class="eq-nav-breadcrumb">${fam} › ${zona}</span>`;
    listaDiv.appendChild(back);

    filtrados.forEach(equipo => {
      const idx = equipo.originalIndex;
      const recambiosBase = equipo.recambios || [{ nombre: equipo.recambio, cantidad: equipo.cantidad }];
      const div = document.createElement('div');
      div.className = 'equipo-record';
      div.dataset.equipoIndex = idx;
      div.innerHTML = `
        <div class="equipo-record-header" onclick="this.nextElementSibling.classList.toggle('eq-detail-open')">
          <strong>${equipo.equipo || ''}</strong>
          <span class="eq-model-tag">${equipo.modelo || ''}</span>
          <span class="eq-chevron">›</span>
        </div>
        <div class="eq-detail">
          <p><strong>Recambios:</strong></p>
          <div class="spare-parts-list">${generarListaRecambios(recambiosBase)}</div>
          <div class="eq-mantenimientos-periodicos" id="mant-ficha-${idx}">
            <p><strong>Mantenimientos periódicos:</strong></p>
            <div class="mant-ficha-lista">${_renderMantsFicha(equipo.equipo || '')}</div>
            <button class="button" style="margin-top:6px;width:100%" onclick="_abrirPreventivoConEquipo('${(equipo.equipo || '').replace(/'/g, "\\'")}')">+ Añadir mantenimiento</button>
          </div>
          ${_auditoriaEquipo(equipo.equipo || '')}
          <div class="edit-delete-buttons">
            <button class="button" onclick="editarEquipo(${idx})">Editar</button>
            <button class="button" onclick="eliminarEquipo(${idx})">Eliminar</button>
            <button class="button" onclick="exportarHistorialEquipo('${equipo.equipo || ''}')">📋 Exportar historial</button>
          </div>
          <div class="edit-form" id="edit-equipo-${idx}">
            <div class="form-group"><label>Familia</label><input type="text" id="familia-${idx}" value="${equipo.familia || ''}"></div>
            <div class="form-group"><label>Zona</label><input type="text" id="zona-${idx}" value="${equipo.zona || ''}"></div>
            <div class="form-group"><label>Equipo</label><input type="text" id="equipo-${idx}" value="${equipo.equipo || ''}"></div>
            <div class="form-group"><label>Modelo</label><input type="text" id="modelo-${idx}" value="${equipo.modelo || ''}"></div>
            <div class="form-group">
              <label>Recambios Actuales:</label>
              <div id="recambios-list-${idx}">${generarFormularioRecambios(recambiosBase, idx)}</div>
            </div>
            <div class="add-spare-part-form">
              <h4>Añadir Nuevo Recambio</h4>
              <div class="form-group"><label>Nombre del Recambio</label><input type="text" id="nuevo-recambio-nombre-${idx}"></div>
              <div class="form-group"><label>Cantidad</label><input type="number" id="nuevo-recambio-cantidad-${idx}" min="0"></div>
              <button class="button" onclick="agregarNuevoRecambio(${idx})">Añadir Recambio</button>
            </div>
            <button class="button" onclick="guardarEdicionEquipo(${idx})">Guardar Cambios</button>
          </div>
        </div>
      `;
      listaDiv.appendChild(div);
    });
  }
}

function _auditoriaEquipo(nombreEquipo) {
  const nombre = (nombreEquipo || '').trim().toLowerCase();
  const ahora  = new Date();
  const hace1y = new Date(ahora.getTime() - 365 * 24 * 60 * 60 * 1000);

  const mants     = (db.mantenimientosPeriodicos || []).filter(m => m && (m.equipo || '').trim().toLowerCase() === nombre);
  const vencidos  = mants.filter(m => esMantenimientoVencido(m)).length;
  const total     = mants.length;

  const correctivos = (db.workOrdersAverias || []).filter(w =>
    w && (w.equipo || '').trim().toLowerCase() === nombre &&
    w.fecha && new Date(w.fecha) >= hace1y
  ).length;

  const duplicados = mants.filter((m, i) =>
    mants.findIndex(n => n.accion === m.accion && n.periodicidad === m.periodicidad) !== i
  ).length;

  const historial  = db.historialEquipos?.[nombreEquipo] || [];
  const ultimaInt  = historial.length
    ? historial.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0].fecha
    : '—';

  const semaforo = (vencidos > 4 || correctivos >= 5 || duplicados > 1) ? '🔴' :
                   (vencidos >= 2 || duplicados >= 1 || correctivos >= 2) ? '🟡' : '🟢';
  const color    = semaforo === '🔴' ? 'var(--red)' : semaforo === '🟡' ? '#f0a500' : 'var(--green)';

  return `
    <div class="eq-auditoria" style="margin:10px 0;padding:10px;border-radius:6px;border:1px solid ${color};background:color-mix(in srgb,${color} 8%,transparent)">
      <p style="font-weight:700;color:${color};margin:0 0 8px">${semaforo} AUDITORÍA DEL EQUIPO</p>
      <p class="txt-secondary-sm">📋 Mantenimientos programados: <strong>${total}</strong></p>
      <p style="font-size:0.83rem;margin:3px 0;color:${vencidos > 0 ? 'var(--red)' : 'inherit'}">⏰ Mantenimientos vencidos: <strong>${vencidos}</strong></p>
      <p style="font-size:0.83rem;margin:3px 0;color:${correctivos >= 5 ? 'var(--red)' : correctivos >= 2 ? '#f0a500' : 'inherit'}">🔧 Correctivos 12 meses: <strong>${correctivos}</strong></p>
      <p style="font-size:0.83rem;margin:3px 0;color:${duplicados > 0 ? '#f0a500' : 'inherit'}">⚠️ Posibles duplicados: <strong>${duplicados}</strong></p>
      <p class="txt-secondary-sm">🕐 Última intervención: <strong>${ultimaInt}</strong></p>
    </div>`;
}

// Función de navegación global (llamada desde onclick en HTML generado)
window._equiposNavIr = function(paso, familia, zona) {
  _equiposNav.paso    = paso;
  _equiposNav.familia = familia || null;
  _equiposNav.zona    = zona    || null;
  _renderEquiposNav();
};
window._renderEquiposNav = _renderEquiposNav;

// Devuelve HTML con los mantenimientos periódicos del equipo (tipo preventivo)
function _renderMantsFicha(nombreEquipo) {
  if (!nombreEquipo) return '<p style="color:var(--text-muted);font-size:0.82rem">—</p>';
  const mants = (db.mantenimientosPeriodicos || []).filter(m =>
    m &&
    (m.equipo || '').trim().toLowerCase() === nombreEquipo.trim().toLowerCase()
  );
  if (!mants.length) return '<p style="color:var(--text-muted);font-size:0.82rem">No hay mantenimientos programados para este equipo</p>';
  return mants.slice().sort((a, b) => (a.periodicidad || 0) - (b.periodicidad || 0)).map(m => {
    const vencido = typeof esMantenimientoVencido === 'function' && esMantenimientoVencido(m);
    const badge   = vencido
      ? '<span style="color:var(--red);font-size:0.75rem;margin-left:6px">⚠ VENCIDO</span>'
      : '<span style="color:var(--green);font-size:0.75rem;margin-left:6px">✓ Al día</span>';
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.83rem">
      <strong>${m.accion}</strong>${badge}<br>
      <span style="color:var(--text-muted)">Cada ${m.periodicidad} días · Última: ${m.fechaUltimaEjecucion || m.fecha} · ${m.tipo || 'preventivo'}</span>
    </div>`;
  }).join('');
}

// Abre preventivoScreen con el equipo prellenado (desde ficha de equipo)
// Guarda el origen para poder volver a la misma ficha tras guardar
function _abrirPreventivoConEquipo(nombreEquipo) {
  _origenAltaMantenimiento = {
    desde: 'equipos',
    equipo: nombreEquipo,
    familia: _equiposNav.familia,
    zona: _equiposNav.zona
  };
  showScreen('adminScreen');
  const el = document.getElementById('equipoPeriodicidad');
  if (el) el.value = nombreEquipo;
}

// Muestra u oculta un formulario de edición inline (toggle)
function _toggleEditForm(id) {
  const form = document.getElementById(id);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function _hideEditForm(id) {
  const form = document.getElementById(id);
  if (form) form.style.display = 'none';
}

// Returns the db array that contains the order with this id
function _getOrderArray(orderId) {
  if ((db.workOrdersAverias || []).find(o => o && o.id === orderId)) return { arr: db.workOrdersAverias, ref: `instalaciones/${INST()}/workOrdersAverias`, show: showPendingAverias };
  if ((db.workOrdersTareas  || []).find(o => o && o.id === orderId)) return { arr: db.workOrdersTareas,  ref: `instalaciones/${INST()}/workOrdersTareas`,  show: showPendingTareas  };
  return { arr: db.workOrders, ref: `instalaciones/${INST()}/workOrders`, show: showPendingWorkOrders };
}


/* =============================================================================
   10. UI — FORMULARIOS
============================================================================= */

// Inicializa la pantalla de parte de trabajo reseteando todos sus campos
async function showWorkOrderScreen() {
  ['fechaWorkOrder', 'operarioWorkOrder', 'workOrderEquipo', 'descripcionWorkOrder'].forEach(id => {
    document.getElementById(id).value = '';
  });
  const operarioSelect = document.getElementById('operarioWorkOrder');
  const equipoSelect   = document.getElementById('workOrderEquipo');
  operarioSelect.innerHTML = '<option value="">Seleccione un operario</option>';
  equipoSelect.innerHTML   = '<option value="">Seleccione un equipo</option>';
  const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
  const bloqueAsig    = document.getElementById('bloqueAsignadoWorkOrder');
  const bloqueAsigExt = document.getElementById('bloqueAsignadoWorkOrderExt');
  if (esAdmin) {
    await _cargarOperariosSelect('operarioWorkOrder');
    if (bloqueAsig) bloqueAsig.style.display = 'block';
    if (bloqueAsigExt) bloqueAsigExt.style.display = 'block';
    await _cargarOperariosCheckboxes('asignadoWorkOrder', []);
    const extInput = document.getElementById('asignadoWorkOrderExt');
    if (extInput) extInput.value = '';
  } else {
    if (bloqueAsig) bloqueAsig.style.display = 'none';
    if (bloqueAsigExt) bloqueAsigExt.style.display = 'none';
    db.operarios.forEach(op => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = op;
      operarioSelect.appendChild(opt);
    });
  }
  db.equipos.forEach(eq => {
    const opt = document.createElement('option');
    opt.value = eq.id; opt.textContent = eq.nombre;
    equipoSelect.appendChild(opt);
  });
}

// Actualiza todos los <select> de operario y equipo de la página
function updateSelectors() {
  document.querySelectorAll('[id$="operario"]').forEach(input => {
    if (!input || input.tagName !== 'SELECT') return;
    input.innerHTML = '<option value="">Seleccione un operario</option>';
    db.operarios.forEach(op => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = op;
      input.appendChild(opt);
    });
  });

  document.querySelectorAll('[id$="equipo"]').forEach(input => {
    if (!input || input.tagName !== 'SELECT') return;
    input.innerHTML = '<option value="">Seleccione un equipo</option>';
    (db.equipos || []).forEach(eq => {
      if (eq && eq.id && eq.nombre) {
        const opt = document.createElement('option');
        opt.value = eq.id; opt.textContent = eq.nombre;
        input.appendChild(opt);
      }
    });
  });
}

function actualizarContadorMantenimientos(total) {
  const boton    = document.getElementById('toggleListaMantenimientos');
  const listaDiv = document.getElementById('listaMantenimientosPeriodicos');
  if (!boton) return;
  const visible = listaDiv && listaDiv.style.display !== 'none';
  boton.textContent = visible
    ? `Ocultar mantenimientos (${total})`
    : `Mostrar mantenimientos (${total})`;
}

function toggleListaMantenimientos() {
  const lista = document.getElementById('listaMantenimientosPeriodicos');
  const total = (db.mantenimientosPeriodicos || []).filter(m => m && m.accion && m.equipo).length;
  if (lista.style.display === 'none') {
    lista.style.display = 'block';
    actualizarListaMantenimientos();
  } else {
    lista.style.display = 'none';
  }
  actualizarContadorMantenimientos(total);
}


/* =============================================================================
   11. LÓGICA — PARTES DE TRABAJO
============================================================================= */

async function createWorkOrder() {
  const fecha      = document.getElementById('fechaWorkOrder').value;
  const opSel    = document.getElementById('operarioWorkOrder');
  const operario = opSel.selectedOptions[0]?.dataset.nombre || opSel.value;
  const equipo     = document.getElementById('workOrderEquipo').value;
  const descripcion = document.getElementById('descripcionWorkOrder').value;
  const photoData  = document.getElementById('photoPreview').dataset.photoData;
  const tipo       = document.getElementById('tipoWorkOrder').value; // 'averia' | 'tarea'

  if (!fecha || !operario || !equipo || !descripcion || !tipo) {
    alert('Por favor complete todos los campos, incluido el tipo de parte');
    return;
  }

  const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
  const asigContainer = document.getElementById('asignadoWorkOrder');
  const marcadosAsig = (esAdmin && asigContainer) ? Array.from(asigContainer.querySelectorAll('input[type=checkbox]:checked')) : [];
  const asignadoAUids    = marcadosAsig.map(c => c.value);
  const asignadoANombres = marcadosAsig.map(c => c.dataset.nombre);
  const asignadoExtEl = document.getElementById('asignadoWorkOrderExt');
  const asignadoAExterno = (!asignadoAUids.length && asignadoExtEl) ? (asignadoExtEl.value.trim() || '') : '';

  const workOrder = {
    id:               Date.now(),
    fecha,
    fechaProgramada:  fecha,
    fechaCreacion:    new Date().toISOString(),
    fechaEjecucion:   null,
    fechaInicio:      new Date().toISOString(),
    fechaFin:         null,
    operario,
    equipo,
    descripcion,
    estado:           'en_curso',
    tipo,
    spareParts:       [],
    asignadoAUids,
    asignadoANombres,
    asignadoAExterno,
    origen:           'parteTrabajo',
    creadoPorUid:     _sesionAutor().uid,
    creadoPorNombre:  _sesionAutor().nombre,
    creadoPorEmail:   _sesionAutor().email
  };
  
  if (photoData && photoData.trim() !== '') workOrder.photo = photoData;

  const dbKey   = tipo === 'averia' ? 'workOrdersAverias' : 'workOrdersTareas';
  const fbRef   = tipo === 'averia' ? `instalaciones/${INST()}/workOrdersAverias` : `instalaciones/${INST()}/workOrdersTareas`;

  try {
    if (!db[dbKey]) db[dbKey] = [];
    const clean = [...db[dbKey].filter(Boolean), workOrder];
    await realDb.ref(fbRef).set(clean.map(o => ({ ...o, photo: o.photo || null })));
    db[dbKey] = clean;
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));

    ['fechaWorkOrder', 'operarioWorkOrder', 'workOrderEquipo', 'descripcionWorkOrder'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('tipoWorkOrder').value = '';
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = '';
    preview.dataset.photoData = '';

    alert('Parte de trabajo creado con éxito');
    updateNotificationIcons();
  } catch (error) {
    console.error('Error al crear parte de trabajo:', error);
    alert('Error al crear el parte: ' + error.message);
  }
}

async function editWorkOrder(orderId) {
  _toggleEditForm(`edit-form-${orderId}`);
  if (localStorage.getItem('usuarioRol') === 'admin') {
    const selAsig = document.getElementById(`edit-asignado-${orderId}`);
    if (selAsig && !selAsig.dataset.cargado) {
      const orden = (db.workOrdersAverias || []).find(o => o && o.id == orderId)
                 || (db.workOrdersTareas  || []).find(o => o && o.id == orderId);
      await _cargarOperariosCheckboxes(`edit-asignado-${orderId}`, _getAsignadosUids(orden));
      selAsig.dataset.cargado = '1';
    }
  }
}

async function cancelWorkOrderEdit(orderId) {
  _hideEditForm(`edit-form-${orderId}`);
}

async function saveWorkOrderChanges(orderId) {
  const { arr, ref, show } = _getOrderArray(orderId);
  const order = arr.find(wo => wo && wo.id === orderId);
  if (!order) return;

  const newDescription = document.getElementById(`edit-description-${orderId}`).value;
  const newOperator    = document.getElementById(`edit-operator-${orderId}`).value;
  const materialEl     = document.getElementById(`edit-material-${orderId}`);

  if (!newDescription) { alert('La descripción no puede estar vacía'); return; }

  try {
    order.descripcion = newDescription;
    if (newOperator) order.operario = newOperator;
    const selAsig = document.getElementById(`edit-asignado-${orderId}`);
    if (selAsig) {
      const marcadosSel = Array.from(selAsig.querySelectorAll('input[type=checkbox]:checked'));
      const uidsSel    = marcadosSel.map(c => c.value);
      const nombresSel = marcadosSel.map(c => c.dataset.nombre);
      order.asignadoAUids    = uidsSel;
      order.asignadoANombres = nombresSel;
      delete order.asignadoAUid;
      delete order.asignadoANombre;
      if (uidsSel.length) {
        order.asignadoAExterno = '';
      } else {
        const extEl = document.getElementById(`edit-asignado-ext-${orderId}`);
        order.asignadoAExterno = (extEl && extEl.value.trim()) ? extEl.value.trim() : '';
      }
    }
    if (materialEl) order.material = materialEl.value;
    await realDb.ref(ref).set(arr);
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    _hideEditForm(`edit-form-${orderId}`);
    show();
    alert('Cambios guardados con éxito');
  } catch (error) {
    console.error('Error saving work order changes:', error);
    alert('Error al guardar los cambios: ' + error.message);
  }
}

async function updateWorkOrderOperator(orderId, newOperator) {
  const { arr, ref, show } = _getOrderArray(orderId);
  const order = arr.find(wo => wo && wo.id === orderId);
  if (!order) return;
  order.operario = newOperator;
  try {
    await realDb.ref(ref).set(arr);
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    show();
  } catch (error) {
    console.error('Error updating work order operator:', error);
    alert('Error al actualizar el operario');
  }
}

async function addSparePart(orderId) {
  const sparePartSelect = document.getElementById(`spare-part-${orderId}`);
  const quantityInput   = document.getElementById(`spare-part-quantity-${orderId}`);
  const sparePart = sparePartSelect.value;
  const quantity  = parseInt(quantityInput.value);

  if (!sparePart || !quantity || quantity < 1) {
    alert('Por favor seleccione un recambio y especifique una cantidad válida');
    return;
  }

  const { arr: woArr, ref: woRef } = _getOrderArray(orderId);
  const order = woArr.find(wo => wo && wo.id === orderId);
  if (!order) return;

  const equipoEnStock = window.equiposDb.equiposGuardados.find(e => e && e.equipo === order.equipo);
  if (!equipoEnStock) { alert('No se encontró el equipo en el inventario'); return; }

  const recambioEnStock = equipoEnStock.recambios.find(r => r.nombre === sparePart);
  if (!recambioEnStock) { alert('No se encontró el recambio en el inventario'); return; }

  if (recambioEnStock.cantidad < quantity) {
    alert('No hay suficiente stock disponible. Stock actual: ' + recambioEnStock.cantidad);
    return;
  }

  recambioEnStock.cantidad -= quantity;
  if (!order.spareParts) order.spareParts = [];
  order.spareParts.push({ nombre: sparePart, cantidad: quantity });

  try {
    realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    realDb.ref(woRef).set(woArr);
    localStorage.setItem(LS_KEY_EQUIPOS, JSON.stringify(window.equiposDb));
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));

    document.getElementById(`spare-parts-list-${orderId}`).innerHTML = renderUsedSpareParts(order.spareParts);
    sparePartSelect.value = '';
    quantityInput.value   = '';
    updateStockIcon();
    alert('Recambio añadido y stock actualizado con éxito');
  } catch (error) {
    console.error('Error adding spare part and updating stock:', error);
    alert('Error al añadir el recambio y actualizar el stock: ' + error.message);
  }
}

async function completeWorkOrder(orderId, buttonElement) {
  const { arr, ref } = _getOrderArray(orderId);
  // Work on a snapshot of the order before any mutation
  const order = arr.find(wo => wo && wo.id === orderId);
  if (!order) { console.error('Work order not found:', orderId); return; }

  if (!confirm(`¿Marcar como completado "${order.equipo || order.descripcion || 'este parte'}"?`)) return;

  const hoy = new Date().toISOString().split('T')[0];
  const fechaInput = prompt('Fecha de ejecución real (AAAA-MM-DD):', hoy);
  if (fechaInput === null) return;
  const fechaEjecucion = fechaInput.trim() || hoy;

  // Stamp completion data on a copy — do not mutate the live object yet
  const completedOrder = { ...order, fechaEjecucion, estado: 'completado',
    cerradoPorUid:    _sesionAutor().uid,
    cerradoPorNombre: _sesionAutor().nombre,
    cerradoPorEmail:  _sesionAutor().email
  };

  _archivarHistorialTrabajo({
    origen:      completedOrder.origen || (ref.includes('Tareas') ? 'parteTrabajo' : 'averiaAntigua'),
    equipo:      completedOrder.equipo,
    descripcion: completedOrder.descripcion,
    fecha:       completedOrder.fechaEjecucion,
    uid:         completedOrder.cerradoPorUid,
    nombre:      completedOrder.cerradoPorNombre
  });

  try {

    // ── STEP 1: Remove from the correct in-memory array immediately ──────────
    if (ref.includes('Averias'))     db.workOrdersAverias = db.workOrdersAverias.filter(wo => wo && wo.id !== orderId);
    else if (ref.includes('Tareas')) db.workOrdersTareas  = db.workOrdersTareas.filter(wo => wo && wo.id !== orderId);
    else                             db.workOrders        = db.workOrders.filter(wo => wo && wo.id !== orderId);

    // ── STEP 2: Persist to Firebase (source of truth) ────────────────────────
    const updatedArr = ref.includes('Averias') ? db.workOrdersAverias
                     : ref.includes('Tareas')  ? db.workOrdersTareas
                     :                           db.workOrders;
    await realDb.ref(ref).set(updatedArr.length ? updatedArr : []);

    // ── STEP 3: Persist to localStorage ──────────────────────────────────────
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));

    // ── STEP 4: Update UI immediately — do not wait for export ───────────────
    checkPendingWorkOrders();
    updateNotificationIcons();
    const recordDiv = buttonElement.closest('.pending-record');
    if (recordDiv) {
      recordDiv.remove();
      const remaining = updatedArr.filter(wo => wo && wo.estado === 'pendiente');
      if (!remaining.length) {
        const popup = document.querySelector('.notification-popup');
        if (popup) popup.remove();
      }
    }

    // ── STEP 5: Historial del equipo ─────────────────────────────────────────
    await _guardarHistorialEquipo(completedOrder.equipo, {
      fecha:       completedOrder.fechaEjecucion || completedOrder.fecha || '',
      descripcion: completedOrder.descripcion || '',
      tipo:        completedOrder.tipo || 'parte'
    });

    // ── STEP 6: Export to GitHub (non-blocking) ───────────────────────────────
    try {
      await exportarWorkOrderToExcel(completedOrder);
      alert('Parte completado y exportado a GitHub correctamente');
    } catch (ghError) {
      console.error('GitHub export error:', ghError.message);
      alert('Parte completado. Error al exportar a GitHub: ' + ghError.message);
    }

  } catch (error) {
    console.error('Error completing work order:', error);
    alert('Error al completar el parte de trabajo: ' + error.message);
  }
}


/* =============================================================================
   12. LÓGICA — MANTENIMIENTOS
============================================================================= */

function guardarPreventivoEquipo(m) {
  if (!db.preventivosEquipos) db.preventivosEquipos = [];
  db.preventivosEquipos.push(m);
  realDb.ref(`instalaciones/${INST()}/preventivosEquipos`).set(db.preventivosEquipos).catch(e => console.warn(e));
}

function guardarTrabajoPeriodico(m) {
  if (!db.trabajosPeriodicos) db.trabajosPeriodicos = [];
  db.trabajosPeriodicos.push(m);
  realDb.ref(`instalaciones/${INST()}/trabajosPeriodicos`).set(db.trabajosPeriodicos).catch(e => console.warn(e));
}

async function _cargarOperariosSelect(selectId, uidsActuales) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const actuales = Array.isArray(uidsActuales) ? uidsActuales : (uidsActuales ? [uidsActuales] : []);
  el.innerHTML = el.multiple ? '' : '<option value="">Sin asignar</option>';
  try {
    const snap = await realDb.ref('usuarios').once('value');
    const usuarios = snap.val() || {};
    Object.entries(usuarios).forEach(([uid, u]) => {
      if (u.estado !== 'activo') return;
      const opt = document.createElement('option');
      opt.value = uid;
      opt.textContent = u.nombre || u.email || uid;
      opt.dataset.nombre = u.nombre || u.email || uid;
      if (actuales.includes(uid)) opt.selected = true;
      el.appendChild(opt);
    });
  } catch(e) { console.warn('_cargarOperariosSelect error:', e); }
}

async function _cargarOperariosCheckboxes(containerId, uidsActuales) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const actuales = Array.isArray(uidsActuales) ? uidsActuales : (uidsActuales ? [uidsActuales] : []);
  el.className = 'asig-checkbox-container';
  el.innerHTML = '<p class="txt-muted-xs">Cargando...</p>';
  try {
    const snap = await realDb.ref('usuarios').once('value');
    const usuarios = snap.val() || {};
    const items = Object.entries(usuarios).filter(([, u]) => u.estado === 'activo');
    const filas = items.map(([uid, u]) => {
      const nombre = u.nombre || u.email || uid;
      const checked = actuales.includes(uid) ? 'checked' : '';
      const sel = actuales.includes(uid) ? ' seleccionado' : '';
      return `<label class="${sel}"><input type="checkbox" value="${uid}" data-nombre="${nombre}" ${checked}> ${nombre}</label>`;
    }).join('') || '<p class="txt-muted-xs">Sin operarios disponibles</p>';
    const btnQuitar = items.length
      ? '<button type="button" class="asig-checkbox-clear" onclick="this.parentElement.querySelectorAll(\'input[type=checkbox]\').forEach(c=>c.checked=false);this.parentElement.querySelectorAll(\'label\').forEach(l=>l.classList.remove(\'seleccionado\'))">🗑 Sin asignar (quitar todos)</button>'
      : '';
    el.innerHTML = btnQuitar + filas;
    el.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => chk.closest('label').classList.toggle('seleccionado', chk.checked));
    });
  } catch(e) { console.warn('_cargarOperariosCheckboxes error:', e); }
}

async function agregarMantenimientoPeriodico() {
  const fecha        = document.getElementById('fechaMantenimiento').value;
  const operario     = document.getElementById('operarioMantenimiento').value;
  const equipo       = document.getElementById('equipoPeriodicidad').value;
  const accion       = document.getElementById('accionMantenimiento').value;
  const periodicidad = parseInt(document.getElementById('periodicidadDias').value);
  const tipoEl       = document.getElementById('tipoMantenimiento');
  const tipo         = tipoEl ? tipoEl.value : 'preventivo';
  const esTarea      = tipo === 'trabajo';

  // Equipo obligatorio solo para preventivos
  if (!fecha || !operario || (!esTarea && !equipo) || !accion || isNaN(periodicidad)) {
    alert('Por favor complete todos los campos correctamente');
    return;
  }

  const mantenimiento = {
    id:                   `MANT-${Date.now()}`,
    fecha,
    fechaUltimaEjecucion: fecha,
    operario,
    equipo:               equipo,
    accion,
    periodicidad,
    tipo:                 (document.getElementById('tipoMantenimiento')?.value === 'trabajo') ? 'trabajo' : 'preventivo',
    historial:            [],
    creadoPorUid:         _sesionAutor().uid,
    creadoPorNombre:      _sesionAutor().nombre,
    creadoPorEmail:       _sesionAutor().email,
    asignadoAUids:        [],
    asignadoANombres:     []
  };

  try {
    if (!db.mantenimientosPeriodicos) db.mantenimientosPeriodicos = [];
    db.mantenimientosPeriodicos.push(mantenimiento);
    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);

    // Routing por tipo seleccionado — criterio único
    if (esTarea) {
      guardarTrabajoPeriodico(mantenimiento);
    } else {
      guardarPreventivoEquipo(mantenimiento);
    }

    await saveToLocalStorage();

    ['fechaMantenimiento', 'operarioMantenimiento', 'equipoPeriodicidad', 'accionMantenimiento', 'periodicidadDias']
      .forEach(id => { document.getElementById(id).value = ''; });
    if (tipoEl) tipoEl.value = 'preventivo';

    actualizarListaMantenimientos();
    updateNotificationIcons();

    if (_origenAltaMantenimiento && _origenAltaMantenimiento.desde === 'equipos') {
      const origen = _origenAltaMantenimiento;
      _origenAltaMantenimiento = null;
      _equiposNav = { paso: 'equipo', familia: origen.familia, zona: origen.zona };
      showScreen('equiposScreen');
      actualizarListaEquipos();
      setTimeout(() => {
        const cards = document.querySelectorAll('.equipo-record');
        cards.forEach(c => {
          const nombreCard = c.querySelector('.equipo-record-header strong')?.textContent;
          if (nombreCard === origen.equipo) {
            c.querySelector('.eq-detail')?.classList.add('eq-detail-open');
            c.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }, 100);
    } else {
      alert('Mantenimiento periódico agregado con éxito');
    }
  } catch (error) {
    console.error('Error al agregar mantenimiento:', error);
    alert('Error al agregar el mantenimiento: ' + error.message);
  }
}

async function editarMantenimiento(id) {
  _toggleEditForm(`edit-${id}`);
  if (localStorage.getItem('usuarioRol') === 'admin') {
    const m = db.mantenimientosPeriodicos.find(m => String(m.id) === String(id));
    const selAsig = document.querySelector(`[id="newAsignado-${id}"]`);
    if (selAsig && !selAsig.dataset.cargado) {
      await _cargarOperariosCheckboxes(`newAsignado-${id}`, _getAsignadosUids(m));
      selAsig.dataset.cargado = '1';
    }
  }
}

async function renderCumplimientoOperarios() {
  const el = document.getElementById('cumplimientoResult');
  if (!el) return;
  el.innerHTML = '<p class="opacity-muted">Cargando...</p>';

  const usuarios = {};
  try {
    const snap = await realDb.ref('usuarios').once('value');
    snap.forEach(c => {
      const u = c.val();
      if (u && u.estado === 'activo') usuarios[c.key] = u.nombre || u.email;
    });
  } catch(e) { console.warn('renderCumplimientoOperarios: error cargando usuarios', e); }

  const mants  = (db.mantenimientosPeriodicos || []).filter(Boolean);
  const tareas = (db.workOrdersTareas || []).filter(Boolean);
  const ahora  = new Date(); ahora.setHours(0,0,0,0);

  const stats = {};
  function reg(uid) {
    if (!stats[uid]) stats[uid] = { asignadas: 0, completadas: 0, aTiempo: 0 };
    return stats[uid];
  }

  mants.forEach(m => {
    const uids = _getAsignadosUids(m);
    if (!uids.length) return;
    uids.forEach(uid => {
      const s = reg(uid);
      s.asignadas++;
      if (m.confirmadoPorUid) {
        s.completadas++;
        const prox = calcularProximaFecha(m);
        if (m.fechaConfirmacion && new Date(m.fechaConfirmacion) <= prox) s.aTiempo++;
      }
    });
  });

  tareas.forEach(t => {
    const uids = _getAsignadosUids(t);
    if (!uids.length) return;
    uids.forEach(uid => {
      const s = reg(uid);
      s.asignadas++;
      if (t.estado === 'completado') {
        s.completadas++;
        if (t.fechaProgramada && t.fechaEjecucion && new Date(t.fechaEjecucion) <= new Date(t.fechaProgramada)) s.aTiempo++;
        else if (!t.fechaProgramada) s.aTiempo++;
      }
    });
  });

  const filas = Object.keys(stats).map(uid => {
    const s = stats[uid];
    const tasa = s.asignadas ? Math.round((s.completadas / s.asignadas) * 100) : 0;
    return { uid, nombre: usuarios[uid] || uid, ...s, tasa };
  }).sort((a, b) => b.asignadas - a.asignadas);

  if (!filas.length) {
    el.innerHTML = '<p class="opacity-muted">No hay datos de asignación todavía.</p>';
    return;
  }

  const filasHtml = filas.map(f =>
    '<tr>' +
    '<td style="padding:4px 8px;font-size:0.85rem">' + f.nombre + '</td>' +
    '<td style="padding:4px 8px;text-align:center;font-size:0.85rem">' + f.asignadas + '</td>' +
    '<td style="padding:4px 8px;text-align:center;font-size:0.85rem">' + f.completadas + '</td>' +
    '<td style="padding:4px 8px;text-align:center;font-size:0.85rem">' + f.aTiempo + '</td>' +
    '<td style="padding:4px 8px;text-align:center;font-size:0.85rem;font-weight:600;color:' + (f.tasa >= 80 ? 'var(--green)' : f.tasa >= 50 ? 'orange' : 'var(--red)') + '">' + f.tasa + '%</td>' +
    '</tr>'
  ).join('');

  el.innerHTML = '<table class="tbl-full">' +
    '<thead><tr>' +
    '<th class="th-left">Operario</th>' +
    '<th style="padding:4px 8px;font-size:0.8rem;opacity:0.7">Asignadas</th>' +
    '<th style="padding:4px 8px;font-size:0.8rem;opacity:0.7">Completadas</th>' +
    '<th style="padding:4px 8px;font-size:0.8rem;opacity:0.7">A tiempo</th>' +
    '<th style="padding:4px 8px;font-size:0.8rem;opacity:0.7">% Cumplimiento</th>' +
    '</tr></thead><tbody>' + filasHtml + '</tbody></table>';
}

window.renderCumplimientoOperarios = renderCumplimientoOperarios;
function renderHistorialConfirmaciones() {
  const el = document.getElementById('historialConfirmacionesResult');
  if (!el) return;

  const mants  = (db.mantenimientosPeriodicos || []).filter(m => m && m.confirmadoPorUid);
  const tareas = (db.workOrdersTareas || []).filter(t => t && t.estado === 'completado' && t.confirmadoPorUid);

  const registros = [
    ...mants.map(m => {
      const prox = calcularProximaFecha(m);
      const aTiempo = m.fechaConfirmacion ? new Date(m.fechaConfirmacion) <= prox : null;
      return {
        etiqueta: [m.equipo, m.accion].filter(Boolean).join(' — '),
        operario: m.confirmadoPorNombre || '—',
        fecha: m.fechaConfirmacion || m.fechaUltimaEjecucion || '',
        obs: m.ultimaObservacion || '',
        aTiempo
      };
    }),
    ...tareas.map(t => {
      const aTiempo = (t.fechaProgramada && t.fechaEjecucion) ? new Date(t.fechaEjecucion) <= new Date(t.fechaProgramada) : null;
      return {
        etiqueta: [t.equipo, t.accion || t.descripcion].filter(Boolean).join(' — '),
        operario: t.confirmadoPorNombre || '—',
        fecha: t.fechaConfirmacion || t.fechaEjecucion || '',
        obs: t.observaciones || '',
        aTiempo
      };
    })
  ].filter(r => r.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (!registros.length) {
    el.innerHTML = '<p class="opacity-muted">No hay confirmaciones registradas todavía.</p>';
    return;
  }

  const fmt = f => new Date(f).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const filasHtml = registros.slice(0, 100).map(r => {
    const colorEstado = r.aTiempo === null ? 'var(--text)' : (r.aTiempo ? 'var(--green)' : 'var(--red)');
    const textoEstado = r.aTiempo === null ? '—' : (r.aTiempo ? '✓ A tiempo' : '⚠ Tarde');
    return '<tr>' +
      '<td style="padding:4px 8px;font-size:0.82rem">' + r.etiqueta + '</td>' +
      '<td style="padding:4px 8px;font-size:0.82rem">' + r.operario + '</td>' +
      '<td style="padding:4px 8px;font-size:0.78rem;white-space:nowrap">' + fmt(r.fecha) + '</td>' +
      '<td style="padding:4px 8px;font-size:0.78rem;color:' + colorEstado + '">' + textoEstado + '</td>' +
      '<td style="padding:4px 8px;font-size:0.78rem;opacity:0.8">' + (r.obs || '—') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML = '<table class="tbl-full">' +
    '<thead><tr>' +
    '<th class="th-left">Tarea</th>' +
    '<th class="th-left">Operario</th>' +
    '<th class="th-left">Fecha confirmación</th>' +
    '<th class="th-left">Estado</th>' +
    '<th class="th-left">Observaciones</th>' +
    '</tr></thead><tbody>' + filasHtml + '</tbody></table>';
}
window.renderHistorialConfirmaciones = renderHistorialConfirmaciones;
async function eliminarMantenimiento(id) {
  if (!confirm('¿Está seguro de eliminar este mantenimiento periódico?')) return;
  try {
    db.mantenimientosPeriodicos = db.mantenimientosPeriodicos.filter(m => m.id !== id);
    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    await saveToLocalStorage();
    actualizarListaMantenimientos();
    updateNotificationIcons();
  } catch (error) {
    console.error('Error eliminando mantenimiento:', error);
    alert('Error al eliminar el mantenimiento');
  }
}

async function guardarEdicionMantenimiento(id) {
  const newDate      = document.getElementById(`newDate-${id}`).value;
  const newOperator  = document.getElementById(`newOperator-${id}`).value;
  const newEquipment = document.getElementById(`newEquipment-${id}`).value;
  const newAction    = document.getElementById(`newAction-${id}`).value;
  const newPeriod    = parseInt(document.getElementById(`newPeriod-${id}`).value);

  if (!newDate || !newOperator || !newEquipment || !newAction || isNaN(newPeriod)) {
    alert('Por favor complete todos los campos correctamente');
    return;
  }

  try {
    const index = db.mantenimientosPeriodicos.findIndex(m => m.id === id);
    if (index === -1) throw new Error('Mantenimiento no encontrado');

    const registroPrevio = db.mantenimientosPeriodicos[index];
    const selAsig    = document.getElementById(`newAsignado-${id}`);
    const extAsig    = document.getElementById(`newAsignadoExt-${id}`);
    const marcadosSel = selAsig ? Array.from(selAsig.querySelectorAll('input[type=checkbox]:checked')) : [];
    const uidsFinal    = marcadosSel.map(c => c.value);
    const nombresFinal = marcadosSel.map(c => c.dataset.nombre);
    const extFinal     = uidsFinal.length ? '' : (extAsig?.value.trim() || '');

    db.mantenimientosPeriodicos[index] = {
      ...registroPrevio,
      fecha:                newDate,       // compatibilidad
      fechaUltimaEjecucion: newDate,       // sincronizado
      operario:             newOperator,
      equipo:               newEquipment,
      accion:               newAction,
      periodicidad:         newPeriod,
      tipo:                 registroPrevio.tipo || 'preventivo',
      asignadoAUids:        uidsFinal,
      asignadoANombres:     nombresFinal,
      asignadoAExterno:     extFinal
    };

    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    await saveToLocalStorage();
    actualizarListaMantenimientos();
    checkPastDueMaintenances();
    updateNotificationIcons();
    _hideEditForm(`edit-${id}`);
    alert('Cambios guardados con éxito');
  } catch (error) {
    console.error('Error guardando cambios:', error);
    alert('Error al guardar los cambios: ' + error.message);
  }
}
async function renderPanelAsignaciones() {
  const contenedor = document.getElementById('panelAsignacionesResult');
  if (!contenedor) return;
  contenedor.innerHTML = '<p class="opacity-muted">Cargando...</p>';

  // Cargar lista de operarios una sola vez
  const usuarios = [];
  try {
    const snap = await realDb.ref('usuarios').once('value');
    snap.forEach(c => {
      const u = c.val();
      if (u && u.estado === 'activo') usuarios.push({ uid: c.key, nombre: u.nombre || u.email });
    });
  } catch(e) { console.warn(': error cargando usuarios', e); }

  function opcionesCheckboxes(uidsActuales) {
    const actuales = Array.isArray(uidsActuales) ? uidsActuales : (uidsActuales ? [uidsActuales] : []);
    return usuarios.map(u =>
      `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;padding:1px 0">
        <input type="checkbox" value="${u.uid}" data-nombre="${u.nombre}" ${actuales.includes(u.uid) ? 'checked' : ''}> ${u.nombre}
      </label>`
    ).join('');
  }

  async function guardarAsignacion(tipo, id, uids, nombres) {
    try {
      if (tipo === 'periodico') {
        const idx = db.mantenimientosPeriodicos.findIndex(m => m.id == id);
        if (idx === -1) return;
        db.mantenimientosPeriodicos[idx].asignadoAUids    = uids;
        db.mantenimientosPeriodicos[idx].asignadoANombres = nombres;
        delete db.mantenimientosPeriodicos[idx].asignadoAUid;
        delete db.mantenimientosPeriodicos[idx].asignadoANombre;
        await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
      } else {
        const idx = db.workOrdersTareas.findIndex(m => m.id == id);
        if (idx === -1) return;
        db.workOrdersTareas[idx].asignadoAUids    = uids;
        db.workOrdersTareas[idx].asignadoANombres = nombres;
        delete db.workOrdersTareas[idx].asignadoAUid;
        delete db.workOrdersTareas[idx].asignadoANombre;
        await realDb.ref(`instalaciones/${INST()}/workOrdersTareas`).set(db.workOrdersTareas);
      }
      await saveToLocalStorage();
    } catch(e) { alert('Error guardando asignación: ' + e.message); }
  }

  function crearFila(tipo, m) {
    const tr = document.createElement('tr');
    const etiqueta = [m.equipo, m.accion || m.descripcion].filter(Boolean).join(' — ') || m.id;
    tr.dataset.tipo = tipo;
    tr.dataset.id   = m.id;
    tr.innerHTML = `
      <td style="padding:4px 8px"><input type="checkbox" class="chk-asignacion"></td>
      <td style="padding:4px 8px;font-size:0.85rem">${etiqueta}</td>
      <td style="padding:4px 8px">
        <div class="fila-asig-checkboxes" style="max-height:90px;overflow-y:auto">${opcionesCheckboxes(_getAsignadosUids(m))}</div>
      </td>
    `;
    tr.querySelector('.fila-asig-checkboxes').addEventListener('change', function() {
      const marcados = Array.from(this.querySelectorAll('input[type=checkbox]:checked'));
      const uids    = marcados.map(c => c.value);
      const nombres = marcados.map(c => c.dataset.nombre);
      guardarAsignacion(tipo, m.id, uids, nombres);
    });
    return tr;
  }

  const periodicos = (db.mantenimientosPeriodicos || []).filter(Boolean);
  const tareas     = (db.workOrdersTareas || []).filter(o => o && (!o.estado || o.estado === 'pendiente' || o.estado === 'en_curso'));

  let html = '';
  if (!periodicos.length && !tareas.length) {
    contenedor.innerHTML = '<p class="opacity-muted">No hay registros.</p>';
    return;
  }

 function crearSeccion(titulo, tipo, items) {
    if (!items.length) return null;
    const sec = document.createElement('div');
    sec.style.marginBottom = '16px';
    sec.innerHTML = `<p style="font-weight:600;margin-bottom:6px">${titulo} (${items.length})</p>`;
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse';
    table.innerHTML = `<thead><tr>
      <th style="padding:4px 8px;width:32px"></th>
      <th class="th-left">Registro</th>
      <th class="th-left">Asignado a</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    items.forEach(m => tbody.appendChild(crearFila(tipo, m)));
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  contenedor.innerHTML = '';

  const barra = document.createElement('div');
  barra.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap';
  barra.innerHTML = `
    <select id="masivo-operario" style="flex:1;font-size:0.85rem">
      <option value="">— Operario para asignación masiva —</option>
      ${usuarios.map(u => `<option value="${u.uid}" data-nombre="${u.nombre}">${u.nombre}</option>`).join('')}
    </select>
    <button class="button button--sm" id="btn-asignar-masivo" style="white-space:nowrap">✔ Asignar seleccionados</button>
    <label style="font-size:0.82rem;display:flex;align-items:center;gap:4px">
      <input type="checkbox" id="chk-todos"> Todos
    </label>
  `;
  contenedor.appendChild(barra);

  const secP = crearSeccion('⚙️ Mantenimientos / Trabajos periódicos', 'periodico', periodicos);
  const secT = crearSeccion('📋 Tareas operativas pendientes', 'tarea', tareas);
  if (secP) contenedor.appendChild(secP);
  if (secT) contenedor.appendChild(secT);

  document.getElementById('chk-todos').addEventListener('change', function() {
    contenedor.querySelectorAll('.chk-asignacion').forEach(c => c.checked = this.checked);
  });

  document.getElementById('btn-asignar-masivo').addEventListener('click', async function() {
    const sel    = document.getElementById('masivo-operario');
    const uid    = sel.value;
    const nombre = sel.selectedOptions[0]?.dataset.nombre || '';
    if (!uid) { alert('Selecciona un operario primero.'); return; }
    const marcados = contenedor.querySelectorAll('tr[data-id] .chk-asignacion:checked');
    if (!marcados.length) { alert('Marca al menos un registro.'); return; }
    this.disabled = true;
    this.textContent = 'Guardando...';
    for (const chk of marcados) {
      const tr   = chk.closest('tr');
      const tipo = tr.dataset.tipo;
      const id   = tr.dataset.id;
      const selectFila = tr.querySelector('.fila-asig-checkboxes');
      const previosChk = selectFila ? Array.from(selectFila.querySelectorAll('input[type=checkbox]:checked')) : [];
      const uidsPrevios    = previosChk.map(c => c.value);
      const nombresPrevios = previosChk.map(c => c.dataset.nombre);
      const uidsFinal    = uidsPrevios.includes(uid) ? uidsPrevios : [...uidsPrevios, uid];
      const nombresFinal = uidsPrevios.includes(uid) ? nombresPrevios : [...nombresPrevios, nombre];
      await guardarAsignacion(tipo, id, uidsFinal, nombresFinal);
      if (selectFila) selectFila.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = uidsFinal.includes(c.value));
      chk.checked = false;
    }
    document.getElementById('chk-todos').checked = false;
    this.disabled = false;
    this.textContent = '✔ Asignar seleccionados';
  });
}
async function updateMaintenanceOperator(maintenanceId, newOperator) {
  try {
    const m = db.mantenimientosPeriodicos.find(m => m.id === maintenanceId);
    if (!m) return;
    m.operario = newOperator;
    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    showPendingMaintenances();
  } catch (error) {
    console.error('Error updating maintenance operator:', error);
    alert('Error al actualizar el operario');
  }
}

async function completeMaintenance(id, buttonElement) {
  const m = db.mantenimientosPeriodicos.find(m => m.id === id);
  if (!m) { console.error('Maintenance record not found:', id); return; }

  // Pedir fecha de ejecución real al operario (por defecto hoy)
  const hoy = new Date().toISOString().split('T')[0];
  const fechaInput = prompt('Fecha de ejecución real (AAAA-MM-DD):', hoy);
  if (fechaInput === null) return; // cancelado

  const fechaEjecucion  = fechaInput.trim() || hoy;
  const fechaProgramada = calcularProximaFecha(m).toISOString().split('T')[0];
  const diasDesviacion  = Math.round(
    (new Date(fechaEjecucion) - new Date(fechaProgramada)) / (1000 * 60 * 60 * 24)
  );

  // Entrada de historial — inmutable una vez guardada
  const entradaHistorial = {
    fechaEjecucion,
    fechaProgramada,
    diasDesviacion,
    operario:         m.operario,
    observaciones:    '',
    cerradoPorUid:    _sesionAutor().uid,
    cerradoPorNombre: _sesionAutor().nombre,
    cerradoPorEmail:  _sesionAutor().email
  };

  try {
    const blob = crearExcelBlob([{
      ID:               m.id,
      Equipo:           m.equipo,
      Accion:           m.accion,
      Periodicidad:     m.periodicidad,
      FechaProgramada:  fechaProgramada,
      FechaEjecucion:   fechaEjecucion,
      DiasDesviacion:   diasDesviacion,
      Operario:         m.operario,
      Estado:           'completado'
    }], 'Mantenimiento Periódico');

    // Actualizar registro con historial y nueva fecha ancla
    if (!m.historial) m.historial = [];
    m.historial.push(entradaHistorial);
    m.fechaUltimaEjecucion = fechaEjecucion;
    m.fecha = fechaEjecucion;

    // Firebase + localStorage primero (crítico)
    await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    await saveToLocalStorage();
    checkPastDueMaintenances();
    updateNotificationIcons();

    const recordDiv = buttonElement.closest('.pending-record');
    if (recordDiv) {
      recordDiv.remove();
      if (!db.mantenimientosPeriodicos.some(esMantenimientoVencido)) {
        const popup = document.querySelector('.notification-popup');
        if (popup) popup.remove();
      }
    }

    // Historial del equipo
    await _guardarHistorialEquipo(m.equipo, {
      fecha:       fechaEjecucion,
      descripcion: m.accion || '',
      tipo:        'mantenimiento'
    });

    // GitHub export — no bloqueante, no revierte lo anterior si falla
    try {
      await _exportarInformeGitHub(
        { FechaProgramada: fechaProgramada, FechaEjecucion: fechaEjecucion,
          Equipo: m.equipo, Accion: m.accion, Estado: 'completado' },
        'Mantenimientos', 'maintenance',
        'Add completed maintenance record',
        'Mantenimiento completado y exportado a GitHub correctamente'
      );
    } catch (ghError) {
      console.error('GitHub export error (no bloqueante):', ghError);
      alert('Mantenimiento completado. No se pudo exportar a GitHub: ' + ghError.message);
    }
  } catch (error) {
    console.error('Error completing maintenance:', error);
    alert('Error al completar el mantenimiento: ' + error.message);
  }
}

// Genera partes de trabajo automáticos para mantenimientos vencidos
async function verificarMantenimientosPeriodicos() {
  if (!db.mantenimientosPeriodicos || !Array.isArray(db.mantenimientosPeriodicos)) return;
  const today = new Date();
  let maintenanceNeeded = false;

  db.mantenimientosPeriodicos.forEach(m => {
    if (!m || !m.fecha) return;
    if (new Date() > calcularProximaFecha(m)) {
      maintenanceNeeded = true;
      const equipo = db.equipos.find(e => e.id === m.equipo);
      const yaExiste = db.workOrders.some(wo => wo.equipo === m.equipo && wo.estado === 'pendiente' && wo.familia === 'MANTENIMIENTO');
      if (equipo && !yaExiste) {
        const fechaProg = calcularProximaFecha(m).toISOString().split('T')[0];
        const wo = {
          id:               Date.now(),
          fecha:            fechaProg,                                  // compatibilidad
          fechaProgramada:  fechaProg,                                  // cuándo tocaba
          fechaCreacion:    today.toISOString(),                        // cuándo se generó
          fechaEjecucion:   null,                                       // pendiente
          operario:         '',
          equipo:           m.equipo,
          descripcion:      `Mantenimiento periódico: ${m.accion}`,
          estado:           'pendiente',
          familia:          'MANTENIMIENTO',
          spareParts:       [],
          mantenimientoRef: m.id                                        // referencia cruzada
        };
        db.workOrders.push(wo);
        realDb.ref(`instalaciones/${INST()}/workOrders`).set(db.workOrders);
      }
    }
  });

  if (maintenanceNeeded) updateNotificationIcons();
}

// Añade la clase 'overdue' a los registros del DOM que correspondan
function checkPastDueMaintenances() {
  if (!db.mantenimientosPeriodicos || !Array.isArray(db.mantenimientosPeriodicos)) return;
  // Marcar elementos DOM si están visibles
  db.mantenimientosPeriodicos.forEach(m => {
    if (!m || !m.equipo) return;
    if (esMantenimientoVencido(m)) {
      try {
        const selector = `.pending-record[data-equipo="${m.equipo.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
        const recordDiv = document.querySelector(selector);
        if (recordDiv) recordDiv.classList.add('overdue');
      } catch(e) { /* selector inválido, ignorar */ }
    }
  });
  // Actualizar iconos siempre, independiente del DOM
  updateNotificationIcons();
}


/* =============================================================================
   13. LÓGICA — EQUIPOS
============================================================================= */

async function guardarEquipo() {
  const familia  = document.getElementById('equiposFamilia').value;
  const zona     = document.getElementById('equiposZona').value;
  const equipo   = document.getElementById('equiposEquipo').value;
  const modelo   = document.getElementById('equiposItem').value;
  const recambio = document.getElementById('equiposRecambio').value;
  const cantidad = parseInt(document.getElementById('equiposCantidad').value);

  if (!familia || !zona || !equipo || !modelo || !recambio || isNaN(cantidad)) {
    alert('Por favor complete todos los campos correctamente');
    return;
  }

  try {
    if (!window.equiposDb.equiposGuardados) window.equiposDb.equiposGuardados = [];
    window.equiposDb.equiposGuardados.push({ familia, zona, equipo, modelo, recambios: [{ nombre: recambio, cantidad }] });
    await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    guardarEquiposDb();

    ['equiposFamilia', 'equiposZona', 'equiposEquipo', 'equiposItem', 'equiposRecambio', 'equiposCantidad']
      .forEach(id => { document.getElementById(id).value = ''; });

    actualizarListaEquipos();
    actualizarDatalistEquipos();
    updateStockIcon();
    autoBackupEquipos();
    alert('Equipo guardado con éxito');
  } catch (error) {
    console.error('Error al guardar equipo:', error);
    alert('Error al guardar el equipo: ' + error.message);
  }
}

async function editarEquipo(index) {
  _toggleEditForm(`edit-equipo-${index}`);
}

async function eliminarEquipo(originalIndex) {
  if (!confirm('¿Está seguro de eliminar este equipo?')) return;
  try {
    const equipos = [...window.equiposDb.equiposGuardados];
    equipos.splice(originalIndex, 1);
    window.equiposDb.equiposGuardados = equipos;
    await realDb.ref(`instalaciones/${INST()}/stock`).set(equipos);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(equipos);
    guardarEquiposDb();
    actualizarListaEquipos();
    updateStockIcon();
    autoBackupEquipos();
    alert('Equipo eliminado con éxito');
  } catch (error) {
    console.error('Error al eliminar equipo:', error);
    alert('Error al eliminar el equipo: ' + error.message);
  }
}

async function agregarNuevoRecambio(equipoIndex) {
  const nombre   = document.getElementById(`nuevo-recambio-nombre-${equipoIndex}`).value.trim();
  const cantidad = parseInt(document.getElementById(`nuevo-recambio-cantidad-${equipoIndex}`).value);

  if (!nombre || isNaN(cantidad) || cantidad < 0) {
    alert('Por favor ingrese un nombre y una cantidad válida para el recambio');
    return;
  }

  const equipo = window.equiposDb.equiposGuardados[equipoIndex];
  if (!equipo.recambios) equipo.recambios = [{ nombre: equipo.recambio, cantidad: equipo.cantidad }];
  equipo.recambios.push({ nombre, cantidad });

  document.getElementById(`recambios-list-${equipoIndex}`).innerHTML =
    generarFormularioRecambios(equipo.recambios, equipoIndex);
  document.getElementById(`nuevo-recambio-nombre-${equipoIndex}`).value = '';
  document.getElementById(`nuevo-recambio-cantidad-${equipoIndex}`).value = '';
}

async function guardarEdicionEquipo(index) {
  const familia = document.getElementById(`familia-${index}`).value;
  const zona    = document.getElementById(`zona-${index}`).value;
  const equipo  = document.getElementById(`equipo-${index}`).value;
  const modelo  = document.getElementById(`modelo-${index}`).value;

  if (!familia || !zona || !equipo || !modelo) {
    alert('Por favor complete todos los campos correctamente');
    return;
  }

  const equipoActual = window.equiposDb.equiposGuardados[index];
  const numRecambios = equipoActual.recambios ? equipoActual.recambios.length : 1;
  const recambios = [];

  for (let i = 0; i < numRecambios; i++) {
    const nombre   = document.getElementById(`recambio-nombre-${index}-${i}`).value;
    const cantidad = parseInt(document.getElementById(`recambio-cantidad-${index}-${i}`).value);
    if (!nombre || isNaN(cantidad)) {
      alert('Por favor complete todos los campos de recambios correctamente');
      return;
    }
    recambios.push({ nombre, cantidad });
  }

  try {
    const equipos = [...window.equiposDb.equiposGuardados];
    equipos[index] = { familia, zona, equipo, modelo, recambios };
    window.equiposDb.equiposGuardados = equipos;
    await realDb.ref(`instalaciones/${INST()}/stock`).set(equipos);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(equipos);
    guardarEquiposDb();
    actualizarListaEquipos();
    updateStockIcon();
    alert('Cambios guardados con éxito');
  } catch (error) {
    console.error('Error al guardar cambios:', error);
    alert('Error al guardar los cambios: ' + error.message);
  }
}

// ── Helpers de normalización (usados solo por el importador) ─────────────────

function _normalizarClave(obj) {
  const nuevo = {};
  Object.keys(obj).forEach(k => { nuevo[k.toLowerCase().trim()] = obj[k]; });
  return nuevo;
}

function _limpiarData(rawText) {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/Vac.o/g, 'Vac\u00EDo');
}

function _detectarFormato(data) {
  if (Array.isArray(data)) return 'plano';
  if (data && (data.equipos || data.familias || data.zonas || data.modelos || data.recambios)) return 'estructurado';
  return 'desconocido';
}

function _convertirPlano(rows) {
  const familias = [], zonas = [], equipos = [], modelos = [], recambios = [];
  const mapEquipos = new Map();

  rows.forEach((row, i) => {
    const r        = _normalizarClave(row);
    const familia  = (r.familia  || r.family  || '').trim();
    const zona     = (r.zona     || r.zone    || r.ubicacion || '').trim();
    const equipo   = (r.equipo   || r.equip   || r.nombre   || '').trim();
    const modelo   = (r.modelo   || r.model   || '').trim();
    const recambio = (r.recambio || r.spare   || r.pieza    || '').trim();

    if (!equipo) return; // fila sin equipo → ignorar

    const esValido = v => v && v !== 'NA' && v !== 'N/A' && v !== '-' && v !== '';

    if (esValido(familia) && !familias.find(f => f.nombre === familia))
      familias.push({ id: 'FAM-' + familias.length, nombre: familia });

    if (esValido(zona) && !zonas.find(z => z.nombre === zona))
      zonas.push({ id: 'ZON-' + zonas.length, nombre: zona });

    let equipoId;
    if (!mapEquipos.has(equipo)) {
      equipoId = 'EQ-' + mapEquipos.size;
      equipos.push({ id: equipoId, nombre: equipo, zona, familia });
      mapEquipos.set(equipo, equipoId);
    } else {
      equipoId = mapEquipos.get(equipo);
    }

    if (esValido(modelo))
      modelos.push({ id: 'MOD-' + i, nombre: modelo, equipoId });

    if (esValido(recambio))
      recambios.push({ id: 'REC-' + i, nombre: recambio, equipoId, cantidad: 1 });
  });

  return { familias, zonas, equipos, modelos, recambios };
}

// ── Importador robusto ────────────────────────────────────────────────────────

function importarBibliotecaEquipos() {
  const fileInput = document.getElementById('equiposJsonFileInput');
  const file = fileInput.files[0];
  if (!file) { alert('Por favor seleccione un archivo'); return; }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      // 1. Limpiar texto raw (caracteres rotos, retornos de carro)
      const textoLimpio = _limpiarData(e.target.result);

      // 2. Parsear JSON
      let data;
      try {
        data = JSON.parse(textoLimpio);
      } catch (parseErr) {
        throw new Error('JSON no válido: ' + parseErr.message);
      }

      // 3. Detectar formato y convertir si es plano
      const formato = _detectarFormato(data);
      if (formato === 'desconocido') throw new Error('Formato no reconocido');
      if (formato === 'plano') data = _convertirPlano(data);

      // 4. Aplicar al equiposDb (solo claves presentes en el JSON)
      ['equipos', 'recambios', 'familias', 'zonas', 'modelos'].forEach(key => {
        if (data[key] && Array.isArray(data[key])) window.equiposDb[key] = data[key];
      });

      // 4b. Construir equiposGuardados (lo que renderiza la UI y los desplegables)
      // Prioridad: equiposGuardados explícito > construir desde equipos+recambios
      if (data.equiposGuardados && Array.isArray(data.equiposGuardados)) {
        window.equiposDb.equiposGuardados = data.equiposGuardados;
      } else if (data.equipos && Array.isArray(data.equipos)) {
        // Construir equiposGuardados desde el array equipos + recambios del JSON
        window.equiposDb.equiposGuardados = data.equipos.map(eq => {
          // Buscar recambios asociados a este equipo
          const recambiosEq = (data.recambios || [])
            .filter(r => r.equipoId === eq.id || r.equipo === eq.nombre || r.equipo === eq.id)
            .map(r => ({ nombre: r.nombre, cantidad: r.cantidad || 1 }));
          return {
            familia:   eq.familia  || '',
            zona:      eq.zona     || '',
            equipo:    eq.nombre   || eq.equipo || '',
            modelo:    (data.modelos || []).find(m => m.equipoId === eq.id)?.nombre || '',
            recambios: recambiosEq.length ? recambiosEq : [{ nombre: 'Sin recambio', cantidad: 0 }]
          };
        });
      }

      // 5. Persistir en Firebase (misma ruta que siempre) y localStorage
      await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
      await realDb.ref(`instalaciones/${INST()}/equiposDb`).set(window.equiposDb);
      guardarEquiposDb();
      autoBackupEquipos();

      const total = (window.equiposDb.equiposGuardados || []).length;
      alert('Biblioteca importada (' + formato + '): ' + total + ' equipo(s)');

      actualizarListaEquipos();
      actualizarDatalistEquipos();

    } catch (error) {
      console.error('importarBibliotecaEquipos error:', error);
      alert('Error al importar: ' + error.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}


/* =============================================================================
   13b. BIBLIOTECA DE EQUIPOS — exportar / backup automático local
        (importarBibliotecaEquipos ya existe en sección 13)
============================================================================= */

// Exporta la biblioteca completa como CSV (compatible con importarCSVEquipos)
function exportarBibliotecaEquipos() {
  try {
    var base = window.equiposDb.equipos || [];
    var guardados = window.equiposDb.equiposGuardados || [];
    var fusion = base.slice();
    for (var i = 0; i < guardados.length; i++) {
      var g = guardados[i];
      if (!g || !g.equipo) continue;
      var yaEsta = false;
      for (var j = 0; j < fusion.length; j++) { if (fusion[j].nombre === g.equipo) { yaEsta = true; break; } }
      if (!yaEsta) fusion.push({ id: 'EQ-man-' + i, nombre: g.equipo, familia: g.familia || '', zona: g.zona || '', ordenFamilia: 0, ordenZona: 0, ordenEquipo: 0 });
    }
    fusion.sort(function(a,b){ return (a.familia||'').localeCompare(b.familia||'') || (a.zona||'').localeCompare(b.zona||'') || (a.nombre||'').localeCompare(b.nombre||''); });
    var cabecera = 'familia,zona,equipo,modelo,recambio,cantidad,ordenzona,ordenfamilia,ordenequipo';
    var lineas = [cabecera];
    for (var i = 0; i < fusion.length; i++) {
      var eq = fusion[i];
      var eg = null;
      for (var k = 0; k < guardados.length; k++) { if (guardados[k].equipo === eq.nombre) { eg = guardados[k]; break; } }
      var modelo = eg ? (eg.modelo || '') : '';
      if (!modelo) { var mods = window.equiposDb.modelos || []; for (var m = 0; m < mods.length; m++) { if (mods[m].equipoId === eq.id) { modelo = mods[m].nombre || ''; break; } } }
      var recs = eg ? (eg.recambios || []) : [];
      if (!recs.length) { var allRecs = window.equiposDb.recambios || []; for (var r = 0; r < allRecs.length; r++) { if (allRecs[r].equipoId === eq.id) recs.push(allRecs[r]); } }
      var oZ = eq.ordenZona || eq.orden || 0;
      var oF = eq.ordenFamilia || eq.orden || 0;
      var oE = eq.ordenEquipo || eq.orden || 0;
      if (recs.length) {
        for (var r = 0; r < recs.length; r++) {
          var cols = [eq.familia||'', eq.zona||'', eq.nombre||'', modelo, recs[r].nombre||'', recs[r].cantidad !== undefined ? recs[r].cantidad : 1, oZ, oF, oE];
          lineas.push(cols.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
        }
      } else {
        var cols = [eq.familia||'', eq.zona||'', eq.nombre||'', modelo, '', '', oZ, oF, oE];
        lineas.push(cols.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
      }
    }
    var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'backup_equipos.csv'; a.click();
    URL.revokeObjectURL(url);
    alert('Biblioteca exportada con éxito');
  } catch (e) {
    console.error('exportarBibliotecaEquipos error:', e);
    alert('Error al exportar: ' + e.message);
  }
}

// ── CSV parser + importador ───────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  let header = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Split respetando comillas
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    if (!header) { header = cols.map(h => h.toLowerCase().trim()); continue; }
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    result.push(row);
  }
  return result;
}

async function importarCSVEquipos(csvText) {
  try {
    const rows = parseCSV(csvText).filter(r => r.equipo && r.equipo !== '');

    const famMap   = new Map();
    const zonaMap  = new Map();
    const equipoMap = new Map();

    const familias = [], zonas = [], equipos = [], modelos = [], recambios = [];

    const esValido = v => v && v !== 'NA' && v !== 'N/A' && v !== '-';

    rows.forEach((r, i) => {
      const familia  = r.familia  || '';
      const zona     = r.zona     || '';
      const equipo   = r.equipo   || '';
      const modelo   = r.modelo   || '';
      const recambio  = r.recambio  || '';
      const cantidad  = r.cantidad !== undefined && r.cantidad !== '' ? parseInt(r.cantidad, 10) : 1;
      const ordZona  = r.ordenzona    || r.ordzonaa || '0';
      const ordFam   = r.ordenfamilia || '0';
      const ordEq    = r.ordenequipo  || '0';

      if (esValido(familia) && !famMap.has(familia)) {
        const id = 'FAM-' + famMap.size;
        famMap.set(familia, id);
        familias.push({ id, nombre: familia, orden: ordFam });
      }

      if (esValido(zona) && !zonaMap.has(zona)) {
        const id = 'ZON-' + zonaMap.size;
        zonaMap.set(zona, id);
        zonas.push({ id, nombre: zona, orden: ordZona });
      }

      if (!equipoMap.has(equipo)) {
        const id = 'EQ-' + equipoMap.size;
        equipoMap.set(equipo, id);
        equipos.push({
          id, nombre: equipo,
          zonaId:    zonaMap.get(zona)    || '',
          familiaId: famMap.get(familia)  || '',
          zona, familia, orden: ordEq
        });
      }

      const equipoId = equipoMap.get(equipo);

      if (esValido(modelo)) {
        // Evitar modelo duplicado para el mismo equipo
        if (!modelos.find(m => m.equipoId === equipoId && m.nombre === modelo)) {
          modelos.push({ id: 'MOD-' + modelos.length, nombre: modelo, equipoId });
        }
      }

      if (esValido(recambio)) {
        if (!recambios.find(r2 => r2.equipoId === equipoId && r2.nombre === recambio)) {
          recambios.push({ id: 'REC-' + recambios.length, nombre: recambio, equipoId, cantidad });
        }
      }
    });

    // Aplicar a equiposDb
    window.equiposDb.familias  = familias;
    window.equiposDb.zonas     = zonas;
    window.equiposDb.equipos   = equipos;
    window.equiposDb.modelos   = modelos;
    window.equiposDb.recambios = recambios;

    // Construir equiposGuardados para la UI y los desplegables
    window.equiposDb.equiposGuardados = equipos.map(eq => {
      const recambiosEq = recambios
        .filter(r => r.equipoId === eq.id)
        .map(r => ({ nombre: r.nombre, cantidad: r.cantidad }));
      const modeloEq = (modelos.find(m => m.equipoId === eq.id) || {}).nombre || '';
      return {
        familia:   eq.familia,
        zona:      eq.zona,
        equipo:    eq.nombre,
        modelo:    modeloEq,
        recambios: recambiosEq.length ? recambiosEq : [{ nombre: 'Sin recambio', cantidad: 0 }]
      };
    });

    // Persistir localStorage
    guardarEquiposDb();
    autoBackupEquipos();

    // Persistir Firebase — solo las claves de equiposDb, sin tocar edarData
    await realDb.ref(`instalaciones/${INST()}/equiposDb`).set(window.equiposDb);
    await realDb.ref(`instalaciones/${INST()}/equiposDb`).set(window.equiposDb);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    await realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);
    realDb.ref(`instalaciones/${INST()}/stock`).set(window.equiposDb.equiposGuardados);

    // Refrescar UI
    actualizarListaEquipos();
    actualizarDatalistEquipos();
    updateStockIcon();

    const resumen = {
      familias: familias.length, zonas: zonas.length,
      equipos: equipos.length, modelos: modelos.length, recambios: recambios.length
    };
    console.log('Importación CSV completada', resumen);
    alert('CSV importado correctamente\n' +
      'Equipos: ' + equipos.length + ' | Familias: ' + familias.length +
      ' | Zonas: ' + zonas.length + ' | Recambios: ' + recambios.length);

  } catch (e) {
    console.error('importarCSVEquipos error:', e);
    alert('Error al importar CSV: ' + e.message);
  }
}


// Backup automático en localStorage — máx 1 copia (key fija, no acumula)
function autoBackupEquipos() {
  try {
    const copia = {
      fecha: new Date().toISOString(),
      data:  JSON.parse(JSON.stringify(window.equiposDb))
    };
    localStorage.setItem('backup_equipos_auto', JSON.stringify(copia));
    console.log('[autoBackup] backup_equipos_auto guardado');
  } catch (e) {
    console.warn('[autoBackup] error:', e.message);
  }
}

// Restaura biblioteca desde el backup automático local
function restaurarBackupEquiposLocal() {
  const raw = localStorage.getItem('backup_equipos_auto');
  if (!raw) { alert('No hay backup automático guardado'); return; }
  try {
    const copia = JSON.parse(raw);
    if (!confirm('Restaurar backup del ' + (copia.fecha ? copia.fecha.split('T')[0] : '?') + '?')) return;
    Object.assign(window.equiposDb, copia.data);
    guardarEquiposDb();
    actualizarListaEquipos();
    actualizarDatalistEquipos();
    updateStockIcon();
    alert('Backup local restaurado correctamente');
  } catch (e) {
    alert('Error al restaurar backup: ' + e.message);
  }
}

function exportarHistorialEquipo(nombreEquipo) {
  var historial = (db.historialEquipos && db.historialEquipos[nombreEquipo]) ? db.historialEquipos[nombreEquipo] : [];
  if (!historial.length) { alert('No hay historial registrado para este equipo'); return; }
  var cabecera = 'fecha,equipo,descripcion,tipo,operario';
  var lineas = [cabecera];
  for (var i = 0; i < historial.length; i++) {
    var e = historial[i];
    var cols = [e.fecha||'', nombreEquipo, e.descripcion||'', e.tipo||'', e.operario||''];
    lineas.push(cols.map(function(v){ return '"' + String(v).replace(/"/g,'""') + '"'; }).join(','));
  }
  var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = 'historial_' + nombreEquipo.replace(/[^a-z0-9]/gi,'_') + '.csv'; a.click();
  URL.revokeObjectURL(url);
}
window.exportarHistorialEquipo = exportarHistorialEquipo;

/* =============================================================================
   14. AUTOCOMPLETE
============================================================================= */

// ── Historial de equipos ────────────────────────────────────────────────────

// Guarda una intervención en el historial del equipo y sincroniza con Firebase
async function _guardarHistorialEquipo(nombreEquipo, entrada) {
  if (!nombreEquipo) return;
  if (!db.historialEquipos) db.historialEquipos = {};
  if (!db.historialEquipos[nombreEquipo]) db.historialEquipos[nombreEquipo] = [];
  db.historialEquipos[nombreEquipo].unshift(entrada); // más reciente primero
  // Limitar a 50 entradas por equipo para no inflar Firebase
  if (db.historialEquipos[nombreEquipo].length > 50)
    db.historialEquipos[nombreEquipo].length = 50;
  try {
    await realDb.ref(`instalaciones/${INST()}/historialEquipos`).set(db.historialEquipos);
    await realDb.ref(`instalaciones/${INST()}/historialEquipos`).set(db.historialEquipos);
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
  } catch (e) { console.warn('historialEquipos sync error:', e); }
}

// Muestra las últimas 3 intervenciones bajo el input indicado
function _mostrarHistorialEquipo(nombreEquipo, inputEl) {
  // Remove previous panel if any
  const prev = inputEl.parentElement.querySelector('.eq-historial-panel');
  if (prev) prev.remove();
  if (!nombreEquipo || !db.historialEquipos || !db.historialEquipos[nombreEquipo]) return;
  const entries = db.historialEquipos[nombreEquipo].slice(0, 3);
  if (!entries.length) return;
  const panel = document.createElement('div');
  panel.className = 'eq-historial-panel';
  panel.innerHTML = '<p class="eq-historial-title">Últimas intervenciones:</p>' +
    entries.map(e =>
      `<div class="eq-historial-entry">
        <span class="eq-historial-fecha">${e.fecha || ''}</span>
        <span>${e.descripcion || ''}</span>
      </div>`
    ).join('');
  inputEl.parentElement.appendChild(panel);
}

// Activa autorrelleno + historial en un input de equipo
function _activarEquipoInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.equipoHistInit) return;
  input.dataset.equipoHistInit = 'true';
  input.addEventListener('change', function() {
    const nombre = this.value.trim();
    if (!nombre) return;
    // Autorrelleno familia/ubicacion desde db.equipos si el equipo es objeto
    const eq = (db.equipos || []).find(e =>
      e && (typeof e === 'object' ? e.nombre === nombre : e === nombre)
    );
    if (eq && typeof eq === 'object') {
      const famEl = document.getElementById('equiposFamilia');
      const ubEl  = document.getElementById('equiposUbicacion');
      if (famEl && eq.familia) famEl.value = eq.familia;
      if (ubEl  && eq.ubicacion) ubEl.value = eq.ubicacion;
    }
    _mostrarHistorialEquipo(nombre, this);
  });
}

// Puebla el datalist compartido con todos los equipos de equiposGuardados
function actualizarDatalistEquipos() {
  const dl = document.getElementById('datalist-equipos');
  if (!dl) return;
  dl.innerHTML = '';

  const equiposDb = window.equiposDb;
  // Si tenemos estructura jerárquica (equipos con zona/familia/orden), usarla
  if (equiposDb.equipos && equiposDb.equipos.length) {
    // Construir mapa zona → { orden, familias: { nombre → { orden, equipos[] } } }
    const zonaMap = new Map();
    equiposDb.equipos.forEach(eq => {
      const zona     = eq.zona     || '';
      const familia  = eq.familia  || '';
      const nombre   = eq.nombre   || eq.equipo || '';
      const ordZona  = parseFloat(eq.ordenZona  || eq.orden || 0);
      const ordFam   = parseFloat(eq.ordenFamilia || 0);
      const ordEq    = parseFloat(eq.ordenEquipo || 0);
      if (!nombre) return;
      if (!zonaMap.has(zona)) zonaMap.set(zona, { orden: ordZona, familias: new Map() });
      const zonaEntry = zonaMap.get(zona);
      if (!zonaEntry.familias.has(familia)) zonaEntry.familias.set(familia, { orden: ordFam, equipos: [] });
      zonaEntry.familias.get(familia).equipos.push({ nombre, orden: ordEq });
    });

    // Ordenar zonas → familias → equipos
    const zonasOrdenadas = [...zonaMap.entries()].sort((a,b) => a[1].orden - b[1].orden || a[0].localeCompare(b[0]));
    zonasOrdenadas.forEach(([zona, zonaData]) => {
      const famsOrdenadas = [...zonaData.familias.entries()].sort((a,b) => a[1].orden - b[1].orden || a[0].localeCompare(b[0]));
      famsOrdenadas.forEach(([familia, famData]) => {
        const eqsOrdenados = famData.equipos.sort((a,b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
        eqsOrdenados.forEach(eq => {
          const opt = document.createElement('option');
          opt.value = eq.nombre;
          // Label con zona y familia para orientación visual en el datalist
          opt.label = (zona ? zona + (familia ? ' › ' + familia : '') + ' › ' : '') + eq.nombre;
          dl.appendChild(opt);
        });
      });
    });
  } else {
    // Fallback: lista plana desde equiposGuardados
    const nombres = [...new Set(
      (equiposDb.equiposGuardados || []).filter(e => e && e.equipo).map(e => e.equipo)
    )].sort();
    nombres.forEach(nombre => {
      const opt = document.createElement('option');
      opt.value = nombre;
      dl.appendChild(opt);
    });
  }
}

// Construye un <select> con <optgroup> jerárquicos en el elemento indicado
function poblarSelectEquiposJerarquico(selectEl) {
  if (!selectEl) return;
  const valorActual = selectEl.value;
  selectEl.innerHTML = '<option value="">-- Seleccionar equipo --</option>';

  const equiposDb = window.equiposDb;
  if (!equiposDb || (!equiposDb.equipos || !equiposDb.equipos.length)) {
    // Fallback plano
    (equiposDb.equiposGuardados || []).filter(e => e && e.equipo).forEach(e => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = e.equipo;
      selectEl.appendChild(opt);
    });
  } else {
    const zonaMap = new Map();
    equiposDb.equipos.forEach(eq => {
      const zona    = eq.zona    || '';
      const familia = eq.familia || '';
      const nombre  = eq.nombre  || eq.equipo || '';
      if (!nombre) return;
      const key = zona + (familia ? ' — ' + familia : '');
      if (!zonaMap.has(key)) zonaMap.set(key, { ordenZona: parseFloat(eq.ordenZona || 0), ordenFam: parseFloat(eq.ordenFamilia || 0), equipos: [] });
      zonaMap.get(key).equipos.push({ nombre, orden: parseFloat(eq.ordenEquipo || 0) });
    });

    const grupos = [...zonaMap.entries()].sort((a,b) => a[1].ordenZona - b[1].ordenZona || a[1].ordenFam - b[1].ordenFam || a[0].localeCompare(b[0]));
    grupos.forEach(([label, data]) => {
      const og = document.createElement('optgroup');
      og.label = label;
      data.equipos.sort((a,b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)).forEach(eq => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = eq.nombre;
        og.appendChild(opt);
      });
      selectEl.appendChild(og);
    });
  }

  // Restaurar selección previa si sigue existiendo
  if (valorActual) selectEl.value = valorActual;
}

function setupAutocomplete() {
  actualizarDatalistEquipos();
  [
    'workOrderEquipo','equipoPeriodicidad','correctivoEquipo','equipoModificativo',
    'incidenciaEquipo','rutinaEquipo','preventivoEquipo'
  ].forEach(_activarEquipoInput);
}


/* =============================================================================
   SELECTOR JERÁRQUICO DE EQUIPOS (POPUP)
   Mantiene el input+datalist original intacto.
   El botón "🔍 Buscar" abre un popup guiado Zona → Familia → Equipo.
   Al seleccionar, rellena el input original y cierra el popup.
============================================================================= */

const equipoPicker = (() => {
  let _targetId = null;    // ID del input a rellenar
  let _paso     = 'zona';  // 'zona' | 'familia' | 'equipo'
  let _zona     = null;
  let _familia  = null;

  function _getEquipos() {
    const base = (window.equiposDb && window.equiposDb.equipos) ? [...window.equiposDb.equipos] : [];
    const guardados = (window.equiposDb && window.equiposDb.equiposGuardados || [])
      .filter(e => e && e.equipo)
      .map(e => ({ nombre: e.equipo, familia: e.familia || 'Sin familia', zona: e.zona || 'Sin zona', ordenFamilia: 0, ordenZona: 0, ordenEquipo: 0 }));

    // Fusionar: añadir de equiposGuardados solo los que no existan ya en base por nombre
    guardados.forEach(g => {
      if (!base.find(b => b.nombre === g.nombre)) base.push(g);
    });

    return base;
  }

  function _modal()       { return document.getElementById('equipoPickerModal');      }
  function _lista()       { return document.getElementById('equipoPickerLista');       }
  function _titulo()      { return document.getElementById('equipoPickerTitulo');      }
  function _breadcrumb()  { return document.getElementById('equipoPickerBreadcrumb'); }
  function _btnAtras()    { return document.getElementById('equipoPickerAtras');       }

  function _renderItems(items) {
    const lista = _lista();
    lista.innerHTML = '';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'button';
      btn.style.cssText = 'text-align:left;width:100%;padding:10px 14px;font-size:0.9rem';
      btn.textContent = item.label;
      btn.onclick = () => item.action();
      lista.appendChild(btn);
    });
  }

  function _showZonas() {
    // kept for back navigation compatibility
    _showFamilias();
  }

  function _showZonasDeFamilia(familia) {
    _paso = 'zona'; _familia = familia;
    _titulo().textContent = 'Seleccionar zona';
    _breadcrumb().textContent = familia;
    _btnAtras().style.display = '';

    const zonas = new Map();
    _getEquipos().filter(eq => eq && eq.familia === familia).forEach(eq => {
      if (eq.zona && !zonas.has(eq.zona))
        zonas.set(eq.zona, parseFloat(eq.ordenZona || 0));
    });

    const items = [...zonas.entries()]
      .sort((a,b) => a[1]-b[1] || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
      .map(([zona]) => ({ label: '📍 ' + zona, action: () => _showEquipos(zona, familia) }));

    _renderItems(items);
  }

  function _showFamilias(zona) {
    _paso = 'familia'; _zona = zona || null;
    _titulo().textContent = 'Seleccionar familia';
    _breadcrumb().textContent = '';
    _btnAtras().style.display = 'none';  // first step, no back

    const familias = new Map();
    const equipos = zona
      ? _getEquipos().filter(eq => eq && eq.zona === zona)
      : _getEquipos();
    equipos.forEach(eq => {
      if (eq && eq.familia && !familias.has(eq.familia))
        familias.set(eq.familia, parseFloat(eq.ordenFamilia || 0));
    });

    const items = [...familias.entries()]
      .sort((a,b) => a[1]-b[1] || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
      .map(([familia]) => ({ label: '📂 ' + familia, action: () => _showZonasDeFamilia(familia) }));

    _renderItems(items);
  }

  function _showEquipos(zona, familia) {
    _paso = 'equipo'; _familia = familia;
    _titulo().textContent = 'Seleccionar equipo';
    _breadcrumb().textContent = zona + ' › ' + familia;
    _btnAtras().style.display = '';

    const equipos = _getEquipos()
      .filter(eq => eq && eq.zona === zona && eq.familia === familia)
      .sort((a,b) => parseFloat(a.ordenEquipo||0)-parseFloat(b.ordenEquipo||0) || (a.nombre||'').localeCompare(b.nombre||''));

    const items = equipos.map(eq => ({
      label: '⚙️ ' + (eq.nombre || eq.equipo || ''),
      action: () => _seleccionar(eq.nombre || eq.equipo || '')
    }));

    _renderItems(items);
  }

  function _seleccionar(nombre) {
    const input = document.getElementById(_targetId);
    if (input) {
      input.value = nombre;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    cerrar();
  }

  function abrir(targetId) {
    _targetId = targetId;
    const modal = _modal();
    modal.style.display = 'flex';
    _showFamilias();
  }

  function cerrar() {
    _modal().style.display = 'none';
  }

  function atras() {
    if (_paso === 'equipo') _showZonasDeFamilia(_familia);
    else if (_paso === 'zona') _showFamilias();
  }

  return { abrir, cerrar, atras };
})();

window.equipoPicker = equipoPicker;

/* =============================================================================
   GESTIÓN DE INSTALACIONES
   - Lista en Firebase: instalaciones/{id}/meta { nombre, creadaEn }
   - Selección activa en localStorage('instalacionActiva')
   - Cualquier usuario puede cambiar de instalación
============================================================================= */

// Carga la lista de instalaciones desde Firebase y pinta el selector
// ── Sesión de instalación ────────────────────────────────────────────────────
// Sesión de instalación persistente en localStorage (admin nunca necesita PIN)
function _sesionActiva(instId) {
  const user = auth.currentUser;
  // Admin autenticado: acceso libre a cualquier instalación sin PIN
  const rol = localStorage.getItem('usuarioRol');
  if (user && !user.isAnonymous && rol === 'admin') return true;
  // Operario: comprobar si ya validó PIN en este dispositivo
  return localStorage.getItem('sesion_pin_' + instId) === 'ok';
}
function _guardarSesion(instId) {
  localStorage.setItem('sesion_pin_' + instId, 'ok');
}
function cerrarSesion() {
  const id = localStorage.getItem('instalacionActiva');
  // NO borramos sesion_pin_* al cerrar sesión normal — el PIN sigue válido en el dispositivo
  localStorage.removeItem('instalacionActiva');
  localStorage.removeItem(LS_KEY_APP);
  localStorage.removeItem(LS_KEY_EQUIPOS);
  localStorage.removeItem('usuarioUid');
  localStorage.removeItem('usuarioRol');
  localStorage.removeItem('usuarioNombre');
  localStorage.removeItem('usuarioEmail');
  window.location.reload();
}

async function cargarInstalaciones() {
  const contenedor = document.getElementById('listaInstalaciones');
  const enterBtn   = document.getElementById('enterBtn');
  if (!contenedor) return;

  try {
    const snap = await realDb.ref('instalaciones').once('value');
    const data  = snap.val() || {};
    let ids   = Object.keys(data).filter(k => data[k] && data[k].meta);

    if (!ids.length) {
      contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Sin instalaciones configuradas.<br>Acceso directo disponible.</p>';
      if (enterBtn) enterBtn.disabled = false;  // allow direct entry
      return;
    }

    ids.sort((a,b) => (data[a].meta.creadaEn || '').localeCompare(data[b].meta.creadaEn || ''));

    // Fase 3: filtrar instalaciones por usuario autenticado
    const _userAuth = auth.currentUser;
    if (_userAuth && !_userAuth.isAnonymous) {
      const _perfilSnap = await realDb.ref('usuarios/' + _userAuth.uid).once('value');
      const _perfil = _perfilSnap.val();
      if (_perfil && _perfil.rol !== 'admin') {
        const asignadas = Array.isArray(_perfil.instalaciones) ? _perfil.instalaciones
                        : Array.isArray(_perfil.Instalaciones) ? _perfil.Instalaciones
                        : [];
        ids = ids.filter(id => asignadas.includes(id));
        if (!ids.length) {
          contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Sin instalaciones asignadas.<br>Contacta con el administrador.</p>';
          return;
        }
      }
    }

    contenedor.innerHTML = '';
    const activa = localStorage.getItem('instalacionActiva') || '';

    // Ocultar formulario login y mostrar panel instalaciones
    const panelBot  = document.getElementById('panelBotonesAcceso');
    const panelLogin = document.getElementById('loginEmailPanel');
    const panelInst = document.getElementById('panelInstalaciones');
    const nombreEl  = document.getElementById('loginUsuarioNombre');
    if (panelBot)   panelBot.style.display   = 'none';
    if (panelLogin) panelLogin.style.display  = 'none';
    if (panelInst)  panelInst.style.display   = 'flex';
    if (nombreEl) {
      const n = localStorage.getItem('usuarioNombre') || '';
      if (n) nombreEl.textContent = '✓ ' + n;

      // Mostrar botón admin y botones protegidos solo si rol admin
    const esAdmin = localStorage.getItem('usuarioRol') === 'admin';
    const adminBtn = document.getElementById('adminBtn');
    const workOrderBtn = document.getElementById('workOrderBtn');
    const equiposBtn = document.getElementById('equiposBtn');
    if (adminBtn)      adminBtn.style.display      = esAdmin ? '' : 'none';
    if (workOrderBtn)  workOrderBtn.style.display   = esAdmin ? '' : 'none';
    if (equiposBtn)    equiposBtn.style.display      = esAdmin ? '' : 'none';
    const cerrarBtn = document.getElementById('cerrarSesionBtn');
    if (cerrarBtn) cerrarBtn.style.display = '';
    actualizarBadgeNotificaciones();
    }

    ids.forEach(id => {
      const nombre   = data[id].meta.nombre || id;
      const sesionOk = _sesionActiva(id);
      const esActiva = id === activa && sesionOk;
      const pendiente = _instalacionTienePendientes(data[id]);
      const card     = document.createElement('div');
      card.className = 'inst-card' + (esActiva ? ' inst-card--activa' : '');
      card.innerHTML = `
        <div class="inst-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
            <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
          </svg>
        </div>
        <div class="inst-card__info">
          <span class="inst-card__nombre" style="${pendiente ? 'color:var(--red)' : ''}">${pendiente ? '⚠️ ' : ''}${nombre}</span>
          <span class="inst-card__estado">${esActiva ? '✓ Sesión activa' : 'Pulsa para acceder'}${pendiente ? ' · Trabajo pendiente' : ''}</span>
        </div>
        <div class="inst-card__arrow">›</div>`;
      card.onclick = () => seleccionarInstalacion(id, data[id].meta);
      contenedor.appendChild(card);
    });

    // Si hay sesión activa válida, habilitar Entrar
    if (activa && ids.includes(activa) && _sesionActiva(activa)) {
      if (enterBtn) enterBtn.disabled = false;
      _actualizarTituloInstalacion(data[activa].meta.nombre || activa);
    } else {
      if (enterBtn) enterBtn.disabled = true;
    }

  } catch(e) {
    console.error('cargarInstalaciones error:', e);
    contenedor.innerHTML = '<p style="color:var(--red)">Error al cargar instalaciones</p>';
  }
}

async function seleccionarInstalacion(id, meta) {
  const nombre = meta.nombre || id;

  // Cerrar sesión de la instalación anterior (si es distinta)
  const anterior = localStorage.getItem('instalacionActiva');
  if (anterior && anterior !== id) {
    sessionStorage.removeItem('sesion_' + anterior);
  }

  // Si ya hay sesión activa para esta instalación, solo seleccionarla
  if (_sesionActiva(id)) {
    localStorage.setItem('instalacionActiva', id);
    window.location.reload();
    return;
  }

  // Pedir contraseña de la instalación
  const pin = prompt(`Contraseña para "${nombre}":`);
  if (pin === null) return; // cancelado

  if (pin !== (meta.pin || '')) {
    alert('Contraseña incorrecta');
    return;
  }

  _guardarSesion(id);
  localStorage.setItem('instalacionActiva', id);
  window.location.reload();
}

async function crearInstalacion() {
  // Solo admin puede crear instalaciones
  if (!verificarPin()) { alert('Código de administrador incorrecto'); return; }

  const input  = document.getElementById('nuevaInstalacionNombre');
  const nombre = (input ? input.value : '').trim();
  if (!nombre) { alert('Escribe un nombre para la instalación'); return; }

  const pinInst = prompt(`Contraseña de acceso para "${nombre}":`);
  if (!pinInst || !pinInst.trim()) { alert('La contraseña no puede estar vacía'); return; }

  const id = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (!id) { alert('Nombre no válido'); return; }

  try {
    const snap = await realDb.ref(`instalaciones/${id}/meta`).once('value');
    if (snap.val()) { alert('Ya existe una instalación con ese nombre'); return; }

    await realDb.ref(`instalaciones/${id}/meta`).set({
      nombre,
      pin:      pinInst.trim(),
      creadaEn: new Date().toISOString()
    });

    if (input) input.value = '';
    alert(`Instalación "${nombre}" creada correctamente`);
    // Recargar lista si estamos en adminScreen
    const adminLista = document.getElementById('listaInstalacionesAdmin');
    if (adminLista) cargarInstalacionesAdmin();
  } catch(e) {
    alert('Error al crear instalación: ' + e.message);
  }
}

// Lista de instalaciones para pantalla admin
async function cargarInstalacionesAdmin() {
  const contenedor = document.getElementById('listaInstalacionesAdmin');
  if (!contenedor) return;
  try {
    const snap = await realDb.ref('instalaciones').once('value');
    const data  = snap.val() || {};
    let ids   = Object.keys(data).filter(k => data[k] && data[k].meta);
    if (!ids.length) { contenedor.innerHTML = '<p style="color:var(--text-muted)">Sin instalaciones</p>'; return; }
    ids.sort((a,b) => (data[a].meta.creadaEn||'').localeCompare(data[b].meta.creadaEn||''));
    contenedor.innerHTML = ids.map(id =>
      `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <strong>${data[id].meta.nombre || id}</strong>
        <span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px">${id}</span>
      </div>`
    ).join('');
  } catch(e) { contenedor.innerHTML = '<p style="color:var(--red)">Error</p>'; }
}

function _actualizarTituloInstalacion(nombre) {
  const titulo = document.getElementById('mainTitleInstalacion');
  if (titulo) titulo.textContent = nombre || 'EDAR';
  // También actualizar título de menú si existe
  const menuTitle = document.querySelector('#menuScreen .title');
  if (menuTitle) menuTitle.textContent = nombre || 'Menú';
}

window.cargarInstalaciones       = cargarInstalaciones;
window.seleccionarInstalacion    = seleccionarInstalacion;
window.crearInstalacion          = crearInstalacion;
window.cargarInstalacionesAdmin  = cargarInstalacionesAdmin;
window.cerrarSesion              = cerrarSesion;

// ── Fase 4: gestión de usuarios desde panel admin ────────────────────────────

async function cargarUsuariosAdmin() {
  const contenedor = document.getElementById('listaUsuariosAdmin');
  if (!contenedor) return;
  contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Cargando...</p>';
  try {
    const [snapUsuarios, snapInst] = await Promise.all([
      realDb.ref('usuarios').once('value'),
      realDb.ref('instalaciones').once('value')
    ]);
    const usuarios     = snapUsuarios.val() || {};
    const instalaciones = snapInst.val() || {};
    const instIds      = Object.keys(instalaciones).filter(k => instalaciones[k] && instalaciones[k].meta);

    if (!Object.keys(usuarios).length) {
      contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Sin usuarios registrados</p>';
      return;
    }

    contenedor.innerHTML = '';
    Object.entries(usuarios).forEach(([uid, u]) => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border)';
      const estadoColor = u.estado === 'activo' ? 'var(--green)' : u.estado === 'pendiente' ? 'orange' : 'var(--red)';
      const instOpts = instIds.map(id =>
        `<option value="${id}" ${(u.instalaciones||[]).includes(id) ? 'selected' : ''}>${instalaciones[id].meta.nombre || id}</option>`
      ).join('');
      div.innerHTML = `
        <strong>${u.nombre || u.email}</strong>
        <span style="font-size:0.75rem;color:${estadoColor};margin-left:8px">${u.estado || 'pendiente'}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px">${u.rol || 'operario'}</span>
        <p style="font-size:0.78rem;color:var(--text-muted);margin:2px 0">${u.email || ''}</p>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
          <button class="button" style="font-size:0.78rem;padding:4px 10px" onclick="cambiarEstadoUsuario('${uid}','activo')">✓ Activar</button>
          <button class="button back-button" style="font-size:0.78rem;padding:4px 10px" onclick="cambiarEstadoUsuario('${uid}','bloqueado')">✗ Bloquear</button>
          <button class="button back-button" style="font-size:0.78rem;padding:4px 10px" onclick="cambiarRolUsuario('${uid}','${u.rol === 'admin' ? 'operario' : 'admin'}')">
            ${u.rol === 'admin' ? '👤 Quitar admin' : '⭐ Hacer admin'}
          </button>
        </div>
        <div style="margin-top:6px">
          <label style="font-size:0.78rem">Instalaciones autorizadas:</label>
          <select id="instSelect-${uid}" multiple style="width:100%;margin-top:4px;height:${Math.min(instIds.length,4)*28}px;background:var(--bg-input,#1e1e1e);color:var(--text);border:1px solid var(--border);border-radius:6px">
            ${instOpts}
          </select>
          <button class="button" style="font-size:0.78rem;padding:4px 10px;margin-top:4px" onclick="guardarInstalacionesUsuario('${uid}')">💾 Guardar instalaciones</button>
        </div>`;
      contenedor.appendChild(div);
    });
  } catch(e) {
    contenedor.innerHTML = '<p style="color:var(--red)">Error al cargar usuarios: ' + e.message + '</p>';
  }
}

async function cambiarEstadoUsuario(uid, estado) {
  await realDb.ref('usuarios/' + uid + '/estado').set(estado);
  cargarUsuariosAdmin();
}

async function cambiarRolUsuario(uid, rol) {
  await realDb.ref('usuarios/' + uid + '/rol').set(rol);
  cargarUsuariosAdmin();
}

async function guardarInstalacionesUsuario(uid) {
  const select = document.getElementById('instSelect-' + uid);
  if (!select) return;
  const seleccionadas = Array.from(select.selectedOptions).map(o => o.value);
  try {
    await realDb.ref('usuarios/' + uid + '/instalaciones').set(seleccionadas);
    alert('Instalaciones guardadas');
  } catch(e) {
    alert('Error al guardar instalaciones: ' + e.message);
  }
}

window.cargarUsuariosAdmin        = cargarUsuariosAdmin;
window.cambiarEstadoUsuario       = cambiarEstadoUsuario;
window.cambiarRolUsuario          = cambiarRolUsuario;
window.guardarInstalacionesUsuario = guardarInstalacionesUsuario;

/* =============================================================================
   NOTIFICACIONES — avisos del admin a los usuarios
============================================================================= */

function _notifEsParaMi(notif, uid) {
  if (!notif || !notif.destinatarios) return false;
  return notif.destinatarios.includes('todos') || notif.destinatarios.includes(uid);
}

async function _obtenerNotificacionesUsuario() {
  const uid = localStorage.getItem('usuarioUid');
  if (!uid) return [];
  const snap = await realDb.ref('notificaciones').once('value');
  const data = snap.val() || {};
  return Object.entries(data)
    .filter(([id, n]) => _notifEsParaMi(n, uid) && !(n.eliminadoPor && n.eliminadoPor[uid]))
    .map(([id, n]) => ({ id, ...n }))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
}

async function _obtenerAvisosVencidosUsuario() {
  const uid = localStorage.getItem('usuarioUid');
  if (!uid) return [];
  try {
    const uSnap = await realDb.ref(`usuarios/${uid}/instalaciones`).once('value');
    const instIds = uSnap.val() || [];
    if (!instIds.length) return [];
    const ahora = new Date(); ahora.setHours(0,0,0,0);
    const avisos = [];
    await Promise.all(instIds.map(async (instId) => {
      const snap = await realDb.ref(`instalaciones/${instId}`).once('value');
      const inst = snap.val();
      if (!inst) return;
      const nombreInst = (inst.meta && inst.meta.nombre) || instId;
      const mants   = (inst.mantenimientosPeriodicos || []).filter(Boolean);
      const tareas  = (inst.workOrdersTareas  || []).filter(Boolean);
      const averias = (inst.workOrdersAverias || []).filter(Boolean);

      mants.forEach(m => {
        if (_getAsignadosUids(m).includes(uid) && esMantenimientoVencido(m)) {
          avisos.push({ titulo: [m.equipo, m.accion].filter(Boolean).join(' — '), instalacion: nombreInst, tipo: 'mantenimiento' });
        }
      });
      [...tareas, ...averias].forEach(t => {
        const abierto = !t.estado || t.estado === 'pendiente' || t.estado === 'en_curso';
        if (abierto && _getAsignadosUids(t).includes(uid) && t.fechaProgramada && new Date(t.fechaProgramada) < ahora) {
          avisos.push({ titulo: [t.equipo, t.accion || t.descripcion].filter(Boolean).join(' — '), instalacion: nombreInst, tipo: t.tipo === 'averia' ? 'averia' : 'tarea' });
        }
      });
    }));
    return avisos;
  } catch(e) { console.warn('_obtenerAvisosVencidosUsuario error:', e); return []; }
}

function _formatFechaNotif(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

async function actualizarBadgeNotificaciones() {
  const badge = document.getElementById('notifBadge');
  const bell  = document.getElementById('notifBellBtn');
  if (!badge || !bell) return;
  try {
    const uid = localStorage.getItem('usuarioUid');
    if (!uid) { badge.style.display = 'none'; bell.classList.remove('notif-bell--activa'); return; }
    const [lista, avisos] = await Promise.all([_obtenerNotificacionesUsuario(), _obtenerAvisosVencidosUsuario()]);
    const noLeidas = lista.filter(n => !(n.leidoPor && n.leidoPor[uid])).length;
    const total = noLeidas + avisos.length;
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = '';
      bell.classList.add('notif-bell--activa');
    } else {
      badge.style.display = 'none';
      bell.classList.remove('notif-bell--activa');
    }
  } catch(e) { console.error('actualizarBadgeNotificaciones error:', e); }
}

async function abrirNotificaciones() {
  const modal = document.getElementById('notifModal');
  const lista = document.getElementById('notifModalLista');
  if (!modal || !lista) return;
  modal.style.display = 'flex';
  lista.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Cargando...</p>';
  const uid = localStorage.getItem('usuarioUid');
  const [notifs, avisos] = await Promise.all([_obtenerNotificacionesUsuario(), _obtenerAvisosVencidosUsuario()]);

  let html = '<p style="font-weight:700;margin:0 0 6px">📢 Notificaciones</p>';
  if (!notifs.length) {
    html += '<p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 14px">No tienes notificaciones.</p>';
  } else {
    html += notifs.map(n => {
      const leida = !!(n.leidoPor && n.leidoPor[uid]);
      return `<div class="notif-item${leida ? '' : ' notif-item--noleida'}">
        <p class="notif-item__fecha">${_formatFechaNotif(n.fecha)} · ${n.autor || 'Administración'}</p>
        <p class="notif-item__mensaje">${n.mensaje}</p>
        <div class="notif-item__acciones">
          ${leida ? `<button class="button back-button" style="font-size:0.75rem;padding:4px 10px" onclick="eliminarNotificacionUsuario('${n.id}')">🗑️ Eliminar</button>`
                  : `<button class="button" style="font-size:0.75rem;padding:4px 10px" onclick="marcarNotificacionLeida('${n.id}')">✓ Marcar como leída</button>`}
        </div>
      </div>`;
    }).join('') + '<div style="margin-bottom:14px"></div>';
  }

  html += '<p style="font-weight:700;margin:0 0 6px">⚠️ Trabajos vencidos</p>';
  if (!avisos.length) {
    html += '<p style="color:var(--text-muted);font-size:0.85rem">No tienes trabajos vencidos.</p>';
  } else {
    html += avisos.map(a => `
      <div class="notif-item notif-item--noleida">
        <p class="notif-item__mensaje">Tienes ${a.tipo === 'mantenimiento' ? 'un mantenimiento' : a.tipo === 'averia' ? 'una avería' : 'un trabajo'} asignado en <strong>${a.instalacion}</strong>${a.titulo ? ' — ' + a.titulo : ''}</p>
      </div>`).join('');
  }

  lista.innerHTML = html;
}

function cerrarNotificaciones() {
  const modal = document.getElementById('notifModal');
  if (modal) modal.style.display = 'none';
}

async function marcarNotificacionLeida(id) {
  const uid = localStorage.getItem('usuarioUid');
  if (!uid) return;
  try {
    await realDb.ref(`notificaciones/${id}/leidoPor/${uid}`).set(true);
    await abrirNotificaciones();
    await actualizarBadgeNotificaciones();
  } catch(e) { alert('Error al marcar como leída: ' + e.message); }
}

async function eliminarNotificacionUsuario(id) {
  const uid = localStorage.getItem('usuarioUid');
  if (!uid) return;
  try {
    await realDb.ref(`notificaciones/${id}/eliminadoPor/${uid}`).set(true);
    await abrirNotificaciones();
    await actualizarBadgeNotificaciones();
  } catch(e) { alert('Error al eliminar: ' + e.message); }
}

async function cargarDestinatariosNotifAdmin() {
  await _cargarOperariosCheckboxes('notifAdminDestinatarios', []);
}

async function enviarNotificacionAdmin() {
  const mensajeEl = document.getElementById('notifAdminMensaje');
  const todosEl   = document.getElementById('notifAdminTodos');
  const mensaje   = (mensajeEl ? mensajeEl.value : '').trim();
  if (!mensaje) { alert('Escribe un mensaje'); return; }

  let destinatarios;
  if (todosEl && todosEl.checked) {
    destinatarios = ['todos'];
  } else {
    destinatarios = Array.from(document.querySelectorAll('#notifAdminDestinatarios input[type="checkbox"]:checked')).map(c => c.value);
    if (!destinatarios.length) { alert('Selecciona al menos un destinatario, o marca "Todos"'); return; }
  }

  try {
    await realDb.ref('notificaciones').push({
      mensaje,
      fecha: new Date().toISOString(),
      autor: localStorage.getItem('usuarioNombre') || 'Administración',
      destinatarios
    });
    if (mensajeEl) mensajeEl.value = '';
    if (todosEl) todosEl.checked = false;
    document.querySelectorAll('#notifAdminDestinatarios input[type="checkbox"]').forEach(c => c.checked = false);
    alert('Notificación enviada');
    cargarNotificacionesAdmin();
  } catch(e) {
    alert('Error al enviar la notificación: ' + e.message);
  }
}

async function cargarNotificacionesAdmin() {
  const contenedor = document.getElementById('notifAdminLista');
  if (!contenedor) return;
  contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Cargando...</p>';
  try {
    const snap = await realDb.ref('notificaciones').once('value');
    const data = snap.val() || {};
    const ids = Object.keys(data).sort((a,b) => (data[b].fecha||'').localeCompare(data[a].fecha||''));
    if (!ids.length) {
      contenedor.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No hay notificaciones enviadas</p>';
      return;
    }
    contenedor.innerHTML = ids.map(id => {
      const n = data[id];
      const dest = (n.destinatarios||[]).includes('todos') ? 'Todos los usuarios' : `${(n.destinatarios||[]).length} usuario(s)`;
      const leidas = Object.keys(n.leidoPor || {}).length;
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <p style="font-size:0.78rem;color:var(--text-muted);margin:0">${_formatFechaNotif(n.fecha)} · ${dest} · ${leidas} leída(s)</p>
          <p style="margin:4px 0">${n.mensaje}</p>
          <button class="button back-button" style="font-size:0.75rem;padding:4px 10px;color:var(--red)" onclick="eliminarNotificacionGlobal('${id}')">🗑️ Eliminar para todos</button>
        </div>`;
    }).join('');
  } catch(e) {
    contenedor.innerHTML = '<p style="color:var(--red)">Error al cargar notificaciones</p>';
  }
}

async function eliminarNotificacionGlobal(id) {
  if (!confirm('¿Eliminar esta notificación para todos los usuarios?')) return;
  try {
    await realDb.ref('notificaciones/' + id).remove();
    cargarNotificacionesAdmin();
  } catch(e) {
    alert('Error al eliminar: ' + e.message);
  }
}

async function _archivarHistorialTrabajo(entry) {
  try {
    await realDb.ref(`instalaciones/${INST()}/historialTrabajos`).push({
      origen:        entry.origen || 'desconocido',
      equipo:        entry.equipo || '',
      descripcion:   entry.descripcion || '',
      fecha:         entry.fecha || '',
      uid:           entry.uid || '',
      nombre:        entry.nombre || '',
      fechaRegistro: new Date().toISOString()
    });
  } catch(e) { console.warn('_archivarHistorialTrabajo error:', e); }
}

const ORIGEN_LABELS_HIST = {
  preventivo:     'Mantenimiento preventivo',
  tareaOperativa: 'Tarea operativa',
  correctivo:     'Correctivo',
  modificativo:   'Modificativo',
  parteTrabajo:   'Parte de trabajo',
  averiaAntigua:  'Avería (registro antiguo)',
  desconocido:    'Sin clasificar'
};

async function cargarSelectHistorialUsuarios() {
  const sel = document.getElementById('historialUsuarioSelect');
  if (!sel) return;
  const actual = sel.value;
  try {
    const snap = await realDb.ref('usuarios').once('value');
    const usuarios = snap.val() || {};
    sel.innerHTML = '<option value="">— Selecciona un usuario —</option>' +
      Object.entries(usuarios).map(([uid, u]) => `<option value="${uid}">${u.nombre || u.email || uid}</option>`).join('');
    if (actual) sel.value = actual;
  } catch(e) { console.warn('cargarSelectHistorialUsuarios error:', e); }
}

async function cargarHistorialUsuarioAdmin(uid) {
  const resumen = document.getElementById('historialUsuarioResumen');
  const detalle = document.getElementById('historialUsuarioDetalle');
  if (!resumen || !detalle) return;
  if (!uid) { resumen.innerHTML = ''; detalle.innerHTML = ''; return; }
  resumen.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Cargando...</p>';
  detalle.innerHTML = '';
  try {
    const instSnap = await realDb.ref(`usuarios/${uid}/instalaciones`).once('value');
    const instIds = instSnap.val() || [];
    if (!instIds.length) {
      resumen.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Este usuario no tiene instalaciones asignadas.</p>';
      return;
    }
    const registros = [];
    await Promise.all(instIds.map(async (instId) => {
      const [histSnap, nombreSnap] = await Promise.all([
        realDb.ref(`instalaciones/${instId}/historialTrabajos`).orderByChild('uid').equalTo(uid).once('value'),
        realDb.ref(`instalaciones/${instId}/meta/nombre`).once('value')
      ]);
      const nombreInst = nombreSnap.val() || instId;
      const data = histSnap.val() || {};
      Object.values(data).forEach(r => registros.push({ ...r, instalacion: nombreInst }));
    }));
    registros.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const conteo = {};
    registros.forEach(r => { conteo[r.origen] = (conteo[r.origen] || 0) + 1; });

    resumen.innerHTML = Object.entries(conteo).map(([origen, n]) => `
      <span style="display:inline-block;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;margin:0 6px 6px 0;font-size:0.85rem">
        <strong>${n}</strong> ${ORIGEN_LABELS_HIST[origen] || origen}
      </span>`).join('') || '<p style="color:var(--text-muted);font-size:0.85rem">Sin registros todavía.</p>';

    detalle.innerHTML = registros.map(r => `
      <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
        <strong>${r.fecha || '(sin fecha)'}</strong> · ${ORIGEN_LABELS_HIST[r.origen] || r.origen} · ${r.instalacion}<br>
        <span style="color:var(--text-muted)">${[r.equipo, r.descripcion].filter(Boolean).join(' — ')}</span>
      </div>`).join('');
  } catch(e) {
    resumen.innerHTML = '<p style="color:var(--red)">Error al cargar el historial</p>';
    console.warn('cargarHistorialUsuarioAdmin error:', e);
  }
}

window.cargarSelectHistorialUsuarios = cargarSelectHistorialUsuarios;
window.cargarHistorialUsuarioAdmin   = cargarHistorialUsuarioAdmin;

window._archivarHistorialTrabajo = _archivarHistorialTrabajo;
window.actualizarBadgeNotificaciones   = actualizarBadgeNotificaciones;
window.abrirNotificaciones             = abrirNotificaciones;
window.cerrarNotificaciones            = cerrarNotificaciones;
window.marcarNotificacionLeida         = marcarNotificacionLeida;
window.eliminarNotificacionUsuario     = eliminarNotificacionUsuario;
window.cargarDestinatariosNotifAdmin   = cargarDestinatariosNotifAdmin;
window.enviarNotificacionAdmin         = enviarNotificacionAdmin;
window.cargarNotificacionesAdmin       = cargarNotificacionesAdmin;
window.eliminarNotificacionGlobal      = eliminarNotificacionGlobal;

/* =============================================================================
   15. FOTO
============================================================================= */

async function capturePhoto() {
  const photoInput = document.getElementById('photoInput');
  photoInput.capture = 'environment';
  photoInput.click();
}

async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const preview = document.getElementById('photoPreview');
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      preview.dataset.photoData = e.target.result;
    };
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('Error handling photo:', error);
    alert('Error al procesar la foto: ' + error.message);
  }
}


/* =============================================================================
   16. INICIALIZACIÓN — listeners Firebase en tiempo real
============================================================================= */

function escucharMantenimientos() {
  realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).on('value', (snapshot) => {
    const val = snapshot.val();
    const arrVal = val === null ? null : Array.isArray(val) ? val : Object.values(val);
    if (arrVal !== null) {
      db.mantenimientosPeriodicos = arrVal.filter(m => m && m.accion);
      if (document.getElementById('menuScreen')) {
        actualizarListaMantenimientos();
        checkPastDueMaintenances();
        updateNotificationIcons();
      }
    } else if (INST() !== 'default' && arrVal === null) {
      db.mantenimientosPeriodicos = [];
      reconstruirMantenimientos();
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
      if (document.getElementById('menuScreen')) {
        actualizarListaMantenimientos();
        checkPastDueMaintenances();
        updateNotificationIcons();
      }
    }
  });
}

function _registrarListenersFirebase() {
  // equiposDb
  realDb.ref(`instalaciones/${INST()}/equiposDb`).on('value', (snapshot) => {
    const val = snapshot.val();
    if (val) { window.equiposDb = val; guardarEquiposDb(); }
  }, (e) => console.warn('Firebase equipos DB sync error:', e));

  // workOrders
  realDb.ref(`instalaciones/${INST()}/workOrders`).on('value', (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      db.workOrders = Array.isArray(val) ? val.filter(wo => wo !== null && wo !== undefined) : [];
    } else if (INST() !== 'default') {
      db.workOrders = [];
    }
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    checkPendingWorkOrders();
    updateNotificationIcons();
    const popup = document.querySelector('.notification-popup');
    if (popup && popup.querySelector('#popupContent')) {
      if (!db.workOrders.some(wo => wo && wo.estado === 'pendiente')) popup.remove();
      else showPendingWorkOrders();
    }
  }, (e) => console.warn('Firebase work orders sync error:', e));

  // workOrdersAverias
  realDb.ref(`instalaciones/${INST()}/workOrdersAverias`).on('value', (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      db.workOrdersAverias = Array.isArray(val) ? val.filter(wo => wo !== null && wo !== undefined) : [];
    } else if (INST() !== 'default') {
      db.workOrdersAverias = []; // instalacion existe pero sin datos propios → limpiar
    }
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    checkPendingAverias();
    updateNotificationIcons();
  }, (e) => console.warn('Firebase workOrdersAverias sync error:', e));

  // workOrdersTareas
  realDb.ref(`instalaciones/${INST()}/workOrdersTareas`).on('value', (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      db.workOrdersTareas = Array.isArray(val) ? val.filter(wo => wo !== null && wo !== undefined) : [];
    } else if (INST() !== 'default') {
      db.workOrdersTareas = []; // instalacion existe pero sin datos propios → limpiar
    }
    localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
    checkPendingTareas();
    updateNotificationIcons();
  }, (e) => console.warn('Firebase workOrdersTareas sync error:', e));

  // Listener global de instalaciones/${INST()} (detecta cambios en mantenimientos)
  if (INST() === 'default') return; // no listener sin instalación
  realDb.ref(`instalaciones/${INST()}`).on('value', (snapshot) => {
    const val = snapshot.val();
    if (!val) return;
    let needsUpdate = false;
    if (val.mantenimientosPeriodicos) {
      const newMaint = Array.isArray(val.mantenimientosPeriodicos)
        ? val.mantenimientosPeriodicos.filter(m => m && m.accion)
        : [];
      if (JSON.stringify(db.mantenimientosPeriodicos) !== JSON.stringify(newMaint)) {
        db.mantenimientosPeriodicos = [...newMaint];
        reconstruirMantenimientos();
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
      console.log('Data synchronized from Firebase');
      checkPendingWorkOrders();
      updateNotificationIcons();
      actualizarListaMantenimientos();
    }
  }, (e) => console.warn('Firebase sync error:', e));

  // stock
  realDb.ref(`instalaciones/${INST()}/stock`).on('value', (snapshot) => {
    _aplicarStockFirebase(snapshot.val());
    actualizarListaEquipos();
    actualizarDatalistEquipos();
  }, (error) => {
    if (error.code === 'PERMISSION_DENIED') {
      console.warn('Permission denied for stock updates, using local data');
    } else {
      console.error('Error syncing stock data:', error);
    }
  });

  escucharMantenimientos();
}


/* =============================================================================
   17. ARRANQUE — DOMContentLoaded
============================================================================= */

function reconstruirMantenimientos() {
  if (
    (db.preventivosEquipos && db.preventivosEquipos.length) ||
    (db.trabajosPeriodicos && db.trabajosPeriodicos.length)
  ) {
    return;
  }
  db.preventivosEquipos = [];
  db.trabajosPeriodicos = [];
  (db.mantenimientosPeriodicos || []).forEach(m => {
    if (!m) return;
    const esPreventivo = m.equipo && m.equipo.trim() !== '';
    if (esPreventivo) {
      db.preventivosEquipos.push(m);
    } else {
      db.trabajosPeriodicos.push(m);
    }
  });
  db.tareasProgramadas = db.trabajosPeriodicos;
}

/* =============================================================================
   VISUALIZACIÓN SEPARADA — función auxiliar nueva, no sustituye a la actual
============================================================================= */

function renderMantenimientosSeparados(container) {
  container.innerHTML = '';

  // Preventivos agrupados por equipo
  const agrupados = {};
  (db.preventivosEquipos || []).forEach(m => {
    const eq = m.equipo || 'Sin equipo';
    if (!agrupados[eq]) agrupados[eq] = [];
    agrupados[eq].push(m);
  });
  Object.keys(agrupados).sort().forEach(eq => {
    const h = document.createElement('h3');
    h.className = 'eq-zona-header';
    h.textContent = eq;
    container.appendChild(h);
    agrupados[eq]
      .slice()
      .sort((a, b) => calcularProximaFecha(a) - calcularProximaFecha(b))
      .forEach(m => {
        const nextDate = calcularProximaFecha(m);
        const vencido  = esMantenimientoVencido(m);
        const div = document.createElement('div');
        div.className = 'pending-record' + (vencido ? ' overdue' : '');
        div.innerHTML = `<strong>${m.accion}</strong> · c/${m.periodicidad}d · <span style="color:${vencido ? 'var(--red)' : 'var(--green)'}">${vencido ? '⚠ vencido' : nextDate.toLocaleDateString()}</span>`;
        container.appendChild(div);
      });
  });

  // Tareas operativas
  if (db.tareasProgramadas && db.tareasProgramadas.length) {
    const ht = document.createElement('h3');
    ht.className = 'eq-zona-header';
    ht.style.color = 'var(--amber)';
    ht.textContent = 'Tareas Operativas';
    container.appendChild(ht);
    (db.tareasProgramadas || [])
      .slice()
      .sort((a, b) => calcularProximaFecha(a) - calcularProximaFecha(b))
      .forEach(m => {
        const vencido = esMantenimientoVencido(m);
        const div = document.createElement('div');
        div.className = 'pending-record' + (vencido ? ' overdue' : '');
        div.innerHTML = `<strong>${m.accion || 'Tarea'}</strong> · c/${m.periodicidad}d`;
        container.appendChild(div);
      });
  }
}

async function finalizarParte(id) {
  const parte = db.workOrders.find(p => p.id === id)
             || (db.workOrdersAverias || []).find(p => p.id === id)
             || (db.workOrdersTareas  || []).find(p => p.id === id);
  if (!parte) return;
  parte.estado          = 'finalizado';
  parte.fechaFin        = new Date().toISOString();
  parte.cerradoPorUid    = _sesionAutor().uid;
  parte.cerradoPorNombre = _sesionAutor().nombre;
  parte.cerradoPorEmail  = _sesionAutor().email;
  const { ref } = _getOrderArray(id);
  const arr = ref.includes('Averias') ? db.workOrdersAverias
            : ref.includes('Tareas')  ? db.workOrdersTareas
            :                           db.workOrders;
  await realDb.ref(ref).set(arr).catch(e => console.warn('finalizarParte error:', e));
  localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
  if (parte.equipo) {
    try {
      await _guardarHistorialEquipo(parte.equipo, {
        fecha:       parte.fechaFin ? parte.fechaFin.split('T')[0] : new Date().toISOString().split('T')[0],
        descripcion: parte.descripcion || '',
        tipo:        parte.tipo || 'parte'
      });
    } catch(e) { console.warn('historial finalizarParte error:', e); }
  }
  // Exportar a GitHub al finalizar (mismo flujo que completeWorkOrder)
  try {
    await exportarWorkOrderToExcel({ ...parte });
    console.log('Parte finalizado y exportado a GitHub');
  } catch (e) {
    console.warn('finalizarParte export error:', e);
  }
}

function guardarCorrectivo() {
  const equipo      = document.getElementById('correctivoEquipo').value;
  const fecha       = document.getElementById('fechaCorrectivo').value;
  const averia      = document.getElementById('averiaCorrectivo').value;
  const causa       = document.getElementById('causaCorrectivo').value;
  const fechaFin    = document.getElementById('fechaFinCorrectivo').value;
  const descripcion = document.getElementById('descripcionCorrectivo').value;
  if (!equipo || !fecha || !descripcion) { alert('Complete al menos equipo, fecha y descripción'); return; }
  const parte = {
    id: Date.now(), equipo, fecha, fechaProgramada: fecha,
    fechaCreacion: new Date().toISOString(), fechaInicio: new Date().toISOString(),
    fechaFin: null, averia, causa, fechaFinPrevista: fechaFin,
    descripcion, estado: 'en_curso', tipo: 'averia', origen: 'correctivo', spareParts: [],
    creadoPorUid: _sesionAutor().uid, creadoPorNombre: _sesionAutor().nombre, creadoPorEmail: _sesionAutor().email
  };
  if (!db.workOrdersAverias) db.workOrdersAverias = [];
  db.workOrdersAverias.push(parte);
  realDb.ref(`instalaciones/${INST()}/workOrdersAverias`).set(db.workOrdersAverias).catch(e => console.warn(e));
  localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
  ['correctivoEquipo','fechaCorrectivo','averiaCorrectivo','causaCorrectivo','fechaFinCorrectivo','descripcionCorrectivo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';})
  updateNotificationIcons();
  alert('Correctivo guardado en curso');
}

function guardarModificativo() {
  const equipo      = document.getElementById('equipoModificativo').value;
  const fecha       = document.getElementById('fechaModificativo').value;
  const averia      = document.getElementById('averiaModificativo').value;
  const causa       = document.getElementById('causaModificativo').value;
  const fechaFin    = document.getElementById('fechaFinModificativo').value;
  const descripcion = document.getElementById('descripcionModificativo').value;
  if (!equipo || !fecha || !descripcion) { alert('Complete al menos equipo, fecha y descripción'); return; }
  const parte = {
    id: Date.now(), equipo, fecha, fechaProgramada: fecha,
    fechaCreacion: new Date().toISOString(), fechaInicio: new Date().toISOString(),
    fechaFin: null, averia, causa, fechaFinPrevista: fechaFin,
    descripcion, estado: 'en_curso', tipo: 'averia', origen: 'modificativo', spareParts: [],
    creadoPorUid: _sesionAutor().uid, creadoPorNombre: _sesionAutor().nombre, creadoPorEmail: _sesionAutor().email
  };
  if (!db.workOrdersAverias) db.workOrdersAverias = [];
  db.workOrdersAverias.push(parte);
  realDb.ref(`instalaciones/${INST()}/workOrdersAverias`).set(db.workOrdersAverias).catch(e => console.warn(e));
  localStorage.setItem(LS_KEY_APP, JSON.stringify(db));
  ['equipoModificativo','fechaModificativo','averiaModificativo','causaModificativo','fechaFinModificativo','descripcionModificativo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';})
  updateNotificationIcons();
  alert('Modificativo guardado en curso');
}

async function migrarDatosAInstalacion() {
  const inst = localStorage.getItem('instalacionActiva');
  if (!inst || inst === 'default') {
    alert('Selecciona una instalación antes de migrar');
    return;
  }
  if (!confirm(`Esto copiará TODOS los datos de edarData a la instalación "${inst}".\nLos datos existentes en esa instalación serán reemplazados.\n¿Continuar?`)) return;

  try {
    const snap = await realDb.ref('edarData').once('value');
    const data = snap.val();
    if (!data) { alert('No hay datos en edarData para migrar'); return; }

    const claves = ['workOrders','workOrdersAverias','workOrdersTareas',
                    'mantenimientosPeriodicos','stock','equiposDb','historialEquipos',
                    'preventivosEquipos','trabajosPeriodicos'];

    for (const clave of claves) {
      if (data[clave] !== undefined) {
        await realDb.ref(`instalaciones/${inst}/${clave}`).set(data[clave]);
      }
    }

    alert(`Migración completada a instalación "${inst}".\nRecarga la app para ver los datos.`);
    window.location.reload();
  } catch(e) {
    alert('Error en la migración: ' + e.message);
    console.error(e);
  }
}

window.migrarDatosAInstalacion = migrarDatosAInstalacion;

/* =============================================================================
   EXPORTACIÓN CENTRALIZADA
============================================================================= */

function exportarCSV(datos, nombreArchivo, columnas) {
  if (!datos || !datos.length) { alert('No hay datos para exportar'); return; }
  const escape = v => '"' + (v ?? '').toString().replace(/"/g, '""') + '"';
  const csv = [columnas.join(','), ...datos.map(item => columnas.map(c => escape(item[c])).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  link.download = nombreArchivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportarAveriasCSV() {
  exportarCSV(
    db.workOrdersAverias || [],
    'averias.csv',
    ['fecha', 'equipo', 'descripcion', 'operario', 'estado', 'fechaEjecucion']
  );
}

function exportarTareasOperativasCSV() {
  exportarCSV(
    db.workOrdersTareas || [],
    'tareas_operativas.csv',
    ['fecha', 'equipo', 'descripcion', 'operario', 'estado', 'material']
  );
}

function exportarMantenimientosCSV() {
  exportarCSV(
    db.mantenimientosPeriodicos || [],
    'mantenimientos.csv',
    ['equipo', 'accion', 'periodicidad', 'fechaUltimaEjecucion', 'tipo', 'operario']
  );
}

async function importarMantenimientosCSV(file) {
  try {
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (!lines.length) { alert('Archivo vacío'); return; }
    const limpiar = s => s.trim().replace(/^"+|"+$/g, '').trim();
    const headers = lines[0].split(',').map(h => limpiar(h).toLowerCase());
    const reqs = ['equipo','accion','periodicidad','tipo'];
    if (!reqs.every(r => headers.includes(r))) {
      alert('CSV inválido. Columnas requeridas: ' + reqs.join(', ')); return;
    }
    const nuevos = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => limpiar(c));
      const row  = {};
      headers.forEach((h, idx) => row[h] = cols[idx] || '');
      if (!row.equipo || !row.accion || !row.periodicidad) continue;
      nuevos.push({
        id:                   'MANT-' + Date.now() + '-' + i,
        equipo:               row.equipo,
        accion:               row.accion,
        periodicidad:         parseInt(row.periodicidad, 10) || 30,
        tipo:                 row.tipo || 'preventivo',
        operario:             row.operario || '',
        fechaUltimaEjecucion: row.fechaultimaejecucion || '',
        fecha:                row.fecha || new Date().toISOString().split('T')[0]
      });
    }
    if (!nuevos.length) { alert('No se encontraron filas válidas'); return; }
    db.mantenimientosPeriodicos = [...(db.mantenimientosPeriodicos || []), ...nuevos];
    let instDestino = INST();
    if (!instDestino || instDestino === 'default') {
      instDestino = prompt('¿A qué instalación importar? Escribe el ID exacto (ej: edar-torre-pacheco):');
      if (!instDestino) return;
    }
    await realDb.ref(`instalaciones/${instDestino}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
    // Recargar desde Firebase para sincronizar memoria y listeners
    const snap = await realDb.ref(`instalaciones/${instDestino}/mantenimientosPeriodicos`).once('value');
    const val = snap.val();
    if (val && Array.isArray(val)) {
      db.mantenimientosPeriodicos = val.filter(m => m && m.accion);
    }
    actualizarListaMantenimientos();
    checkPastDueMaintenances();
    updateNotificationIcons();
    alert(`✓ ${nuevos.length} mantenimientos importados a "${instDestino}" correctamente`);
  } catch(e) {
    console.error('importarMantenimientosCSV error:', e);
    alert('Error al importar: ' + e.message);
  }
}
window.importarMantenimientosCSV = importarMantenimientosCSV;

/* =============================================================================
   EXPOSICIÓN GLOBAL — todas las funciones llamadas desde onclick/onchange
   inline en el HTML (estático y dinámico) deben estar en window para que
   el navegador las encuentre cuando el usuario interactúa con la UI.
   Esto también protege contra cualquier problema de scope si el entorno
   ejecuta el script en modo módulo o con alguna sandboxing no estándar.
============================================================================= */

// Llamadas desde HTML estático (atributos onclick en index.html)
window.showPendingMaintenances       = showPendingMaintenances;
window.showPendingWorkOrders         = showPendingWorkOrders;
window.showStockAlerts               = showStockAlerts;
window.closePopup                    = closePopup;
window.showPhotoModal                = showPhotoModal;
window.capturePhoto                  = capturePhoto;
window.handlePhotoUpload             = handlePhotoUpload;
window.toggleListaMantenimientos     = toggleListaMantenimientos;
window.agregarMantenimientoPeriodico = agregarMantenimientoPeriodico;
window.exportarBackup                = exportarBackup;
window.exportarAveriasCSV            = exportarAveriasCSV;
window.exportarTareasOperativasCSV   = exportarTareasOperativasCSV;
window.exportarMantenimientosCSV     = exportarMantenimientosCSV;
window.exportarCSV                   = exportarCSV;
window.importarBackup                = importarBackup;
window.createWorkOrder               = createWorkOrder;
window.finalizarParte                = finalizarParte;
window.importarBibliotecaEquipos     = importarBibliotecaEquipos;
window.exportarBibliotecaEquipos     = exportarBibliotecaEquipos;
window.importarCSVEquipos            = importarCSVEquipos;
window.parseCSV                      = parseCSV;
window.autoBackupEquipos             = autoBackupEquipos;
window.restaurarBackupEquiposLocal   = restaurarBackupEquiposLocal;
window.guardarEquipo                 = guardarEquipo;
window.exportarIncidenciaGitHub      = exportarIncidenciaGitHub;
window.exportarIncidenciaLocal       = exportarIncidenciaLocal;
window.exportarRutinaGitHub          = exportarRutinaGitHub;
window.exportarPreventivoGitHub      = exportarPreventivoGitHub;
window.guardarCorrectivo             = guardarCorrectivo;
window.guardarModificativo           = guardarModificativo;
window.exportarCorrectivoGitHub      = exportarCorrectivoGitHub;
window.exportarModificativoGitHub    = exportarModificativoGitHub;

// Llamadas desde HTML dinámico (innerHTML generado en app.js)
window.editWorkOrder                 = editWorkOrder;
window.completeWorkOrder             = completeWorkOrder;
window.cancelWorkOrderEdit           = cancelWorkOrderEdit;
window.saveWorkOrderChanges          = saveWorkOrderChanges;
window.updateWorkOrderOperator       = updateWorkOrderOperator;
window.addSparePart                  = addSparePart;
window.editarMantenimiento           = editarMantenimiento;
window.eliminarMantenimiento         = eliminarMantenimiento;
window.guardarEdicionMantenimiento   = guardarEdicionMantenimiento;
window.updateMaintenanceOperator     = updateMaintenanceOperator;
window.completeMaintenance           = completeMaintenance;
window.editarEquipo                  = editarEquipo;
window.eliminarEquipo                = eliminarEquipo;
window.agregarNuevoRecambio          = agregarNuevoRecambio;
window.guardarEdicionEquipo          = guardarEdicionEquipo;

window.addEventListener('error', function(e) {
  if (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK') {
    console.warn('Failed to load resource:', e.target.src || e.target.href);
  }
}, true);

async function _decidirPantallaInicial() {
  try {
    const user = auth.currentUser;

    // Sin sesión Firebase real → loginScreen
    if (!user || user.isAnonymous) {
      if (user && user.isAnonymous) await auth.signOut().catch(() => {});
      showScreen('mainScreen');
      return;
    }

    // Verificar que el usuario sigue activo en Firebase
    let rol = localStorage.getItem('usuarioRol');
    try {
      const snap = await realDb.ref('usuarios/' + user.uid).once('value');
      const perfil = snap.val();
      if (!perfil || perfil.estado !== 'activo') {
        await auth.signOut();
        localStorage.removeItem('usuarioUid');
        localStorage.removeItem('usuarioRol');
        showScreen('mainScreen');
        return;
      }
      // Refrescar datos de perfil en localStorage
      localStorage.setItem('usuarioUid', user.uid);
      localStorage.setItem('usuarioRol', perfil.rol || 'operario');
      localStorage.setItem('usuarioNombre', perfil.nombre || user.email);
      localStorage.setItem('usuarioEmail', user.email);
      rol = perfil.rol || 'operario';
    } catch(e) {
      console.warn('[Auth] Sin red, usando localStorage:', e);
      if (!localStorage.getItem('usuarioUid')) {
        showScreen('mainScreen');
        return;
      }
    }

    // ¿Hay instalación activa con sesión válida?
    const instActiva = localStorage.getItem('instalacionActiva');
    if (instActiva && instActiva !== 'default' && _sesionActiva(instActiva)) {
      // INST() se evalúa al cargar — si no coincide con instalacionActiva, recargar
      if (INST() !== instActiva) {
        window.location.reload();
        return;
      }
      _registrarListenersFirebase();
      showScreen('menuScreen');
      return;
    }

    // Sin instalación activa → selector con nombre usuario visible
    const nombreEl = document.getElementById('loginUsuarioNombre');
    const nombre = localStorage.getItem('usuarioNombre') || '';
    if (nombreEl && nombre) nombreEl.textContent = '✓ ' + nombre;
    const panelBot = document.getElementById('panelBotonesAcceso');
    const panelInst = document.getElementById('panelInstalaciones');
    if (panelBot) panelBot.style.display = 'none';
    if (panelInst) panelInst.style.display = 'flex';
    await cargarInstalaciones();
    showScreen('mainScreen');

  } catch(e) {
    console.error('[_decidirPantallaInicial] Error inesperado:', e);
    showScreen('mainScreen');
  }
}
window._decidirPantallaInicial = _decidirPantallaInicial;

document.addEventListener('DOMContentLoaded', async function() {

  try {
    await new Promise((resolve) => auth.onAuthStateChanged(() => resolve()));

    // --- Decisión de pantalla inicial ---
    await _decidirPantallaInicial();

    document.getElementById('enterBtn').addEventListener('click', async () => {
      const instActiva = localStorage.getItem('instalacionActiva');
    if (instActiva && instActiva !== 'default' && _sesionActiva(instActiva)) {
      // INST() se evalúa al cargar — si no coincide con instalacionActiva, recargar
      if (INST() !== instActiva) {
        window.location.reload();
        return;
      }
      _registrarListenersFirebase();
      showScreen('menuScreen');
      return;
    }
      if (!_sesionActiva(inst)) { alert('Selecciona una instalación e introduce la contraseña'); return; }
      _registrarListenersFirebase();
      showScreen('menuScreen');
    });
    const _exitBtn = document.getElementById('exitBtn');
    if (_exitBtn) _exitBtn.addEventListener('click', () => window.close());
    const _adminBtnEl = document.getElementById('adminBtn');
    if (_adminBtnEl) _adminBtnEl.addEventListener('click', () => authenticateAdmin());
    const menuAdminBtn = document.getElementById('menuAdminBtn');
    if (menuAdminBtn) menuAdminBtn.addEventListener('click', () => authenticateAdmin());
    const menuExitBtnEl = document.getElementById('menuExitBtn');
    if (menuExitBtnEl) menuExitBtnEl.addEventListener('click', () => volverAInstalaciones());

    // --- Menú de módulos ---
    document.getElementById('incidenciasBtn').addEventListener('click',  () => showScreen('incidenciasScreen'));
    document.getElementById('rutinariasBtn').addEventListener('click',   () => showScreen('rutinariasScreen'));
    document.getElementById('preventivoBtn').addEventListener('click',   () => showScreen('preventivoScreen'));
    document.getElementById('correctivoBtn').addEventListener('click',   () => showScreen('correctivoScreen'));
    document.getElementById('modificativoBtn').addEventListener('click', () => showScreen('modificativoScreen'));

    // --- Módulos protegidos por PIN ---
    document.getElementById('workOrderBtn').addEventListener('click', () => _autenticarYMostrar('workOrderScreen'));
    document.getElementById('equiposBtn').addEventListener('click',   () => _autenticarYMostrar('equiposScreen'));

    // --- Importar JSON de equipos ---
    document.getElementById('equiposJsonFileInput').addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        try {
          await importarBibliotecaEquipos();
        } catch (err) {
          console.error('Error handling file:', err);
          alert('Error al procesar el archivo: ' + err.message);
        }
      }
    });

    // --- Icono de mantenimientos ---
    // iconos de mantenimiento conectados via onclick en HTML

    // --- Carga de datos ---
    await loadFromLocalStorage();

    // Mostrar nombre instalación activa en el título
    const _instActiva = localStorage.getItem('instalacionActiva');
    if (_instActiva) {
      try {
        const _metaSnap = await realDb.ref(`instalaciones/${_instActiva}/meta`).once('value');
        if (_metaSnap.val()) _actualizarTituloInstalacion(_metaSnap.val().nombre);
      } catch(_) {}
    }

    // --- Estado inicial de la UI ---
    checkPendingWorkOrders();
    updateAdminLists();

    const listaMantenimientos = document.getElementById('listaMantenimientosPeriodicos');
    if (listaMantenimientos) listaMantenimientos.style.display = 'none';

    updateSelectors();

    const savedEquiposDb = localStorage.getItem(LS_KEY_EQUIPOS);
    if (savedEquiposDb) {
      window.equiposDb = JSON.parse(savedEquiposDb);
      actualizarListaEquipos();
    }

    updateStockIcon();
    actualizarDatalistEquipos();
    if (!localStorage.getItem('backup_equipos_auto')) autoBackupEquipos();
    updateNotificationIcons();
    checkPendingAverias();
    checkPendingTareas();

    // --- Intervalos periódicos ---
    verificarMantenimientosPeriodicos();
    setInterval(verificarMantenimientosPeriodicos, 60000);
    setInterval(checkPastDueMaintenances,          60000);
    setInterval(actualizarBadgeNotificaciones,     60000);
    setInterval(updateStockIcon,                   30000);

    // --- Error en el logo de fondo ---
    document.querySelector('.background-logo').addEventListener('error', (e) => {
      console.error('Error loading background logo:', e);
      e.target.style.backgroundImage = 'none';
    });

  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

function renderAuditoriaActivos() {
  const el = document.getElementById('auditoriaActivosResult');
  if (!el) return;

  const equipos   = (window.equiposDb?.equiposGuardados || []).filter(Boolean);
  const mants     = (db.mantenimientosPeriodicos || []).filter(Boolean);
  const averias   = (db.workOrdersAverias || []).filter(Boolean);
  const ahora     = new Date();
  const hace1y    = new Date(ahora.getTime() - 365 * 24 * 60 * 60 * 1000);

  const correctivosMap = {};
  averias.forEach(w => {
    if (!w.equipo || !w.fecha || new Date(w.fecha) < hace1y) return;
    correctivosMap[w.equipo] = (correctivosMap[w.equipo] || 0) + 1;
  });
  const topCorrectivos = Object.entries(correctivosMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10);

  const vencidosMap = {};
  mants.forEach(m => {
    if (!esMantenimientoVencido(m)) return;
    vencidosMap[m.equipo] = (vencidosMap[m.equipo] || 0) + 1;
  });
  const topVencidos = Object.entries(vencidosMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10);

  const conMant = new Set(mants.map(m => (m.equipo || '').trim().toLowerCase()));
  const sinMant = equipos.filter(e => !conMant.has((e.equipo || '').trim().toLowerCase()));

  const dupMap = {};
  mants.forEach((m, i) => {
    const esDup = mants.findIndex(n => n.equipo === m.equipo && n.accion === m.accion && n.periodicidad === m.periodicidad) !== i;
    if (esDup) dupMap[m.equipo] = (dupMap[m.equipo] || new Set()).add(m.accion);
  });

  const incompletos = equipos.filter(e => !e.modelo || !e.familia || !e.zona);

  const salud = equipos.map(e => {
    const nombre = (e.equipo || '').trim();
    const c = correctivosMap[nombre] || 0;
    const v = vencidosMap[nombre] || 0;
    const d = dupMap[nombre] ? dupMap[nombre].size : 0;
    const s = (v >= 3 || d > 1 || c > 5) ? '🔴' : (v >= 1 || d >= 1 || c >= 3) ? '🟡' : '🟢';
    return { nombre, s, c, v, d };
  }).sort((a, b) => ({ '🔴': 0, '🟡': 1, '🟢': 2 }[a.s] - { '🔴': 0, '🟡': 1, '🟢': 2 }[b.s]));

  const row = (label, val) => `<p class="txt-secondary-sm">${label}: <strong>${val}</strong></p>`;
  const sec = (title, html) => `<div class="panel-sec">
    <p style="font-weight:700;margin:0 0 8px">${title}</p>${html}</div>`;

  el.innerHTML = [
    sec('🔧 Equipos con más correctivos (12 meses)',
      topCorrectivos.length
        ? topCorrectivos.map(([eq, n]) => row(eq, n)).join('')
        : '<p class="txt-muted-sm">Sin datos</p>'),

    sec('⏰ Equipos con más mantenimientos vencidos',
      topVencidos.length
        ? topVencidos.map(([eq, n]) => row(eq, n)).join('')
        : '<p class="txt-muted-sm">Ninguno vencido ✅</p>'),

    sec('📭 Equipos sin mantenimiento programado',
      sinMant.length
        ? sinMant.map(e => `<p class="txt-secondary-sm">${e.equipo || '(sin nombre)'}</p>`).join('')
        : '<p class="txt-muted-sm">Todos tienen mantenimiento ✅</p>'),

    sec('⚠️ Posibles duplicados',
      Object.keys(dupMap).length
        ? Object.entries(dupMap).map(([eq, acc]) =>
            `<p class="txt-secondary-sm"><strong>${eq}</strong>: ${[...acc].join(', ')}</p>`).join('')
        : '<p class="txt-muted-sm">Sin duplicados detectados ✅</p>'),

    sec('📋 Equipos con datos incompletos',
      incompletos.length
        ? incompletos.map(e => {
            const f = [];
            if (!e.modelo) f.push('modelo'); if (!e.familia) f.push('familia'); if (!e.zona) f.push('zona');
            return `<p class="txt-secondary-sm"><strong>${e.equipo || '?'}</strong>: sin ${f.join(', ')}</p>`;
          }).join('')
        : '<p class="txt-muted-sm">Todos completos ✅</p>'),

    sec('🏥 Índice de salud',
      `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">Equipo · Estado · Correctivos · Vencidos · Duplicados</div>` +
      salud.map(e =>
        `<p class="txt-secondary-sm">${e.s} <strong>${e.nombre}</strong> · C:${e.c} V:${e.v} D:${e.d}</p>`
      ).join(''))
  ].join('');
}
window.renderAuditoriaActivos = renderAuditoriaActivos;

function renderCentroOperativo() {
  const el = document.getElementById('centroOperativoResult');
  if (!el) return;

  const uid     = localStorage.getItem('usuarioUid')    || '';
  const nombre  = localStorage.getItem('usuarioNombre') || 'Usuario';
  const rol     = localStorage.getItem('usuarioRol')    || 'operario';
  const mants   = (db.mantenimientosPeriodicos || []).filter(Boolean);
  const averias = (db.workOrdersAverias  || []).filter(Boolean);
  const tareas  = (db.workOrdersTareas   || []).filter(Boolean);
  const todos   = [...averias, ...tareas];
  const ahora   = new Date(); ahora.setHours(0,0,0,0);
  const fin7    = new Date(ahora.getTime() + 7 * 86400000);

  // ── Cálculos planificación (reutiliza calcularProximaFecha) ──
  const items = mants.map(m => {
    const prox = calcularProximaFecha(m); prox.setHours(0,0,0,0);
    return { ...m, prox, diffDias: Math.round((prox - ahora) / 86400000) };
  });
  const nVencidos = items.filter(i => i.diffDias < 0).length;
  const nHoy      = items.filter(i => i.diffDias === 0).length;
  const nSemana   = items.filter(i => i.diffDias > 0 && i.prox <= fin7).length;

  // ── Actividad del usuario autenticado ──
  const misCreadosRaw  = todos.filter(w => w.creadoPorUid === uid);
  const misCompletados = todos.filter(w => w.cerradoPorUid === uid);

  // Últimas 5 acciones (creación o cierre) ordenadas por fecha desc
  const acciones = [
    ...misCreadosRaw.map(w => ({ fecha: w.fechaCreacion || w.fecha, tipo: 'Creó', equipo: w.equipo, desc: w.descripcion || w.averia || '' })),
    ...misCompletados.map(w => ({ fecha: w.fechaFin || w.fechaEjecucion || '', tipo: 'Completó', equipo: w.equipo, desc: w.descripcion || w.averia || '' }))
  ].filter(a => a.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);

  const fmt = f => f ? new Date(f).toLocaleDateString('es-ES') : '—';
  const sec = (title, html) =>
    `<div style="margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:6px">
      <p style="font-weight:700;margin:0 0 8px">${title}</p>${html}</div>`;
  const badge = (label, n, color) =>
    `<div style="flex:1;min-width:80px;padding:8px;border-radius:6px;border:1px solid ${color};text-align:center;background:color-mix(in srgb,${color} 10%,transparent)">
      <div style="font-size:1.3rem;font-weight:700;color:${color}">${n}</div>
      <div style="font-size:0.75rem;color:var(--text)">${label}</div></div>`;

  // ── Accesos rápidos (preparado para futuras asignaciones) ──
  const acceso = (icon, label, screen, fn) =>
    `<button class="button" style="flex:1;min-width:100px" onclick="showScreen('${screen}')${fn ? `;${fn}()` : ''}">${icon} ${label}</button>`;

  el.innerHTML = [
    // Resumen rápido
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${badge('Vencidos', nVencidos, 'var(--red)')}
      ${badge('Hoy',      nHoy,      '#f0a500')}
      ${badge('7 días',   nSemana,   'var(--green)')}
    </div>`,

    // Estado instalación
    sec('🏭 Estado de la instalación',
      items.filter(i => i.diffDias < 0).slice(0, 5).map(i =>
        `<p style="font-size:0.83rem;margin:3px 0;color:var(--red)"><strong>${i.equipo}</strong> — ${i.accion} (${Math.abs(i.diffDias)}d retraso)</p>`
      ).join('') +
      (nVencidos === 0 ? '<p class="txt-secondary-sm">Sin vencidos ✅</p>' : '') +
      (nVencidos > 5 ? `<p style="font-size:0.78rem;color:var(--text-muted)">...y ${nVencidos - 5} más. Ver Planificación.</p>` : '')
    ),

    // Actividad del usuario
    sec(`👤 Mi actividad — ${nombre}`,
      `<p style="font-size:0.8rem;color:var(--text);margin:0 0 6px">
        Creados: <strong>${misCreadosRaw.length}</strong> &nbsp;·&nbsp; Completados: <strong>${misCompletados.length}</strong>
      </p>` +
      (acciones.length
        ? acciones.map(a =>
            `<p style="font-size:0.82rem;margin:3px 0"><span class="opacity-muted">${fmt(a.fecha)}</span> · <strong>${a.tipo}</strong> ${a.equipo || ''} — ${a.desc.slice(0,50)}${a.desc.length>50?'…':''}</p>`
          ).join('')
        : '<p class="txt-secondary-sm">Sin actividad registrada todavía</p>')
    ),

    // Accesos rápidos
    sec('⚡ Accesos rápidos',
      `<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${acceso('📅','Planificación','planificacionScreen','renderPlanificacion')}
        ${rol === 'admin' ? acceso('🔥','Auditoría','adminScreen','renderAuditoriaActivos') : ''}
      </div>`)
  ].join('');

  // ── Vista admin: todas las tareas vencidas y su asignación ──
  if (rol === 'admin') {
    const mantsVencidos  = items.filter(i => i.diffDias < 0);
    const tareasVencidas = todos.filter(t => t && (!t.estado || t.estado === 'pendiente' || t.estado === 'en_curso') && t.fechaProgramada && new Date(t.fechaProgramada) < ahora);
    const todasVenc = [
      ...mantsVencidos.map(m => ({ ...m, _tipo: 'periodico' })),
      ...tareasVencidas.map(t => ({ ...t, _tipo: 'tarea' }))
    ];
    const cuerpoVenc = !todasVenc.length
      ? '<p class="txt-secondary-sm">No hay tareas vencidas ✅</p>'
      : todasVenc.map(t => {
          const etiqueta = [t.equipo, t.accion || t.descripcion].filter(Boolean).join(' — ');
          const asignado = _getAsignadosNombres(t).join(', ') || t.asignadoAExterno || '<span class="opacity-muted">Sin asignar</span>';
          return '<div style="margin-bottom:8px;padding:6px 8px;border-radius:5px;border:1px solid var(--red)">'
            + '<p style="font-size:0.83rem;font-weight:600;margin:0 0 3px">⚠ ' + etiqueta + '</p>'
            + '<p style="font-size:0.78rem;margin:0">Asignado a: ' + asignado + '</p>'
            + '</div>';
        }).join('');
    el.innerHTML += sec('🔥 Tareas vencidas (todas, vista admin)', cuerpoVenc);
  }

  const misMants  = mants.filter(m => _getAsignadosUids(m).includes(uid));
  const misTareas = todos.filter(t => _getAsignadosUids(t).includes(uid) && (!t.estado || t.estado === 'pendiente' || t.estado === 'en_curso'));
  const todasAsig = [
    ...misMants.map(m => ({ ...m, _tipo: 'periodico' })),
    ...misTareas.map(t => ({ ...t, _tipo: 'tarea' }))
  ];
  const cuerpoAsig = !todasAsig.length
    ? '<p class="txt-secondary-sm">No tienes tareas asignadas pendientes ✅</p>'
    : todasAsig.map(t => {
        const etiqueta = [t.equipo, t.accion || t.descripcion].filter(Boolean).join(' — ');
        const venc = t._tipo === 'periodico' ? esMantenimientoVencido(t) : !!(t.fechaProgramada && new Date(t.fechaProgramada) < ahora);
        const otrosNombres = _getAsignadosNombres(t).filter(n => n !== nombre);
        const partesJunto = t.asignadoAExterno ? [...otrosNombres, t.asignadoAExterno] : otrosNombres;
        const htmlJunto = partesJunto.length ? '<p style="font-size:0.78rem;opacity:0.7;margin:0 0 4px">Junto a: ' + partesJunto.join(', ') + '</p>' : '';
        return '<div style="margin-bottom:10px;padding:8px;border-radius:5px;border:1px solid ' + (venc ? 'var(--red)' : 'var(--border)') + '">'
          + '<p style="font-size:0.85rem;font-weight:600;margin:0 0 4px">' + (venc ? '⚠ ' : '') + etiqueta + '</p>'
          + htmlJunto
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
          + '<input type="date" id="conf-fecha-' + t.id + '" style="font-size:0.8rem;flex:1" value="' + new Date().toISOString().split('T')[0] + '">'
          + '<input type="text" id="conf-obs-' + t.id + '" style="font-size:0.8rem;flex:2" placeholder="Observaciones...">'
          + '<button class="button button--sm" onclick="confirmarTareaRealizada(\'' + t.id + '\',\'' + t._tipo + '\')">✅ Confirmar</button>'
          + '</div></div>';
      }).join('');
  el.innerHTML += sec('📋 Mis tareas asignadas', cuerpoAsig);

  // ── Aviso temprano: próximas a vencer (5 días) ──
  const fin5 = new Date(ahora.getTime() + 5 * 86400000);
  const baseM = rol === 'admin' ? mants : misMants;
  const baseT = rol === 'admin' ? todos.filter(t => !t.estado || t.estado === 'pendiente' || t.estado === 'en_curso') : misTareas;
  const proximasMants = baseM.filter(m => {
    const prox = calcularProximaFecha(m); prox.setHours(0,0,0,0);
    return prox > ahora && prox <= fin5;
  });
  const proximasTareas = baseT.filter(t => {
    if (!t.fechaProgramada) return false;
    const f = new Date(t.fechaProgramada); f.setHours(0,0,0,0);
    return f > ahora && f <= fin5;
  });
  const proximas = [
    ...proximasMants.map(m => ({ ...m, _tipo: 'periodico' })),
    ...proximasTareas.map(t => ({ ...t, _tipo: 'tarea' }))
  ];
  if (proximas.length) {
    const cuerpoProx = proximas.map(t => {
      const etiqueta = [t.equipo, t.accion || t.descripcion].filter(Boolean).join(' — ');
      const fechaRef = t._tipo === 'periodico' ? calcularProximaFecha(t) : new Date(t.fechaProgramada);
      const asignado = rol === 'admin' ? (_getAsignadosNombres(t).join(', ') || t.asignadoAExterno || 'Sin asignar') : '';
      return '<div style="margin-bottom:8px;padding:6px 8px;border-radius:5px;border:1px solid orange;background:color-mix(in srgb,orange 8%,transparent)">'
        + '<p style="font-size:0.83rem;font-weight:600;margin:0 0 3px">🔔 ' + etiqueta + '</p>'
        + '<p style="font-size:0.78rem;margin:0">Vence: ' + fechaRef.toLocaleDateString('es-ES') + (asignado ? ' · Asignado a: ' + asignado : '') + '</p>'
        + '</div>';
    }).join('');
    el.innerHTML += sec(rol === 'admin' ? '🔔 Próximas a vencer — todas (5 días)' : '🔔 Próximas a vencer (5 días)', cuerpoProx);
  }
}
window.renderCentroOperativo = renderCentroOperativo;

async function confirmarTareaRealizada(id, tipo) {
  const fecha = document.getElementById(`conf-fecha-${id}`)?.value;
  const obs   = document.getElementById(`conf-obs-${id}`)?.value || '';
  if (!fecha) { alert('Indica la fecha de ejecución.'); return; }
  const _item = tipo === 'periodico'
    ? db.mantenimientosPeriodicos.find(m => String(m.id) === String(id))
    : db.workOrdersTareas.find(t => String(t.id) === String(id));
  const _nombreItem = _item ? (_item.equipo || _item.accion || _item.descripcion || 'esta tarea') : 'esta tarea';
  if (!confirm(`¿Confirmar como realizado: "${_nombreItem}"?`)) return;
  const autor = {
    uid:    localStorage.getItem('usuarioUid')    || '',
    nombre: localStorage.getItem('usuarioNombre') || '',
    email:  localStorage.getItem('usuarioEmail')  || ''
  };
  try {
    if (tipo === 'periodico') {
      const idx = db.mantenimientosPeriodicos.findIndex(m => String(m.id) === String(id));
      if (idx === -1) { alert('Tarea no encontrada.'); return; }
      db.mantenimientosPeriodicos[idx].fechaUltimaEjecucion = fecha;
      db.mantenimientosPeriodicos[idx].ultimaObservacion    = obs;
      db.mantenimientosPeriodicos[idx].confirmadoPorUid     = autor.uid;
      db.mantenimientosPeriodicos[idx].confirmadoPorNombre  = autor.nombre;
      db.mantenimientosPeriodicos[idx].fechaConfirmacion    = new Date().toISOString();
      if (!db.mantenimientosPeriodicos[idx].historial) db.mantenimientosPeriodicos[idx].historial = [];
      db.mantenimientosPeriodicos[idx].historial.push({ fecha, obs, uid: autor.uid, nombre: autor.nombre });
      await realDb.ref(`instalaciones/${INST()}/mantenimientosPeriodicos`).set(db.mantenimientosPeriodicos);
      _archivarHistorialTrabajo({
        origen:      db.mantenimientosPeriodicos[idx].tipo === 'preventivo' ? 'preventivo' : 'tareaOperativa',
        equipo:      db.mantenimientosPeriodicos[idx].equipo,
        descripcion: db.mantenimientosPeriodicos[idx].accion || obs,
        fecha,
        uid:         autor.uid,
        nombre:      autor.nombre
      });
    } else {
      const idx = db.workOrdersTareas.findIndex(t => String(t.id) === String(id));
      if (idx === -1) { alert('Tarea no encontrada.'); return; }
      db.workOrdersTareas[idx].estado              = 'completado';
      db.workOrdersTareas[idx].fechaEjecucion      = fecha;
      db.workOrdersTareas[idx].observaciones       = obs;
      db.workOrdersTareas[idx].confirmadoPorUid    = autor.uid;
      db.workOrdersTareas[idx].confirmadoPorNombre = autor.nombre;
      db.workOrdersTareas[idx].fechaConfirmacion   = new Date().toISOString();
      await realDb.ref(`instalaciones/${INST()}/workOrdersTareas`).set(db.workOrdersTareas);
      _archivarHistorialTrabajo({
        origen:      'parteTrabajo',
        equipo:      db.workOrdersTareas[idx].equipo,
        descripcion: db.workOrdersTareas[idx].descripcion,
        fecha,
        uid:         autor.uid,
        nombre:      autor.nombre
      });
    }
    await saveToLocalStorage();
    alert('✅ Tarea confirmada correctamente.');
    renderCentroOperativo();
  } catch(e) { alert('Error al confirmar: ' + e.message); }
}
window.confirmarTareaRealizada = confirmarTareaRealizada;

function exportarAuditoriaXLSX() {
  const equipos  = (window.equiposDb?.equiposGuardados || []).filter(Boolean);
  const mants    = (db.mantenimientosPeriodicos || []).filter(Boolean);
  const averias  = (db.workOrdersAverias || []).filter(Boolean);
  const hace1y   = new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);

  const correctivosMap = {};
  averias.forEach(w => {
    if (!w.equipo || !w.fecha || new Date(w.fecha) < hace1y) return;
    correctivosMap[w.equipo] = (correctivosMap[w.equipo] || 0) + 1;
  });

  const vencidosMap = {};
  mants.forEach(m => {
    if (!esMantenimientoVencido(m)) return;
    vencidosMap[m.equipo] = (vencidosMap[m.equipo] || 0) + 1;
  });

  const dupMap = {};
  mants.forEach((m, i) => {
    const esDup = mants.findIndex(n => n.equipo === m.equipo && n.accion === m.accion && n.periodicidad === m.periodicidad) !== i;
    if (esDup) dupMap[m.equipo] = (dupMap[m.equipo] || new Set()).add(m.accion);
  });

  const estadoTexto = { '🔴': 'Rojo', '🟡': 'Amarillo', '🟢': 'Verde' };

  const filas = equipos.map(e => {
    const nombre = (e.equipo || '').trim();
    const c = correctivosMap[nombre] || 0;
    const v = vencidosMap[nombre] || 0;
    const d = dupMap[nombre] ? dupMap[nombre].size : 0;
    const s = (v >= 3 || d > 1 || c > 5) ? '🔴' : (v >= 1 || d >= 1 || c >= 3) ? '🟡' : '🟢';
    return {
      Equipo:               nombre,
      Estado:               estadoTexto[s] || '',
      Familia:              e.familia  || '',
      Zona:                 e.zona     || '',
      Modelo:               e.modelo   || '',
      'Correctivos 12m':    c,
      'Vencidos':           v,
      'Duplicados':         d
    };
  }).sort((a, b) => {
    const o = { 'Rojo': 0, 'Amarillo': 1, 'Verde': 2 };
    return (o[a.Estado] ?? 3) - (o[b.Estado] ?? 3);
  });

  if (!filas.length) { alert('No hay datos para exportar. Ejecuta la auditoría primero.'); return; }

  const blob = crearExcelBlob(filas, 'Auditoría Activos');
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `auditoria_activos_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.exportarAuditoriaXLSX = exportarAuditoriaXLSX;

function renderPlanificacion() {
  const resEl = document.getElementById('planificacionResumen');
  const el    = document.getElementById('planificacionResult');
  if (!el || !resEl) return;

  const mants  = _filtrarPorRol((db.mantenimientosPeriodicos || []).filter(Boolean));
  const ahora  = new Date(); ahora.setHours(0,0,0,0);
  const fin7   = new Date(ahora.getTime() + 7  * 86400000);
  const fin30  = new Date(ahora.getTime() + 30 * 86400000);

  const fmt = d => d.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });

  // Enriquecer con próxima fecha calculada
  const items = mants.map(m => {
    const prox = calcularProximaFecha(m);
    prox.setHours(0,0,0,0);
    const diffMs   = prox.getTime() - ahora.getTime();
    const diffDias = Math.round(diffMs / 86400000);
    // zona desde equiposDb si está disponible
    const eq = (window.equiposDb?.equiposGuardados || []).find(e => e && (e.equipo||'').trim().toLowerCase() === (m.equipo||'').trim().toLowerCase());
    return { ...m, prox, diffDias, zona: eq?.zona || '' };
  });

  const vencidos  = items.filter(i => i.diffDias < 0).sort((a,b) => a.diffDias - b.diffDias);
  const hoy       = items.filter(i => i.diffDias === 0);
  const prox7     = items.filter(i => i.diffDias > 0 && i.prox <= fin7).sort((a,b) => a.prox - b.prox);
  const prox30    = items.filter(i => i.diffDias > 0 && i.prox <= fin30).sort((a,b) => a.prox - b.prox);

  // Semáforo antigüedad vencidos
  const vAmbar  = vencidos.filter(i => Math.abs(i.diffDias) <= 7);
  const vNaranja= vencidos.filter(i => Math.abs(i.diffDias) > 7 && Math.abs(i.diffDias) <= 30);
  const vRojo   = vencidos.filter(i => Math.abs(i.diffDias) > 30);

  // Correctivos abiertos en memoria para cruce
  const correctivosAbiertos = (db.workOrdersAverias || []).filter(w => w && w.estado === 'en_curso');

  // Resumen semana actual
  const inicioSemana = new Date(ahora); inicioSemana.setDate(ahora.getDate() - ahora.getDay() + 1);
  const finSemana    = new Date(inicioSemana.getTime() + 6 * 86400000);
  const enSemana     = d => { const f = new Date(d); return f >= inicioSemana && f <= finSemana; };
  const mantCompletados = (db.mantenimientosPeriodicos || []).filter(m =>
    m && m.fechaUltimaEjecucion && enSemana(m.fechaUltimaEjecucion));
  const correctivosCerrados = (db.workOrdersAverias || []).filter(w =>
    w && w.estado === 'completado' && w.fechaEjecucion && enSemana(w.fechaEjecucion));
  const incidenciasResueltas = (db.workOrders || []).filter(w =>
    w && w.estado === 'completado' && w.fechaEjecucion && enSemana(w.fechaEjecucion));

  // Helpers
  const badge = (label, n, color) =>
    `<div style="padding:8px 14px;border-radius:6px;border:1px solid ${color};font-size:0.83rem;background:color-mix(in srgb,${color} 10%,transparent)">
      <strong style="color:${color}">${n}</strong> ${label}</div>`;

  const sec = (title, html) =>
    `<div class="panel-sec">
      <p style="font-weight:700;margin:0 0 8px">${title}</p>${html}</div>`;

  const filaSimple = i => {
    const asig = _getAsignadosNombres(i).length ? `<span style="font-size:0.78rem;opacity:0.7"> · 👤 ${_getAsignadosNombres(i).join(', ')}</span>` : '';
    return `<p class="txt-secondary-sm"><strong>${i.equipo}</strong> — ${i.accion}${asig}</p>`;
  };

  const filaVencido = i => {
    const dias = Math.abs(i.diffDias);
    const icono = dias > 30 ? '🔴' : dias > 7 ? '🟠' : '🟡';
    const tieneCorrectivo = correctivosAbiertos.some(w =>
      (w.equipo||'').trim().toLowerCase() === (i.equipo||'').trim().toLowerCase());
    const avisoCorrectivo = tieneCorrectivo
      ? `<span style="font-size:0.75rem;color:#f0a500;margin-left:6px">⚠ Correctivo abierto</span>` : '';
    return `<p style="font-size:0.83rem;margin:4px 0;color:var(--text)">
      ${icono} <strong>${i.equipo}</strong> — ${i.accion}
      <span style="opacity:0.65;font-size:0.8rem">(${dias}d retraso)</span>${avisoCorrectivo}</p>`;
  };

  // Resumen superior con desglose vencidos
  const desglose = vencidos.length
    ? `<span style="font-size:0.78rem;opacity:0.8"> 🟡${vAmbar.length} 🟠${vNaranja.length} 🔴${vRojo.length}</span>` : '';
  resEl.innerHTML =
    `<div style="padding:8px 14px;border-radius:6px;border:1px solid var(--red);font-size:0.83rem;background:color-mix(in srgb,var(--red) 10%,transparent)">
      <strong style="color:var(--red)">${vencidos.length}</strong> Vencidos${desglose}</div>` +
    badge('Hoy',     hoy.length,    '#f0a500') +
    badge('7 días',  prox7.length,  'var(--green)') +
    badge('30 días', prox30.length, 'var(--text)');

  // Agrupar por fecha
  const agruparPorFecha = arr => {
    const map = {};
    arr.forEach(i => { const k = fmt(i.prox); if (!map[k]) map[k] = []; map[k].push(i); });
    return map;
  };
  const renderAgrupado = arr => {
    const grupos = agruparPorFecha(arr);
    if (!Object.keys(grupos).length) return '<p class="txt-secondary-sm">Sin tareas</p>';
    return Object.entries(grupos).map(([fecha, its]) =>
      `<p style="font-size:0.8rem;color:var(--text);margin:8px 0 2px;font-weight:600">${fecha}</p>` +
      its.map(filaSimple).join('')
    ).join('');
  };

  // Carga por zona
  const zonaMap = {};
  prox30.forEach(i => { if (!i.zona) return; zonaMap[i.zona] = (zonaMap[i.zona] || 0) + 1; });
  const zonaHtml = Object.keys(zonaMap).length
    ? Object.entries(zonaMap).sort((a,b) => b[1]-a[1]).map(([z,n]) =>
        `<p class="txt-secondary-sm">${z} <span style="opacity:0.5">········</span> <strong>${n}</strong> tarea(s)</p>`
      ).join('')
    : '<p class="txt-secondary-sm">Sin datos de zona disponibles</p>';

  el.innerHTML = [
    sec('🔴 Mantenimientos vencidos',
      vencidos.length ? vencidos.map(filaVencido).join('')
        : '<p class="txt-secondary-sm">Ninguno ✅</p>'),
    sec('🟡 Mantenimientos para hoy',
      hoy.length ? hoy.map(filaSimple).join('')
        : '<p class="txt-secondary-sm">Ninguno para hoy</p>'),
    sec('📅 Próximos 7 días', renderAgrupado(prox7)),
    sec('📆 Próximos 30 días', renderAgrupado(prox30)),
    sec('📋 Resumen semana actual',
      `<p class="txt-secondary-sm">✅ Mantenimientos completados: <strong>${mantCompletados.length}</strong></p>` +
      `<p class="txt-secondary-sm">🔧 Correctivos cerrados: <strong>${correctivosCerrados.length}</strong></p>` +
      `<p class="txt-secondary-sm">⚠️ Incidencias resueltas: <strong>${incidenciasResueltas.length}</strong></p>`),
    sec('📍 Carga por zona (30 días)', zonaHtml)
  ].join('');
}
window.renderPlanificacion = renderPlanificacion;

function exportarPlanificacionXLSX() {
  const mants = _filtrarPorRol((db.mantenimientosPeriodicos || []).filter(Boolean));
  const ahora = new Date(); ahora.setHours(0,0,0,0);

  const items = mants.map(m => {
    const prox = calcularProximaFecha(m); prox.setHours(0,0,0,0);
    const diffDias = Math.round((prox.getTime() - ahora.getTime()) / 86400000);
    const eq = (window.equiposDb?.equiposGuardados || []).find(e => e && (e.equipo||'').trim().toLowerCase() === (m.equipo||'').trim().toLowerCase());
    return { ...m, prox, diffDias, zona: eq?.zona || '' };
  }).sort((a, b) => a.prox - b.prox);

  if (!items.length) { alert('No hay mantenimientos periódicos para exportar.'); return; }

  const filas = items.map(i => ({
    'Equipo':          i.equipo || '',
    'Acción':          i.accion || '',
    'Zona':            i.zona || '',
    'Periodicidad (d)': i.periodicidad || '',
    'Próxima fecha':   i.prox.toLocaleDateString('es-ES'),
    'Estado':          i.diffDias < 0 ? 'Vencido' : i.diffDias === 0 ? 'Hoy' : 'Programado',
    'Días retraso':    i.diffDias < 0 ? Math.abs(i.diffDias) : 0,
    'Asignado a':      _getAsignadosNombres(i).join(', ') || i.asignadoAExterno || 'Sin asignar'
  }));

  const blob = crearExcelBlob(filas, 'Planificación');
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `planificacion_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.exportarPlanificacionXLSX = exportarPlanificacionXLSX;
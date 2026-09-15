/* ==========================
   VARIÁVEIS GLOBAIS
   ========================== */
let equipamentos = [];
const appState = { started: false };
const state = { audioOn: false, markers: new Map(), alerts: [] };

let map = null, connCtl = null, safeCtl = null, infoCtl = null;
let chartStatus = null, chartDonut = null, chartAlertTypes = null, chartPressure = null;

const startEpoch = Date.now() / 1000;
let lastUpdateEpoch = Date.now() / 1000;

/* ===================== Regras / Diagnóstico ===================== */
const STALE_WARN_MIN = 1, STALE_FAIL_MIN = 2;
const LIMITS = { hidrante: { pressao_min_bar: 4.0, vazao_min_lpm: 500 }, sprinkler: { pressao_min_bar: 1.2 } };

const FAILURE_CODES = {
    HYD_LOW_PRESSURE: { title: 'Baixa pressão em hidrante', rec: 'Verificar bomba, válvulas e pressão da rede.' },
    HYD_LOW_FLOW: { title: 'Baixa vazão em hidrante', rec: 'Inspecionar obstruções e registros.' },
    HYD_NO_WATER: { title: 'Indício de ausência de água', rec: 'Confirmar nível do reservatório e bomba.' },
    TEL_STALE_WARN: { title: 'Telemetria desatualizada (>1 min)', rec: 'Restabelecer comunicação do nó/sensor.' },
    TEL_STALE_FAIL: { title: 'Telemetria indisponível (>2 min)', rec: 'Falha crítica de monitoramento.' },
    SPK_LOW_PRESSURE: { title: 'Baixa pressão no sprinkler', rec: 'Checar bomba, válvulas e perda de carga.' },
    SPK_OBSTRUCTED: { title: 'Sprinkler obstruído', rec: 'Remover obstrução/pintura.' },
    SPK_DAMAGED: { title: 'Sprinkler danificado/corroído', rec: 'Substituir cabeça e avaliar corrosão.' },
    SPK_TAMPER: { title: 'Válvula fechada/supervisionada', rec: 'Verificar tamper; manter válvulas abertas.' }
};

const FRIENDLY = {
    TEL_STALE_WARN: 'Telemetria desatualizada (>1 min)',
    TEL_STALE_FAIL: 'Telemetria indisponível (>2 min)',
    HYD_LOW_PRESSURE: 'Pressão do hidrante abaixo do mínimo',
    HYD_LOW_FLOW: 'Vazão do hidrante insuficiente',
    HYD_NO_WATER: 'Ausência de água',
    SPK_LOW_PRESSURE: 'Pressão do sprinkler abaixo do mínimo',
    SPK_OBSTRUCTED: 'Sprinkler obstruído',
    SPK_DAMAGED: 'Sprinkler danificado',
    SPK_TAMPER: 'Válvula fechada',
    OK: 'Sem anomalias'
};

/* ===================== Helpers ===================== */
const fmtTime = (d = new Date()) => d.toLocaleString('pt-BR');
const statusColor = s => s === 'operacional' ? 'var(--ok)' : (s === 'atencao' ? 'var(--warn)' : 'var(--fail)');
const statusLabel = s => s === 'operacional' ? 'Operacional' : (s === 'atencao' ? 'Atenção' : 'Falha');
const minutesDiff = ts => (Date.now() - new Date(String(ts).replace(' ', 'T')).getTime()) / 60000;
const getCodeByObject = o => { for (const [c, v] of Object.entries(FAILURE_CODES)) { if (v.title === o.title) return c; } return 'OK'; };
const isOnline = eq => minutesDiff(eq.ultima) < STALE_FAIL_MIN;
const secToHMS = sec => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function sanitize(t) { return String(t ?? '').replace(/[<>&'"]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[s])); }

function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translateX(120%)'; }, 3600);
    setTimeout(() => el.remove(), 4400);
}

function beep() {
    if (!state.audioOn) return;
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.001;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    o.stop(ctx.currentTime + 0.75);
}

/* ==========================
   CARREGAMENTO DE DADOS (POSTGRESQL)
   ========================== */
async function loadData() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        const response = await fetch('https://api-simi-core.onrender.com/equipamentos/listar', {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            }
        });
        
        if (!response.ok) throw new Error("Acesso negado ou falha no banco de dados.");
        
        equipamentos = await response.json();
        lastUpdateEpoch = Date.now() / 1000;
    } catch (error) {
        console.error("Erro no carregamento:", error);
    }
}

function evaluateEquipment(eq) {
    const f = [];
    const isH = eq.tipo === 'Hidrante';
    const d = eq.dados || {};
    const stale = minutesDiff(eq.ultima);

    if (stale > STALE_FAIL_MIN) f.push(FAILURE_CODES.TEL_STALE_FAIL);
    else if (stale > STALE_WARN_MIN) f.push(FAILURE_CODES.TEL_STALE_WARN);

    if (isH) {
        const p = Number(d.pressao_bar ?? NaN);
        const q = Number(d.vazao_lpm ?? NaN);
        const agua = String(d.agua ?? '').toUpperCase();
        if (agua.includes('BAIXA') || agua.includes('AUSENTE') || agua.includes('NOK')) f.push(FAILURE_CODES.HYD_NO_WATER);
        if (!Number.isNaN(p) && p < LIMITS.hidrante.pressao_min_bar) f.push(FAILURE_CODES.HYD_LOW_PRESSURE);
        if (!Number.isNaN(q) && q < LIMITS.hidrante.vazao_min_lpm) f.push(FAILURE_CODES.HYD_LOW_FLOW);
    } else {
        const p = Number(d.pressao_bar ?? NaN);
        const integ = String(d.integridade ?? '').toLowerCase();
        if (!Number.isNaN(p) && p < LIMITS.sprinkler.pressao_min_bar) f.push(FAILURE_CODES.SPK_LOW_PRESSURE);
        if (['obstruído', 'obstruido', 'bloqueado', 'pintado'].some(k => integ.includes(k))) f.push(FAILURE_CODES.SPK_OBSTRUCTED);
        if (['danificado', 'corroído', 'corroido', 'quebrado'].some(k => integ.includes(k))) f.push(FAILURE_CODES.SPK_DAMAGED);
        if (['valvula fechada', 'válvula fechada', 'tamper', 'supervisionada'].some(k => integ.includes(k))) f.push(FAILURE_CODES.SPK_TAMPER);
    }

    let status = 'operacional';
    const hard = new Set([FAILURE_CODES.HYD_LOW_PRESSURE, FAILURE_CODES.HYD_LOW_FLOW, FAILURE_CODES.HYD_NO_WATER, FAILURE_CODES.SPK_LOW_PRESSURE, FAILURE_CODES.SPK_DAMAGED, FAILURE_CODES.SPK_TAMPER, FAILURE_CODES.TEL_STALE_FAIL]);
    if (f.some(x => hard.has(x))) status = 'falha';
    else if (f.length) status = 'atencao';
    return { status, findings: f, summary: f.length ? f.map(x => x.title).join(' | ') : 'Sem anomalias detectadas' };
}

/* ===================== Mapa + Overlays ===================== */
function badgeControl(position, html) {
    const ctl = L.control({ position });
    ctl.onAdd = () => { const d = L.DomUtil.create('div', 'map-badge'); d.innerHTML = html; L.DomEvent.disableClickPropagation(d); return d };
    return ctl;
}

function infoHTML(sys = '00:00:00', last = '00:00:00', sens = '0/0') {
    return `<div style="display:flex;gap:8px"><div class="dot"></div><div><div style="font-weight:700">Sistema Ativo: <span id="ibox-sys">${sys}</span></div><div style="font-weight:700">Última Atualização: <span id="ibox-last">${last}</span></div><div style="font-weight:700">Sensores Online: <span id="ibox-sens">${sens}</span></div></div></div>`;
}

function updateInfoBox() {
    const sys = secToHMS(Date.now() / 1000 - startEpoch);
    const last = secToHMS(Date.now() / 1000 - lastUpdateEpoch);
    const online = equipamentos.reduce((a, e) => a + (isOnline(e) ? 1 : 0), 0);
    const sens = `${online}/${equipamentos.length}`;
    if (infoCtl) {
        const c = infoCtl.getContainer();
        c.querySelector('#ibox-sys').textContent = sys;
        c.querySelector('#ibox-last').textContent = last;
        c.querySelector('#ibox-sens').textContent = sens;
    }
}

function markerStyle(s) {
    const c = statusColor(s);
    return { radius: 10, color: '#111827', weight: 1, fillColor: c, fillOpacity: 0.9 };
}

function buildPopupHTML(eq) {
    const d = eq.dados, isH = eq.tipo === 'Hidrante', r = evaluateEquipment(eq);
    const tech = isH ? `<div class="key">Água</div><div>${sanitize(d.agua)}</div><div class="key">Pressão</div><div>${sanitize(d.pressao_bar)} bar</div><div class="key">Vazão</div><div>${sanitize(d.vazao_lpm)} L/min</div>` : `<div class="key">Pressão</div><div>${sanitize(d.pressao_bar)} bar</div><div class="key">Integridade</div><div>${sanitize(d.integridade)}</div>`;
    const diagHTML = r.findings.length ? r.findings.map((f, i) => `<li><strong>${i + 1}.</strong> ${sanitize(f.title)} — <em>${sanitize(f.rec)}</em></li>`).join('') : '<li>Nenhuma anomalia detectada</li>';
    return `<div class="popup-card" style="min-width:260px"><h3 style="margin:0 0 6px;font-size:15px">${sanitize(eq.tipo)} • ${sanitize(eq.id)}</h3><div class="popup-meta" style="font-size:12px;color:#555;margin-bottom:8px">${sanitize(eq.locName)}</div><div class="kv" style="display:grid;grid-template-columns:110px 1fr;gap:4px 8px;font-size:13px"><div class="key">Status</div><div style="font-weight:700;color:${statusColor(r.status)}">${statusLabel(r.status)}</div><div class="key">Última verificação</div><div>${sanitize(eq.ultima)}</div>${tech}<div class="key" style="grid-column:1/-1; font-weight:700; margin:8px 0 4px;">Diagnóstico</div><div style="grid-column:1/-1;"><ul style="margin:4px 0 0 16px; padding:0;">${diagHTML}</ul></div></div><div class="popup-actions"><button class="btn small" onclick="showDetails('${eq.id}')">🔎 Detalhes</button><button class="btn small" onclick="notificarResponsavel('${eq.id}')">📨 Notificar</button><button class="btn small danger" onclick="acionarEmergencia('${eq.id}')">🚨 EMERGÊNCIA</button></div></div>`;
}

function addOrUpdateMarker(eq) {
    if (!map) return;
    let mk = state.markers.get(eq.id);
    const r = evaluateEquipment(eq);
    /* ===================== Linha 121 do seu script.js ===================== */
    if (!mk) {
        // 1. Cria o marcador e vincula o Popup (card)
        mk = L.circleMarker(eq.coords, markerStyle(r.status))
            .addTo(map)
            .bindPopup(buildPopupHTML(eq));

        // Variável de controle vital para o nosso cronômetro
        let timeoutId;

        // --- 🟢 INÍCIO DA MELHORIA TÁTICA COMPLETA ---

        // 2. Comportamento: Passar o mouse no MARCADOR -> Abre o Card
        mk.on('mouseover', function (e) {
            clearTimeout(timeoutId); // Cancela o fechamento (se o mouse voltar rápido)
            if (!this.isPopupOpen()) {
                this.openPopup();
            }
        });

        // 3. Comportamento: Tirar o mouse do MARCADOR -> Inicia o cronômetro
        mk.on('mouseout', function (e) {
            const self = this;
            timeoutId = setTimeout(function() {
                self.closePopup();
            }, 300); // 300ms de janela de tempo
        });

        // 4. A PONTE: O que acontece quando o card efetivamente se abre
        // O Leaflet dispara 'popupopen' e nos dá acesso ao HTML do card
        mk.on('popupopen', function (e) {
            const popupNode = e.popup.getElement(); // Pega a div real do card

            // Se o mouse ENTRAR no card, paramos o cronômetro e ele não fecha mais!
            popupNode.addEventListener('mouseenter', function() {
                clearTimeout(timeoutId);
            });

            // Se o mouse SAIR do card, voltamos a iniciar o cronômetro de 300ms
            popupNode.addEventListener('mouseleave', function() {
                timeoutId = setTimeout(function() {
                    mk.closePopup();
                }, 300);
            });
        });

        // 5. Comportamento de clique como backup (ideal para telas touch/tablets)
        mk.on('click', function (e) {
            clearTimeout(timeoutId);
            if (!this.isPopupOpen()) {
                this.openPopup();
            }
        });

        // --- 🔴 FIM DA MELHORIA TÁTICA ---

        state.markers.set(eq.id, mk);
    } else {
        mk.setStyle(markerStyle(r.status));
        mk.setPopupContent(buildPopupHTML(eq));
    }
}

function initMap() {
    map = L.map('map').setView([-8.0476, -34.8770], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    connCtl = badgeControl('bottomright', `<span class="dot"></span><span class="txt">Conexão: Estável</span>`);
    safeCtl = badgeControl('bottomright', `<span class="dot"></span><span class="txt">Sistema de Segurança: Ativo</span>`);
    infoCtl = badgeControl('topright', infoHTML('00:00:00', '00:00:00', `${equipamentos.length}/${equipamentos.length}`));
    map.addControl(connCtl);
    map.addControl(safeCtl);
    map.addControl(infoCtl);
    setInterval(updateInfoBox, 1000);
    setTimeout(() => map.invalidateSize(true), 150);
    window.addEventListener('resize', () => setTimeout(() => map.invalidateSize(true), 100));
    equipamentos.forEach(addOrUpdateMarker);
}

/* ===================== Contadores / Alertas ===================== */
function atualizarContadores() {
    let ok = 0, warn = 0, fail = 0, hidr = 0, spr = 0;
    equipamentos.forEach(e => {
        const r = evaluateEquipment(e);
        if (r.status === 'operacional') ok++; else if (r.status === 'atencao') warn++; else fail++;
        if (e.tipo === 'Hidrante') hidr++; else spr++;
    });
    document.getElementById('count-ok').textContent = ok;
    document.getElementById('count-warn').textContent = warn;
    document.getElementById('count-fail').textContent = fail;
    document.getElementById('count-hidrantes').textContent = hidr;
    document.getElementById('count-sprinklers').textContent = spr;
}

function renderAlerts() {
    const c = document.getElementById('alerts');
    c.innerHTML = '';
    state.alerts.slice().reverse().forEach(a => {
        const item = document.createElement('div');
        item.className = 'alert-item';
        item.innerHTML = `<div class="alert-top"><div>${sanitize(a.equip)} — ${sanitize(a.tipo)}</div><div>${sanitize(a.hora)}</div></div><div>${sanitize(a.loc)} • ${sanitize(a.msg)}</div>`;
        c.appendChild(item);
    });
}

function pushAlert({ id, tipo, msg }) {
    const eq = equipamentos.find(e => e.id === id);
    if (!eq) return;
    const r = evaluateEquipment(eq);
    const codes = r.findings.map(f => getCodeByObject(f)).join('; ');
    const alert = { id, equip: `${eq.tipo} ${eq.id}`, loc: eq.locName, tipo, hora: fmtTime(), msg: msg + (codes ? ` [${codes}]` : '') };
    state.alerts.push(alert);
    renderAlerts();
}

function startSimulacao() { 
    equipamentos.forEach(eq => {
        const r = evaluateEquipment(eq);
        eq.status = r.status; 
        if (r.status !== 'operacional') {
            pushAlert({ id: eq.id, tipo: r.status === 'falha' ? 'Falha detectada' : 'Atenção', msg: r.summary });
        }
    });
    
    atualizarContadores(); 
    
    setInterval(async () => {
        const statusAntigo = {};
        equipamentos.forEach(e => statusAntigo[e.id] = e.status);

        await loadData();

        equipamentos.forEach(eq => {
            const r = evaluateEquipment(eq);
            eq.status = r.status; 
            const antigo = statusAntigo[eq.id];
            
            if (antigo && r.status !== antigo) {
                pushAlert({ 
                    id: eq.id, 
                    tipo: r.status === 'falha' ? 'Falha detectada' : (r.status === 'atencao' ? 'Atenção' : 'Restabelecido'), 
                    msg: r.summary 
                });
                if (r.status === 'falha') beep();
            }
            addOrUpdateMarker(eq); 
        });

        atualizarContadores();
        refreshDashCharts();
    }, 5000); 
}

/* ==========================
   INICIALIZAÇÃO E UI
   ========================== */
function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-root').style.display = 'none';
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-root').style.display = 'grid';
        
    const cargo = localStorage.getItem('userRole'); 
    const btnGerenciar = document.getElementById('btn-gerenciar-usuarios');
        
    if (btnGerenciar) {
        if (cargo === 'Comando' || cargo === 'Supervisor') {
            btnGerenciar.style.display = 'inline-block';
        } else {
            btnGerenciar.style.display = 'none';
        }
    }

    const token = localStorage.getItem('authToken');
    const infoDisplay = document.getElementById('user-info-display');
    if (token && infoDisplay) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const posto = payload.posto ? `${payload.posto} ` : '';
            const nomeGuerra = payload.login || '';
            const matricula = payload.matricula ? ` (Mat: ${payload.matricula})` : '';
            infoDisplay.textContent = `👮 ${posto}${nomeGuerra}${matricula}`;
            infoDisplay.style.display = 'inline-block';
        } catch (e) {
            infoDisplay.style.display = 'none';
        }
    }

    setTimeout(() => {
        if (typeof map !== 'undefined' && map !== null) { map.invalidateSize(true); }
    }, 250);
}

async function startAppOnce() {
    if (appState.started) return;
    appState.started = true;
    
    await loadData();
    
    if (!map) {
        initMap();
        startSimulacao();
    } else {
        equipamentos.forEach(addOrUpdateMarker);
        atualizarContadores();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verifica Token Existente
    const existingToken = localStorage.getItem('authToken');
    if (existingToken) {
        showApp();
        startAppOnce(); 
    } else {
        showLogin();
    }

    // 2. Setup de Login e Olhinho
    const form = document.getElementById('login-form');
    form.replaceWith(form.cloneNode(true));
    const newForm = document.getElementById('login-form');

    // OLHINHO RECUPERADO AQUI!
    document.getElementById('toggle-password').addEventListener('click', function() {
        const passInput = document.getElementById('login-pass');
        if (passInput.type === 'password') {
            passInput.type = 'text'; this.textContent = '🙈';
        } else {
            passInput.type = 'password'; this.textContent = '👁️';
        }
    });

    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value;
        const err = document.getElementById('login-error');
        err.style.display = 'none';

        try {
            const respostaLogin = await fetch('https://api-simi-core.onrender.com/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: user, senha: pass })
            });
            const dadosLogin = await respostaLogin.json();

            if (respostaLogin.ok) {
                localStorage.setItem('authToken', dadosLogin.token);
                const payload = JSON.parse(atob(dadosLogin.token.split('.')[1]));
                localStorage.setItem('userRole', payload.permissao);
                showApp();
                startAppOnce();
            } else {
                err.textContent = dadosLogin.erro || 'Usuário ou senha inválidos.';
                err.style.display = 'block';
            }
        } catch (erro) {
            err.textContent = 'Erro ao conectar com o servidor. O backend está rodando?';
            err.style.display = 'block';
        }
    });

    // 3. Logout Blindado e Limpeza do Formulário
    const btnLogout = document.getElementById('logout-btn');
    if (btnLogout) {
        btnLogout.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.clear();
            
            // Limpa os inputs ao sair para segurança extra
            const f = document.getElementById('login-form');
            if (f) f.reset();
            const err = document.getElementById('login-error');
            if (err) err.style.display = 'none';
            
            window.location.href = window.location.pathname; 
        });
    }

    // 4. Botão Mudo/Áudio
    document.getElementById('toggle-audio').addEventListener('click', e => { 
        state.audioOn = !state.audioOn; 
        e.currentTarget.textContent = `🔔 Alarme: ${state.audioOn ? 'Ligado' : 'Desligado'}`; 
    });

    // 5. Recuperação de Senha (MFA)
    const btnRecuperar = document.getElementById('btn-recuperar');
    if(btnRecuperar) {
        btnRecuperar.addEventListener('click', async (e) => {
            e.preventDefault();
            const user = document.getElementById('login-user').value.trim();
            const err = document.getElementById('login-error');
            if (!user) {
                err.textContent = 'Por favor, digite seu Usuário acima antes de recuperar a senha.';
                err.style.display = 'block';
                return;
            }
            err.style.display = 'none';
            toast('Gerando código e enviando para o seu e-mail...');

            try {
                const resposta = await fetch('https://api-simi-core.onrender.com/recuperar-senha', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: user })
                });
                const dados = await resposta.json();
                if (resposta.ok) {
                    toast('📧 Código enviado! Verifique seu e-mail.');
                    document.getElementById('area-recuperacao').style.display = 'block';
                    document.getElementById('btn-recuperar').style.display = 'none';
                } else {
                    err.textContent = dados.erro || 'Erro ao tentar enviar o código.';
                    err.style.display = 'block';
                }
            } catch (erro) {
                err.textContent = 'Falha de comunicação com o servidor.';
                err.style.display = 'block';
            }
        });
    }

    const btnValidarMFA = document.getElementById('btn-validar-codigo');
    if(btnValidarMFA) {
        btnValidarMFA.addEventListener('click', async () => {
            const user = document.getElementById('login-user').value.trim();
            const codigo = document.getElementById('codigo-mfa').value.trim();
            const err = document.getElementById('login-error');

            if (!codigo || codigo.length !== 6) {
                err.textContent = 'Por favor, digite o código de 6 dígitos corretamente.';
                err.style.display = 'block';
                return;
            }

            const novaSenha = prompt('Código inserido!\nDigite abaixo a sua NOVA SENHA para o sistema:');
            if (!novaSenha) return toast('Troca de senha cancelada.');

            toast('Validando código e trocando senha...');
            err.style.display = 'none';

            try {
                const resposta = await fetch('https://api-simi-core.onrender.com/trocar-senha-codigo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: user, codigo: codigo, novaSenha: novaSenha })
                });
                const dados = await resposta.json();
                if (resposta.ok) {
                    toast('✅ ' + dados.mensagem);
                    document.getElementById('area-recuperacao').style.display = 'none';
                    document.getElementById('btn-recuperar').style.display = 'block';
                    document.getElementById('codigo-mfa').value = '';
                    document.getElementById('login-pass').value = novaSenha; 
                } else {
                    err.textContent = dados.erro || 'Erro ao trocar a senha.';
                    err.style.display = 'block';
                }
            } catch (erro) {
                err.textContent = 'Erro de conexão com o servidor.';
                err.style.display = 'block';
            }
        });
    }
});

/* ===================== Modais, Relatórios e Ações de Mapa ===================== */
function showDetails(id) {
    const eq = equipamentos.find(e => e.id === id); if (!eq) return; const r = evaluateEquipment(eq); const codes = r.findings.map(f => getCodeByObject(f)); const recs = r.findings.map(f => `• ${FRIENDLY[getCodeByObject(f)] || f.title}`).join('<br>') || '—';
    document.getElementById('detailsTitle').innerHTML = `${eq.tipo === 'Hidrante' ? '🚒' : '🧯'} Detalhes do ${sanitize(eq.tipo)} – <span style="color:#c00">${sanitize(eq.id)}</span>`;
    const body = `<p><strong>Localização:</strong> ${sanitize(eq.locName)}</p><p><strong>Status Atual:</strong> <span style="color:${statusColor(r.status)};font-weight:700">${statusLabel(r.status)}</span></p><p><strong>Última verificação:</strong> ${sanitize(eq.ultima)}</p>${eq.tipo === 'Hidrante' ? `<p><strong>Água:</strong> ${sanitize(eq.dados.agua)}</p><p><strong>Pressão:</strong> ${sanitize(eq.dados.pressao_bar)} bar</p><p><strong>Vazão:</strong> ${sanitize(eq.dados.vazao_lpm)} L/min</p>` : `<p><strong>Pressão:</strong> ${sanitize(eq.dados.pressao_bar)} bar</p><p><strong>Integridade:</strong> ${sanitize(eq.dados.integridade)}</p>`}<p><strong>Códigos/Problemas:</strong> ${codes.length ? sanitize(codes.join(', ')) : 'OK'}</p><p><strong>Descrição/Diagnóstico:</strong><br>${recs}</p><hr><p><strong>Responsável:</strong> ${sanitize(eq.responsavel.nome)}<br><strong>Telefone:</strong> ${sanitize(eq.responsavel.tel)}<br><strong>E-mail:</strong> ${sanitize(eq.responsavel.email)}</p>`;
    document.getElementById('detailsBody').innerHTML = body; document.getElementById('detailsModal').style.display = 'flex'; document.getElementById('detailsNotify').onclick = () => notificarResponsavel(id); document.getElementById('btn-emergencia').onclick = () => acionarEmergencia(id);
}

document.getElementById('detailsClose').addEventListener('click', () => { document.getElementById('detailsModal').style.display = 'none'; }); document.getElementById('detailsClose2').addEventListener('click', () => { document.getElementById('detailsModal').style.display = 'none'; }); document.getElementById('detailsModal').addEventListener('click', e => { if (e.target.id === 'detailsModal') e.currentTarget.style.display = 'none'; });

async function notificarResponsavel(id) { 
    const eq = equipamentos.find(e => e.id === id); 
    if (!eq) return toast('⚠️ Equipamento não encontrado.'); 
    const r = evaluateEquipment(eq);
    const falhasTexto = r.findings.map(f => f.title).join(', ');
    toast('Enviando notificações ao responsável...');
    const token = localStorage.getItem('authToken');

    try {
        const resposta = await fetch('https://api-simi-core.onrender.com/notificar/enviar-alerta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ id_equipamento: eq.id, tipo: eq.tipo, local: eq.locName, falhas: falhasTexto, responsavel: eq.responsavel })
        });
        if (resposta.ok) {
            toast('🚀 Notificação enviada via E-mail!'); 
            pushAlert({ id: eq.id, tipo: 'Notificação', msg: 'Responsável notificado.' }); 
        } else {
            const erroData = await resposta.json(); toast(`⚠️ Erro: ${erroData.erro || 'Não foi possível notificar.'}`);
        }
    } catch (erro) {
        toast('⚠️ Falha de conexão com o servidor de mensagens.');
    }
}

function acionarEmergencia(id) { const eq = equipamentos.find(e => e.id === id); if (!eq) return; for (let i = 0; i < 2; i++) setTimeout(() => beep(), i * 250); pushAlert({ id: eq.id, tipo: 'EMERGÊNCIA', msg: 'Acionamento manual registrado' }); toast('🚨 Emergência registrada!'); }

document.getElementById('download-alerts').addEventListener('click', () => { const headers = ['Data/Hora', 'Equipamento', 'Localização', 'Tipo', 'Mensagem (com códigos)']; const lines = state.alerts.map(a => [`"${a.hora}"`, a.equip, `"${a.loc}"`, a.tipo, `"${a.msg}"`].join(',')); const csv = [headers.join(','), ...lines].join('\n'); const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `alertas_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url); });
document.getElementById('clear-alerts').addEventListener('click', () => { state.alerts = []; renderAlerts(); });
function loadLegendTable() { const tb = document.getElementById('legendBody'); tb.innerHTML = ''; Object.entries(FAILURE_CODES).forEach(([code, val]) => { const tr = document.createElement('tr'); tr.innerHTML = `<td style="padding:8px;border-bottom:1px solid #f2f2f2;font-family:monospace">${code}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${val.title}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${val.rec}</td>`; tb.appendChild(tr); }); }
document.getElementById('btn-legend').addEventListener('click', () => { loadLegendTable(); document.getElementById('legendModal').style.display = 'flex'; });
document.getElementById('legendClose').addEventListener('click', () => { document.getElementById('legendModal').style.display = 'none'; });
document.getElementById('legendModal').addEventListener('click', e => { if (e.target.id === 'legendModal') e.currentTarget.style.display = 'none'; });
function loadHistoryTable() { const tb = document.getElementById('historyBody'); tb.innerHTML = ''; state.alerts.slice().reverse().forEach(a => { const tr = document.createElement('tr'); tr.innerHTML = `<td style="padding:8px;border-bottom:1px solid #f2f2f2">${sanitize(a.hora)}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${sanitize(a.equip)}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${sanitize(a.loc)}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${sanitize(a.tipo)}</td><td style="padding:8px;border-bottom:1px solid #f2f2f2">${sanitize(a.msg)}</td>`; tb.appendChild(tr); }); }
const openHistory = () => { loadHistoryTable(); document.getElementById('historyModal').style.display = 'flex'; }; const closeHistory = () => { document.getElementById('historyModal').style.display = 'none'; };
document.getElementById('history-alerts').addEventListener('click', openHistory); document.getElementById('historyClose').addEventListener('click', closeHistory); document.getElementById('historyClose2').addEventListener('click', closeHistory); document.getElementById('historyModal').addEventListener('click', e => { if (e.target.id === 'historyModal') closeHistory(); });

/* ===================== Dashboards / Charts ===================== */
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function computeStatusCounts() { let ok = 0, warn = 0, fail = 0; equipamentos.forEach(e => { const r = evaluateEquipment(e); if (r.status === 'operacional') ok++; else if (r.status === 'atencao') warn++; else fail++; }); return { ok, warn, fail, total: equipamentos.length }; }
function computeAlertTypeCounts() { const m = new Map(); equipamentos.forEach(e => { evaluateEquipment(e).findings.forEach(f => { const k = FRIENDLY[getCodeByObject(f)] || f.title; m.set(k, (m.get(k) || 0) + 1); }); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8); }
function computePressureSeries() { const labels = [], values = []; equipamentos.forEach(e => { labels.push(e.id.toLowerCase()); values.push(typeof e.dados.pressao_bar === 'number' ? e.dados.pressao_bar : 0); }); const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : 0; return { labels, values, avg: +avg.toFixed(2) }; }
function titlePlugin(text) { return { display: true, text, align: 'start', font: { size: 14, weight: 'bold' } }; }
function initDashCharts() {
    const green = cssVar('--ok'), yellow = cssVar('--warn'), red = cssVar('--fail');
    if (!chartStatus) { const st = computeStatusCounts(); chartStatus = new Chart(document.getElementById('chartStatus').getContext('2d'), { type: 'bar', data: { labels: ['Operacional', 'Atenção', 'Falha'], datasets: [{ data: [st.ok, st.warn, st.fail], backgroundColor: [green, yellow, red] }] }, options: { responsive: true, plugins: { legend: { display: false }, title: titlePlugin('Status Geral por Equipamento'), datalabels: { color: '#fff', anchor: 'center', align: 'center', font: { size: 12, weight: 'bold' }, formatter: (v, ctx) => { const s = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1; const p = Math.round(v / s * 100); return `${v} (${p}%)`; } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }, plugins: [ChartDataLabels] }); }
    if (!chartDonut) { const st = computeStatusCounts(); chartDonut = new Chart(document.getElementById('chartDonut').getContext('2d'), { type: 'doughnut', data: { labels: ['Operacional', 'Atenção', 'Falha'], datasets: [{ data: [st.ok, st.warn, st.fail], backgroundColor: [green, yellow, red] }] }, options: { responsive: true, cutout: '55%', plugins: { legend: { display: true, position: 'top' }, title: titlePlugin(`Contagem de Falhas (Total) — Total de Sensores: ${st.total}`), datalabels: { color: '#000', font: { size: 12, weight: 'bold' }, formatter: (v, ctx) => { const s = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1; const p = Math.round(v / s * 100); return `${v} (${p}%)`; } } } }, plugins: [ChartDataLabels] }); }
    if (!chartAlertTypes) { const e = computeAlertTypeCounts(); chartAlertTypes = new Chart(document.getElementById('chartAlertTypes').getContext('2d'), { type: 'bar', data: { labels: e.map(i => i[0]), datasets: [{ label: 'Ocorrências', data: e.map(i => i[1]), backgroundColor: cssVar('--fail') }] }, options: { responsive: true, plugins: { legend: { display: false }, title: titlePlugin('Distribuição de Tipos de Alerta') }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }); }
    if (!chartPressure) { const ps = computePressureSeries(); chartPressure = new Chart(document.getElementById('chartPressure').getContext('2d'), { type: 'bar', data: { labels: ps.labels, datasets: [{ label: 'Pressão (bar)', data: ps.values, backgroundColor: cssVar('--ok') }] }, options: { responsive: true, plugins: { legend: { display: true }, title: titlePlugin(`Pressão Média Atual — Média Geral Atual: ${ps.avg} bar`) }, scales: { y: { beginAtZero: true } } } }); }
    refreshDashCharts();
}
function refreshDashCharts() {
    if (!chartStatus || !chartDonut || !chartAlertTypes || !chartPressure) return;
    const st = computeStatusCounts();
    chartStatus.data.datasets[0].data = [st.ok, st.warn, st.fail]; chartStatus.update('none');
    chartDonut.data.datasets[0].data = [st.ok, st.warn, st.fail]; chartDonut.options.plugins.title.text = `Contagem de Falhas (Total) — Total de Sensores: ${st.total}`; chartDonut.update('none');
    const e = computeAlertTypeCounts();
    chartAlertTypes.data.labels = e.map(i => i[0]); chartAlertTypes.data.datasets[0].data = e.map(i => i[1]); chartAlertTypes.update('none');
    const ps = computePressureSeries();
    chartPressure.data.labels = ps.labels; chartPressure.data.datasets[0].data = ps.values; chartPressure.options.plugins.title.text = `Pressão Média Atual — Média Geral Atual: ${ps.avg} bar`; chartPressure.update('none');
}

document.getElementById('report-btn').addEventListener('click', () => { const p = document.getElementById('dashPanel'); const open = p.style.display !== 'none' && p.style.display !== ''; p.style.display = open ? 'none' : 'block'; if (!open) initDashCharts(); });
['btn-close-dash', 'btn-close-dash-2'].forEach(id => document.getElementById(id).addEventListener('click', () => { document.getElementById('dashPanel').style.display = 'none'; }));
function downloadCanvasFromChart(chart, name) { const a = document.createElement('a'); a.href = chart.toBase64Image('image/png', 1); a.download = `${name}_${new Date().toISOString().slice(0, 10)}.png`; a.click(); }
document.getElementById('btn-dl-bar').addEventListener('click', () => chartStatus && downloadCanvasFromChart(chartStatus, 'grafico_colunas'));
document.getElementById('btn-dl-pie').addEventListener('click', () => chartDonut && downloadCanvasFromChart(chartDonut, 'grafico_pizza'));
document.getElementById('btn-dl-charts').addEventListener('click', () => {
    if (!chartStatus || !chartDonut || !chartAlertTypes || !chartPressure) { toast('⚠️ Gráficos ainda não carregados.'); return; }
    const pad = 24, c1 = chartStatus.canvas, c2 = chartDonut.canvas, c3 = chartAlertTypes.canvas, c4 = chartPressure.canvas;
    const tileW = Math.max(c1.width, c2.width, c3.width, c4.width), tileH = Math.max(c1.height, c2.height, c3.height, c4.height);
    const W = tileW * 2 + pad * 3, H = tileH * 2 + pad * 3;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(c1, pad, pad); ctx.drawImage(c2, tileW + pad * 2, pad); ctx.drawImage(c3, pad, tileH + pad * 2); ctx.drawImage(c4, tileW + pad * 2, tileH + pad * 2);
    cv.toBlob(b => { const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = `dashboard_${new Date().toISOString().slice(0, 10)}.png`; a.click(); URL.revokeObjectURL(url); });
});
document.getElementById('btn-dl-summary').addEventListener('click', () => {
    const headers = ['ID', 'Tipo', 'Status', 'Localização', 'Última Verificação', 'Pressão (bar)', 'Vazão (L/min)', 'Água', 'Integridade', 'Códigos', 'Recomendações', 'Responsável', 'Telefone', 'Email'];
    const lines = equipamentos.map(e => { const r = evaluateEquipment(e); const codes = r.findings.map(f => getCodeByObject(f)).join(' | '); const recs = r.findings.map(f => f.rec).join(' | '); return [e.id, e.tipo, statusLabel(r.status), `"${e.locName}"`, e.ultima, e.dados.pressao_bar ?? '', e.tipo === 'Hidrante' ? (e.dados.vazao_lpm ?? '') : '', e.tipo === 'Hidrante' ? (e.dados.agua ?? '') : '', e.tipo === 'Sprinkler' ? (e.dados.integridade ?? '') : '', `"${codes}"`, `"${recs}"`, `"${e.responsavel.nome}"`, e.responsavel.tel, e.responsavel.email].join(','); });
    const csv = [headers.join(','), ...lines].join('\n'); const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `relatorio_resumido_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
});
document.getElementById('btn-dl-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' }); const X = 40, LH = 14; let y = 50; const PH = doc.internal.pageSize.getHeight();
    const add = (t, b = false) => { if (y > PH - 60) { doc.addPage(); y = 50 } if (b) doc.setFont(undefined, 'bold'); doc.text(String(t), X, y); if (b) doc.setFont(undefined, 'normal'); y += LH; };
    doc.setFontSize(16); add('Relatório Técnico – Sistema de Hidrantes e Sprinklers', true);
    doc.setFontSize(10); add(`Emitido em: ${new Date().toLocaleString('pt-BR')}`); y += 8;
    const sum = (s) => equipamentos.reduce((a, e) => a + (evaluateEquipment(e).status === s ? 1 : 0), 0);
    add(`Resumo: Total ${equipamentos.length} • Operacionais ${sum('operacional')} • Atenção ${sum('atencao')} • Falhas ${sum('falha')}`); y += 6;
    equipamentos.forEach(e => {
        const r = evaluateEquipment(e); const codes = r.findings.map(getCodeByObject).join(', ') || 'OK';
        y += 6; doc.setDrawColor(230); doc.line(X, y, X + 515, y); y += 16;
        doc.setFontSize(12); add(`${e.tipo} ${e.id} – ${statusLabel(r.status)}`, true); doc.setFontSize(10);
        add(`Local: ${e.locName}`); add(`Última verificação: ${e.ultima}`);
        if (e.tipo === 'Hidrante') { add(`Pressão (bar): ${e.dados.pressao_bar ?? '-'}`); add(`Vazão (L/min): ${e.dados.vazao_lpm ?? '-'}`); add(`Água: ${e.dados.agua ?? '-'}`); } else { add(`Pressão (bar): ${e.dados.pressao_bar ?? '-'}`); add(`Integridade: ${e.dados.integridade ?? '-'}`); }
        add(`Códigos: ${codes}`);
    });
    doc.save(`relatorio_incendio_${new Date().toISOString().slice(0, 10)}.pdf`);
});

document.getElementById('history-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' }); const X = 40, LH = 14; let y = 50; const PH = doc.internal.pageSize.getHeight();
    const add = (t, b = false) => { if (y > PH - 60) { doc.addPage(); y = 50 } if (b) doc.setFont(undefined, 'bold'); doc.text(String(t), X, y); if (b) doc.setFont(undefined, 'normal'); y += LH; };
    doc.setFontSize(16); add('Histórico de Alertas', true); doc.setFontSize(10); add(`Gerado em: ${new Date().toLocaleString('pt-BR')}`); y += 8;
    state.alerts.forEach(a => { y += 6; doc.setDrawColor(230); doc.line(X, y, X + 515, y); y += 16; add(`Data/Hora: ${a.hora}`, true); add(`Equipamento: ${a.equip}`); add(`Local: ${a.loc}`); add(`Tipo: ${a.tipo}`); add(`Mensagem: ${a.msg}`); });
    doc.save(`historico_alertas_${new Date().toISOString().slice(0, 10)}.pdf`);
});
document.getElementById('history-xlsx').addEventListener('click', () => { const rows = state.alerts.map(a => ({ 'Data/Hora': a.hora, 'Equipamento': a.equip, 'Localização': a.loc, 'Tipo': a.tipo, 'Mensagem': a.msg })); const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Histórico'); XLSX.writeFile(wb, `historico_alertas_${new Date().toISOString().slice(0, 10)}.xlsx`); });

// ==========================================
// GESTÃO DE USUÁRIOS E EFETIVO (CRUD)
// ==========================================
const modalUsuarios = document.getElementById('modal-usuarios');
const btnGerenciarMenu = document.getElementById('btn-gerenciar-usuarios');
const viewTabela = document.getElementById('view-tabela-usuarios');
const viewForm = document.getElementById('view-form-usuario');
const formNovoUsuario = document.getElementById('form-novo-usuario');

if (btnGerenciarMenu) {
    btnGerenciarMenu.addEventListener('click', () => {
        modalUsuarios.style.display = 'flex';
        mostrarTabelaUsuarios();
    });
}

const fecharModalGestao = () => { modalUsuarios.style.display = 'none'; };
document.getElementById('close-modal-usuarios')?.addEventListener('click', fecharModalGestao);
document.getElementById('btn-fechar-tabela')?.addEventListener('click', fecharModalGestao);
window.addEventListener('click', (e) => { if (e.target === modalUsuarios) fecharModalGestao(); });

document.getElementById('btn-novo-usuario')?.addEventListener('click', () => {
    document.getElementById('edit-user-id').value = ''; 
    formNovoUsuario.reset(); 
    document.getElementById('novo-user-senha').required = true; 
    viewTabela.style.display = 'none';
    viewForm.style.display = 'block';
    document.getElementById('titulo-modal-usuarios').textContent = "Cadastrar Novo Militar";
});

document.getElementById('btn-voltar-tabela')?.addEventListener('click', mostrarTabelaUsuarios);

function mostrarTabelaUsuarios() {
    // Rito de Limpeza Completa: Oculta TODAS as outras visões possíveis
    viewForm.style.display = 'none';     // Oculta o formulário de cadastro de militar
    viewDespacho.style.display = 'none'; // <-- ADICIONE ESTA LINHA: Oculta a visão de despacho/código

    // Ativa apenas a visão correta
    viewTabela.style.display = 'block'; // Mostra a tabela de efetivo
    document.getElementById('titulo-modal-usuarios').textContent = "Gestão de Efetivo";
    carregarTabelaUsuarios();
}

async function carregarTabelaUsuarios() {
    const token = localStorage.getItem('authToken');
    const tbody = document.getElementById('tbody-usuarios');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 15px;">⏳ Carregando efetivo...</td></tr>';

    let usuarioLogado = "", cargoLogado = "";
    if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        usuarioLogado = payload.login; cargoLogado = payload.permissao; 
    }

    try {
        const resposta = await fetch('https://api-simi-core.onrender.com/listar-usuarios', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!resposta.ok) throw new Error("Erro ao buscar usuários");
        
        const usuarios = await resposta.json();
        tbody.innerHTML = '';

        usuarios.forEach(u => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #eee';
            
            let podeEditar = true, podeExcluir = true;
            if (cargoLogado === 'Supervisor' && u.cargo !== 'Operador') {
                if (u.login !== usuarioLogado) podeEditar = false;
                podeExcluir = false; 
            }
            if (u.login === usuarioLogado) podeExcluir = false;

            const uData = JSON.stringify({ id: u.id, login: u.login, email: u.email, telefone: u.telefone, posto_grad: u.posto_grad, matricula: u.matricula, regiao_atuacao: u.regiao_atuacao, cargo: u.cargo });
            let btnEditar = podeEditar ? `<button class="btn small" style="background-color: #3b82f6; color: white;" onclick='editarUsuario(${uData})'>✏️ Editar</button>` : `<button class="btn small" style="background:#ccc; color:#666; cursor:not-allowed;">🚫 Editar</button>`;
            let btnExcluir = podeExcluir ? `<button class="btn small danger" onclick="excluirUsuario('${u.id}', '${u.login}')">🗑️ Excluir</button>` : `<button class="btn small" style="background:#ccc; color:#666; cursor:not-allowed;">🚫 Excluir</button>`;
            if (u.login === usuarioLogado) btnExcluir = `<button class="btn small" style="background:#ccc; color:#666; cursor:not-allowed;">🚫 Atual</button>`;
            
            tr.innerHTML = `<td style="padding: 10px;">${u.posto_grad || '-'}</td><td style="padding: 10px; font-weight: bold; color: #333;">${u.login}</td><td style="padding: 10px;">${u.matricula || '-'}</td><td style="padding: 10px;"><span class="pill" style="background:#e5e7eb; color:#374151;">${u.cargo}</span></td><td style="padding: 10px; text-align: center;">${btnEditar} ${btnExcluir}</td>`;
            tbody.appendChild(tr);
        });
    } catch (erro) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red; padding: 15px;">Falha ao carregar dados.</td></tr>';
    }
}

window.editarUsuario = function(u) {
    document.getElementById('edit-user-id').value = u.id; 
    document.getElementById('novo-user-login').value = u.login;
    document.getElementById('novo-user-email').value = u.email || '';
    document.getElementById('novo-user-tel').value = u.telefone || '';
    document.getElementById('novo-user-posto').value = u.posto_grad || '';
    document.getElementById('novo-user-mat').value = u.matricula || '';
    document.getElementById('novo-user-regiao').value = u.regiao_atuacao || '';
    document.getElementById('novo-user-cargo').value = u.cargo;
    
    const campoSenha = document.getElementById('novo-user-senha');
    campoSenha.value = ''; campoSenha.required = false; 
    viewTabela.style.display = 'none'; viewForm.style.display = 'block';
    document.getElementById('titulo-modal-usuarios').textContent = "Editar Dados do Militar";
};

window.excluirUsuario = async function(id, login) {
    if (!confirm(`TEM CERTEZA que deseja EXCLUIR permanentemente o acesso de "${login}"?`)) return;
    const token = localStorage.getItem('authToken');
    toast('Excluindo usuário...');
    try {
        const resposta = await fetch(`https://api-simi-core.onrender.com/excluir-usuario/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        const dados = await resposta.json();
        if (resposta.ok) { toast('✅ ' + dados.mensagem); carregarTabelaUsuarios(); } 
        else { toast('⚠️ Erro: ' + dados.erro); }
    } catch (erro) { toast('⚠️ Erro de comunicação com o servidor.'); }
};

if (formNovoUsuario) {
    formNovoUsuario.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-user-id').value;
        const login = document.getElementById('novo-user-login').value.trim();
        const senha = document.getElementById('novo-user-senha').value.trim();
        const email = document.getElementById('novo-user-email').value.trim();
        const telefone = document.getElementById('novo-user-tel').value.trim();
        const cargo = document.getElementById('novo-user-cargo').value;
        const posto_grad = document.getElementById('novo-user-posto').value;
        const matricula = document.getElementById('novo-user-mat').value.trim();
        const regiao = document.getElementById('novo-user-regiao').value;

        const token = localStorage.getItem('authToken');
        const url = id ? `https://api-simi-core.onrender.com/editar-usuario/${id}` : 'https://api-simi-core.onrender.com/cadastrar-usuario';
        const method = id ? 'PUT' : 'POST';

        toast(id ? 'Atualizando dados no banco...' : 'Salvando novo usuário...');

        try {
            const resposta = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ login, senha, email, telefone, cargo, posto_grad, matricula, regiao })
            });
            const dados = await resposta.json();
            if (resposta.ok) { toast('✅ ' + dados.mensagem); mostrarTabelaUsuarios(); } 
            else { toast('⚠️ Erro: ' + (dados.erro || 'Falha na operação.')); }
        } catch (erro) { toast('⚠️ Erro de conexão com o servidor Node.js.'); }
    });
}

// ==========================================
// GESTÃO DE DESPACHO DE GUARNIÇÕES
// ==========================================

const viewDespacho = document.getElementById('view-despacho-guarnicao');

// Evento para abrir a tela de despacho a partir da tabela
document.getElementById('btn-abrir-despacho')?.addEventListener('click', () => {
    document.getElementById('view-tabela-usuarios').style.display = 'none';
    document.getElementById('view-form-usuario').style.display = 'none';
    viewDespacho.style.display = 'block';
    
    document.getElementById('titulo-modal-usuarios').textContent = "Despacho Operacional";
    document.getElementById('resultado-codigo').style.display = 'none'; // Esconde o resultado anterior
});

// Evento para o botão de voltar (que adicionamos no HTML)
document.getElementById('btn-voltar-tabela-despacho')?.addEventListener('click', mostrarTabelaUsuarios);

// Formulário de submissão para gerar o código tático
document.getElementById('form-gerar-codigo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const regiao = document.getElementById('select-regiao-turno').value;
    const carga = document.getElementById('select-carga-turno').value;
    const token = localStorage.getItem('authToken');

    toast('Forjando chave criptográfica...');

    try {
        const resposta = await fetch('https://api-simi-core.onrender.com/gerar-codigo-turno', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ regiao_simi: regiao, carga_horaria: carga })
        });
        
        const dados = await resposta.json();
        
        if (resposta.ok) {
            // Exibe o painel com o resultado
            document.getElementById('resultado-codigo').style.display = 'block';
            document.getElementById('display-codigo-gerado').textContent = dados.codigo_acesso;
            
            // Formata a data de expiração para o padrão brasileiro
            const dataValidade = new Date(dados.validade);
            const validadeFormatada = dataValidade.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            
            document.getElementById('display-validade-gerada').textContent = `Válido até: ${validadeFormatada}`;
            
            toast('✅ Chave operacional gerada e gravada no banco!');
        } else {
            toast(`⚠️ Erro: ${dados.erro}`);
        }
    } catch (erro) {
        toast('⚠️ Falha de comunicação com o servidor Central.');
    }
});
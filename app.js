document.body.style.background = "red";
alert("APP JS ESTÁ RODANDO");
// =====================================================
// USUÁRIO (MULTIUSUÁRIO BASE)
// =====================================================

const usuario = {
    id: localStorage.getItem("usuario_id") ||
        "user_" + Math.random().toString(36).substr(2, 6),

    nome: localStorage.getItem("usuario_nome") || "Operador"
};

localStorage.setItem("usuario_id", usuario.id);

// =====================================================
// ESTADO LOCAL (FALLBACK OFFLINE)
// =====================================================

let inventarioLocal = JSON.parse(localStorage.getItem("inventario")) || [];

let ativos = JSON.parse(localStorage.getItem("ativos")) || [
    { patrimonio: "PAT0001", status: "Estoque" },
    { patrimonio: "PAT0002", status: "Locado" },
    { patrimonio: "PAT0003", status: "Manutencao" }
];

// =====================================================
// SOCKET (TEMPO REAL - MULTIUSUÁRIO)
// =====================================================

let socket = null;

function iniciarSocket() {

    if (typeof io === "undefined") return;

    socket = io("https://SEU-SERVIDOR");

    socket.on("connect", () => {
        console.log("Conectado ao servidor WMS");
        socket.emit("join", usuario);
    });

    socket.on("inventario-update", (data) => {
        atualizarDashboardRemoto(data);
    });
}

// =====================================================
// ELEMENTOS UI
// =====================================================

const input = document.getElementById("inputPatrimonio");
const lista = document.getElementById("listaItens");

const feedback = document.getElementById("feedbackWMS");
const feedbackTexto = document.getElementById("feedbackTexto");

// dashboard
const qtdOk = document.getElementById("qtdOk");
const qtdNao = document.getElementById("qtdNao");
const qtdPendentes = document.getElementById("qtdPendentes");

// câmera
const btnCamera = document.getElementById("btnCamera");
const readerElement = document.getElementById("reader");

// =====================================================
// SCANNER PROFISSIONAL
// =====================================================

let html5QrCode = null;
let scannerAtivo = false;
let ultimoCodigo = "";
let lock = false;
let timeoutReset = null;

// =====================================================
// SALVAR LOCAL (OFFLINE)
// =====================================================

function salvarLocal() {
    localStorage.setItem("inventario", JSON.stringify(inventarioLocal));
}

// =====================================================
// ENVIAR PARA SERVIDOR (MULTIUSUÁRIO)
// =====================================================

async function enviarServidor(patrimonio, status) {

    if (!socket) return;

    socket.emit("inventario", {
        usuario,
        patrimonio,
        status,
        data: new Date()
    });
}

// fallback HTTP (caso não use socket)
async function enviarHTTP(patrimonio, status) {

    try {
        await fetch("https://SEU-SERVIDOR/api/inventario", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                usuario,
                patrimonio,
                status,
                data: new Date()
            })
        });
    } catch (e) {
        console.log("Offline mode");
    }
}

// =====================================================
// BUSCA PRINCIPAL
// =====================================================

function buscar(patrimonio) {

    const codigo = patrimonio.trim().toUpperCase();
    if (!codigo) return;

    const ativo = ativos.find(a => a.patrimonio === codigo);

    const dataHora = new Date().toLocaleString("pt-BR");

    let registro = {
        usuario: usuario.id,
        patrimonio: codigo,
        data: dataHora
    };

    if (!ativo) {

        registro.status = "NAO_ENCONTRADO";

        inventarioLocal.push(registro);

        mostrarErro(codigo);

    } else {

        registro.status = "OK";
        registro.tipo = ativo.status;

        inventarioLocal.push(registro);

        mostrarOK(codigo);
    }

    salvarLocal();
    render();

    // envia para servidor (multiusuário)
    enviarServidor(codigo, registro.status);
    enviarHTTP(codigo, registro.status);
}

// =====================================================
// RENDER LISTA
// =====================================================

function render() {

    lista.innerHTML = "";

    const ultimos = inventarioLocal.slice(-10).reverse();

    ultimos.forEach(item => {

        const li = document.createElement("li");

        li.innerHTML = `
            <span>${item.patrimonio}</span>
            <strong>${item.status === "OK" ? "✔ OK" : "❌ NÃO ENCONTRADO"}</strong>
        `;

        lista.appendChild(li);
    });

    atualizarDashboard();
}

// =====================================================
// DASHBOARD LOCAL
// =====================================================

function atualizarDashboard() {

    const total = ativos.length;

    const ok = inventarioLocal.filter(i => i.status === "OK").length;

    const nao = inventarioLocal.filter(i => i.status === "NAO_ENCONTRADO").length;

    const pendentes = total - (ok + nao);

    if (qtdOk) qtdOk.textContent = ok;
    if (qtdNao) qtdNao.textContent = nao;
    if (qtdPendentes) qtdPendentes.textContent = pendentes;
}

// =====================================================
// FEEDBACK WMS
// =====================================================

function resetFeedback() {
    feedback.className = "feedback-wms ready";
    feedbackTexto.innerText = "APONTE PARA O PATRIMÔNIO";
}

function mostrarOK(codigo) {

    feedback.className = "feedback-wms ok";
    feedbackTexto.innerText = "✔ OK - " + codigo;

    if (navigator.vibrate) navigator.vibrate(100);

    setTimeout(resetFeedback, 600);
}

function mostrarErro() {

    feedback.className = "feedback-wms error";
    feedbackTexto.innerText = "❌ NÃO ENCONTRADO";

    if (navigator.vibrate) navigator.vibrate([150, 50, 150]);

    setTimeout(resetFeedback, 900);
}

// =====================================================
// SCANNER MANUAL
// =====================================================

document.getElementById("btnBuscar").addEventListener("click", () => {

    buscar(input.value);

    input.value = "";
    input.focus();
});

input.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {
        document.getElementById("btnBuscar").click();
    }
});

// =====================================================
// CÂMERA PROFISSIONAL
// =====================================================

async function iniciarScanner() {

    if (scannerAtivo) return;

    html5QrCode = new Html5Qrcode("reader");

    try {

        await html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 12,
                qrbox: 250
            },
            onScanSuccess,
            onScanError
        );

        scannerAtivo = true;

    } catch (err) {
        console.error(err);
        alert("Erro ao abrir câmera");
    }
}

async function pararScanner() {

    if (!scannerAtivo) return;

    await html5QrCode.stop();
    await html5QrCode.clear();

    scannerAtivo = false;
    readerElement.innerHTML = "";
}

// =====================================================
// SCANNER CONTÍNUO (ANTI DUPLICAÇÃO GLOBAL)
// =====================================================

function onScanSuccess(decodedText) {

    const codigo = decodedText.trim().toUpperCase();

    if (lock) return;
    if (codigo === ultimoCodigo) return;

    ultimoCodigo = codigo;
    lock = true;

    buscar(codigo);

    input.value = codigo;

    if (navigator.vibrate) {
        navigator.vibrate([80, 40, 80]);
    }

    setTimeout(() => {
        lock = false;
    }, 800);

    clearTimeout(timeoutReset);
    timeoutReset = setTimeout(() => {
        ultimoCodigo = "";
    }, 1500);
}

function onScanError() {
    // silencioso
}

// =====================================================
// BOTÃO CÂMERA
// =====================================================

btnCamera.addEventListener("click", async () => {

    if (!scannerAtivo) {

        await iniciarScanner();
        btnCamera.innerText = "⛔ Parar Câmera";

    } else {

        await pararScanner();
        btnCamera.innerText = "📷 Ativar Câmera";
    }
});

// =====================================================
// SOCKET INIT
// =====================================================

iniciarSocket();

// =====================================================
// INIT
// =====================================================

render();
input.focus();

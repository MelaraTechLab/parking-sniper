let state = {
    isActive: false,
    vehicleType: "car",
    parkings: [],
    refreshInterval: 10,
    alertUrl: "",
    vehicleData: {
        plate: "",
        brand: "",
        model: "",
        color: "",
    },
    logs: [],
};

const icons = {
    trash: `
        <svg class="icon" viewBox="0 0 24 24" role="presentation">
            <path d="M6 7h12m-9 3v6m6-6v6M9 7V5.6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 5.6V7m3 0v11.2A1.8 1.8 0 0 1 16.2 20H7.8A1.8 1.8 0 0 1 6 18.2V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
    `,
};

const elements = {
    toggleBtn: document.getElementById("toggleBtn"),
    toggleBtnLabel: document.querySelector("#toggleBtn .btn-label"),
    statusIndicator: document.getElementById("statusIndicator"),
    statusText: document.getElementById("statusText"),
    parkingsList: document.getElementById("parkingsList"),
    addParkingBtn: document.getElementById("addParkingBtn"),
    addParkingModal: document.getElementById("addParkingModal"),
    parkingName: document.getElementById("parkingName"),
    saveParkingBtn: document.getElementById("saveParkingBtn"),
    cancelParkingBtn: document.getElementById("cancelParkingBtn"),
    refreshInterval: document.getElementById("refreshInterval"),
    alertUrl: document.getElementById("alertUrl"),
    vehiclePlate: document.getElementById("vehiclePlate"),
    vehicleBrand: document.getElementById("vehicleBrand"),
    vehicleModel: document.getElementById("vehicleModel"),
    vehicleColor: document.getElementById("vehicleColor"),
    activityLog: document.getElementById("activityLog"),
    vehicleTypes: document.querySelectorAll('input[name="vehicleType"]'),
};

async function init() {
    await loadState();
    updateUI();
    setupEventListeners();
}

async function loadState() {
    const data = await chrome.storage.local.get(["isActive", "vehicleType", "parkings", "refreshInterval", "alertUrl", "vehicleData", "logs"]);
    state.isActive = data.isActive || false;
    state.vehicleType = data.vehicleType || "car";
    state.parkings = data.parkings || [];
    state.refreshInterval = data.refreshInterval || 10;
    state.alertUrl = data.alertUrl || "";
    state.vehicleData = data.vehicleData || { plate: "", brand: "", model: "", color: "" };
    state.logs = data.logs || [];
}

async function saveState() {
    await chrome.storage.local.set(state);
}

function setupEventListeners() {
    elements.toggleBtn.addEventListener("click", toggleBot);
    elements.addParkingBtn.addEventListener("click", showAddParkingModal);
    elements.saveParkingBtn.addEventListener("click", saveParking);
    elements.cancelParkingBtn.addEventListener("click", hideAddParkingModal);
    elements.refreshInterval.addEventListener("change", updateRefreshInterval);
    elements.alertUrl.addEventListener("change", updateAlertUrl);

    elements.vehiclePlate.addEventListener("change", updateVehicleData);
    elements.vehicleBrand.addEventListener("change", updateVehicleData);
    elements.vehicleModel.addEventListener("change", updateVehicleData);
    elements.vehicleColor.addEventListener("change", updateVehicleData);

    elements.vehicleTypes.forEach((radio) => {
        radio.addEventListener("change", updateVehicleType);
    });
}

async function toggleBot() {
    state.isActive = !state.isActive;
    await saveState();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
        action: state.isActive ? "start" : "stop",
        config: {
            vehicleType: state.vehicleType,
            parkings: state.parkings,
            refreshInterval: state.refreshInterval * 1000,
            alertUrl: state.alertUrl,
            vehicleData: state.vehicleData,
        },
    });

    updateUI();
    addLog(state.isActive ? "Bot iniciado" : "Bot detenido");
}

function updateUI() {
    elements.statusIndicator.classList.toggle("active", state.isActive);
    elements.statusText.textContent = state.isActive ? "Activo" : "Inactivo";

    elements.toggleBtn.dataset.state = state.isActive ? "running" : "idle";
    if (elements.toggleBtnLabel) {
        elements.toggleBtnLabel.textContent = state.isActive ? "Detener" : "Iniciar";
    } else {
        elements.toggleBtn.textContent = state.isActive ? "Detener" : "Iniciar";
    }
    elements.toggleBtn.classList.toggle("active", state.isActive);

    elements.refreshInterval.value = state.refreshInterval;
    elements.alertUrl.value = state.alertUrl;

    elements.vehiclePlate.value = state.vehicleData.plate;
    elements.vehicleBrand.value = state.vehicleData.brand;
    elements.vehicleModel.value = state.vehicleData.model;
    elements.vehicleColor.value = state.vehicleData.color;

    elements.vehicleTypes.forEach((radio) => {
        if (radio.value === state.vehicleType) {
            radio.checked = true;
        }
    });

    renderParkings();
    renderLogs();
}

function renderParkings() {
    if (state.parkings.length === 0) {
        elements.parkingsList.innerHTML = `
            <div class="empty-state">
                No hay parqueos configurados. Usa el botón para agregar uno nuevo.
            </div>
        `;
        return;
    }

    elements.parkingsList.innerHTML = state.parkings
        .map(
            (parking, index) => `
                <article class="parking-item">
                    <div class="parking-name">${parking}</div>
                    <button class="icon-button delete-btn" data-index="${index}" aria-label="Eliminar ${parking}">
                        ${icons.trash}
                    </button>
                </article>
            `
        )
        .join("");

    document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const index = parseInt(e.currentTarget.dataset.index, 10);
            deleteParking(index);
        });
    });
}

function showAddParkingModal() {
    elements.addParkingModal.style.display = "flex";
    elements.parkingName.value = "";
    elements.parkingName.focus();
}

function hideAddParkingModal() {
    elements.addParkingModal.style.display = "none";
}

async function saveParking() {
    const name = elements.parkingName.value.trim().toUpperCase();

    if (!name) {
        alert("Por favor completa el nombre del parqueo");
        return;
    }

    const exists = state.parkings.some((p) => p === name);
    if (exists) {
        alert("Este parqueo ya está en la lista");
        return;
    }

    state.parkings.push(name);
    await saveState();

    hideAddParkingModal();
    updateUI();
    addLog(`Parqueo agregado: ${name}`);
}

async function deleteParking(index) {
    const parking = state.parkings[index];
    if (confirm(`¿Eliminar ${parking}?`)) {
        state.parkings.splice(index, 1);
        await saveState();
        updateUI();
        addLog(`Parqueo eliminado: ${parking}`);
    }
}

async function updateVehicleType(e) {
    state.vehicleType = e.target.value;
    await saveState();
    addLog(`Tipo de vehículo: ${state.vehicleType === "car" ? "Automóvil" : "Motocicleta"}`);
}

async function updateRefreshInterval() {
    state.refreshInterval = parseInt(elements.refreshInterval.value);
    await saveState();
    addLog(`Intervalo actualizado: ${state.refreshInterval}s`);
}

async function updateAlertUrl() {
    state.alertUrl = elements.alertUrl.value.trim();
    await saveState();
    if (state.alertUrl) {
        addLog(`URL de alerta configurada`);
    } else {
        addLog(`URL de alerta eliminada`);
    }
}

async function updateVehicleData() {
    state.vehicleData.plate = elements.vehiclePlate.value.trim().toUpperCase();
    state.vehicleData.brand = elements.vehicleBrand.value.trim();
    state.vehicleData.model = elements.vehicleModel.value.trim();
    state.vehicleData.color = elements.vehicleColor.value.trim();
    await saveState();
    addLog("Datos del vehículo actualizados");
}

async function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift({ time: timestamp, message });

    if (state.logs.length > 50) {
        state.logs = state.logs.slice(0, 50);
    }

    await saveState();
    renderLogs();
}

function renderLogs() {
    if (state.logs.length === 0) {
        elements.activityLog.innerHTML = `
            <div class="empty-state">
                Sin actividad reciente. Aquí aparecerán los eventos del bot.
            </div>
        `;
        return;
    }

    elements.activityLog.innerHTML = state.logs
        .map(
            (log) => `
                <div class="log-entry">
                    <div class="log-time">${log.time}</div>
                    <div>${log.message}</div>
                </div>
            `
        )
        .join("");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "log") {
        addLog(message.message);
    }
});

init();

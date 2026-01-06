const DEBUG_MODE = false;

let botConfig = {
    isActive: false,
    vehicleType: "car",
    parkings: [],
    refreshInterval: 10000,
};

let refreshTimer = null;
let isProcessing = false;

async function init() {
    const data = await chrome.storage.local.get(["isActive", "vehicleType", "parkings", "refreshInterval"]);
    if (data.isActive) {
        botConfig.isActive = data.isActive;
        botConfig.vehicleType = data.vehicleType || "car";
        botConfig.parkings = data.parkings || [];
        botConfig.refreshInterval = data.refreshInterval * 1000;
    }

    chrome.runtime.onMessage.addListener(handleMessage);

    await sleep(1000);

    log("Iniciando bot, detectando página...");

    if (isParkingListPage()) {
        log("DETECTADO: Pantalla 3 - Lista de parqueos");
        if (botConfig.isActive) {
            startBot();
        }
    } else if (isVehicleTypePage()) {
        log("DETECTADO: Pantalla 2 - Tipo de vehículo");
        if (botConfig.isActive) {
            selectVehicleType();
        }
    } else if (isCalendarPage()) {
        log("DETECTADO: Pantalla 1 - Calendarios");
        if (botConfig.isActive) {
            clickCalendar();
        }
    } else {
        log("DETECTADO: Página desconocida, esperando...");
    }
}

function isCalendarPage() {
    const breadcrumb = document.querySelector(".breadcrumb-item.active");
    if (breadcrumb && breadcrumb.textContent.includes("Calendarios")) {
        const h4 = document.querySelector("h4");
        if (h4 && h4.textContent.includes("Listado de calendarios")) {
            return true;
        }
    }
    return false;
}

function isVehicleTypePage() {
    const breadcrumb = document.querySelector(".breadcrumb-item.active");
    if (breadcrumb && breadcrumb.textContent.includes("Tipo de vehículo")) {
        return true;
    }

    const hasMotorcycleIcon = document.querySelector(".fa-motorcycle") !== null;
    const hasCarIcon = document.querySelector(".fa-car") !== null;
    const vehicleTitle = document.querySelector(".h1.text-bold");

    if (hasMotorcycleIcon && hasCarIcon && vehicleTitle && vehicleTitle.textContent.includes("Tipo de vehículo")) {
        return true;
    }

    return false;
}

function isParkingListPage() {
    const breadcrumb = document.querySelector(".breadcrumb-item.active");
    if (breadcrumb && breadcrumb.textContent.includes("Oferta de parqueos")) {
        return true;
    }

    const badges = document.querySelectorAll(".badge.badge-primary");
    for (const badge of badges) {
        if (badge.textContent.includes("Disponibles:")) {
            return true;
        }
    }

    return false;
}

function clickCalendar() {
    const calendarRows = document.querySelectorAll("table tbody tr.cursor-pointer");
    if (calendarRows.length > 0) {
        log("Haciendo clic en calendario...");
        calendarRows[0].click();
        return true;
    }
    return false;
}

async function selectVehicleType() {
    await sleep(1500);

    let clicked = false;

    if (botConfig.vehicleType === "motorcycle") {
        log("Buscando Motocicleta...");

        const motorcycleIcon = document.querySelector(".fa-motorcycle");
        if (motorcycleIcon) {
            log("Encontré ícono de moto, haciendo clic en botón...");
            const button = motorcycleIcon.closest("button");
            if (button) {
                button.click();
                clicked = true;
            }
        }

        if (!clicked) {
            const allSpans = document.querySelectorAll("span");
            for (const span of allSpans) {
                if (span.textContent.trim() === "Motocicleta") {
                    log("Encontré span de Motocicleta, haciendo clic...");
                    span.click();
                    clicked = true;
                    break;
                }
            }
        }
    } else {
        log("Buscando Automóvil...");

        const carIcon = document.querySelector(".fa-car");
        if (carIcon) {
            log("Encontré ícono de carro, haciendo clic en botón...");
            const button = carIcon.closest("button");
            if (button) {
                button.click();
                clicked = true;
            }
        }

        if (!clicked) {
            const allSpans = document.querySelectorAll("span");
            for (const span of allSpans) {
                if (span.textContent.trim() === "Automóvil") {
                    log("Encontré span de Automóvil, haciendo clic...");
                    span.click();
                    clicked = true;
                    break;
                }
            }
        }
    }

    if (!clicked) {
        log("ERROR: No pude encontrar el botón de tipo de vehículo");
    }

    return clicked;
}

async function checkParkingAvailability() {
    if (!isParkingListPage()) {
        return;
    }

    if (isProcessing) {
        return;
    }

    isProcessing = true;

    try {
        const tableRows = document.querySelectorAll("table tbody tr");

        for (const row of tableRows) {
            const parkingNameElement = row.querySelector(".flex-column .text-body h4");
            if (!parkingNameElement) continue;

            const parkingName = parkingNameElement.textContent.trim();
            const parkingNameUpper = parkingName.toUpperCase();

            const shouldMonitor = botConfig.parkings.length === 0 ||
                botConfig.parkings.some((p) => parkingNameUpper.includes(p.toUpperCase()));

            if (shouldMonitor) {
                const availableBadge = row.querySelector(".badge.badge-primary");
                if (availableBadge) {
                    const availableText = availableBadge.textContent.trim();
                    const match = availableText.match(/Disponibles:\s*(\d+)/);

                    if (match) {
                        const available = parseInt(match[1]);
                        log(`${parkingName}: ${available} disponibles`);

                        if (available > 0) {
                            stopBot();
                            showAvailabilityNotification(parkingName, available);
                            return;
                        }
                    }
                }
            }
        }
    } catch (error) {
        log(`Error: ${error.message}`);
    } finally {
        isProcessing = false;
    }
}

function startBot() {
    if (botConfig.isActive && refreshTimer === null) {
        checkParkingAvailability();

        refreshTimer = setInterval(() => {
            window.location.reload();
        }, botConfig.refreshInterval);
    }
}

function stopBot() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    botConfig.isActive = false;
}

function handleMessage(message, sender, sendResponse) {
    if (message.action === "start") {
        botConfig = {
            isActive: true,
            vehicleType: message.config.vehicleType,
            parkings: message.config.parkings,
            refreshInterval: message.config.refreshInterval,
        };

        currentPage = null;
        hasProcessedCurrentPage = false;

        log("Bot iniciado desde popup");

        setTimeout(() => {
            if (isParkingListPage()) {
                log("En lista de parqueos, iniciando monitoreo...");
                startBot();
            } else if (isVehicleTypePage()) {
                log("En selección de vehículo, haciendo clic...");
                selectVehicleType();
            } else if (isCalendarPage()) {
                log("En calendarios, haciendo clic...");
                clickCalendar();
            } else {
                log("Página desconocida, esperando navegación...");
            }
        }, 500);
    } else if (message.action === "stop") {
        log("Bot detenido desde popup");
        stopBot();
        currentPage = null;
        hasProcessedCurrentPage = false;
    }
}

function log(message) {
    console.log(`[Parking Sniper] ${message}`);

    chrome.runtime.sendMessage({
        action: "log",
        message: message,
    });
}

function playSuccessSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const beeps = [
        { freq: 800, start: 0, duration: 0.15 },
        { freq: 1000, start: 0.2, duration: 0.15 },
        { freq: 1200, start: 0.4, duration: 0.3 },
    ];

    beeps.forEach((beep) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = beep.freq;
        oscillator.type = "sine";

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + beep.start);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + beep.start + beep.duration);

        oscillator.start(audioContext.currentTime + beep.start);
        oscillator.stop(audioContext.currentTime + beep.start + beep.duration);
    });
}

function showAvailabilityNotification(parkingName, available) {
    playSuccessSound();

    chrome.runtime.sendMessage({
        action: "notify",
        title: "¡PARQUEO DISPONIBLE!",
        message: `${parkingName}: ${available} espacio(s) disponible(s)`,
    });

    setTimeout(() => {
        alert(`¡PARQUEO DISPONIBLE!\n\n${parkingName}\n\n${available} espacio(s) disponible(s)\n\n¡Apresúrate a reservarlo!`);
    }, 100);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let currentPage = null;
let hasProcessedCurrentPage = false;

const observer = new MutationObserver(() => {
    if (!botConfig.isActive) return;

    let detectedPage = null;

    if (isParkingListPage()) {
        detectedPage = "parking-list";
    } else if (isVehicleTypePage()) {
        detectedPage = "vehicle-type";
    } else if (isCalendarPage()) {
        detectedPage = "calendar";
    }

    if (detectedPage && detectedPage !== currentPage) {
        log(`Cambio de página detectado: ${currentPage} -> ${detectedPage}`);
        currentPage = detectedPage;
        hasProcessedCurrentPage = false;
    }

    if (detectedPage && !hasProcessedCurrentPage) {
        hasProcessedCurrentPage = true;

        setTimeout(() => {
            if (detectedPage === "parking-list") {
                log("Iniciando monitoreo de parqueos...");
                startBot();
            } else if (detectedPage === "vehicle-type") {
                log("Seleccionando tipo de vehículo...");
                selectVehicleType();
            } else if (detectedPage === "calendar") {
                log("Haciendo clic en calendario...");
                clickCalendar();
            }
        }, 1500);
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
});

init();
